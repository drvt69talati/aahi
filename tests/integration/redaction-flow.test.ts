// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Integration Test: Redaction Flow
// Data with secrets → redaction pipeline → LLM call → verify no secrets in
// outbound. Also tests de-redaction for UI display.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedactionPipeline } from '../../runtime/ai/redaction/redaction-pipeline.js';
import { DAGExecutor } from '../../runtime/agents/runtime/dag-executor.js';
import type { AgentStep, ExecutionPlan } from '../../runtime/agents/runtime/types.js';
import type { AahiModelAdapter, ModelRequest, ModelResponse } from '../../runtime/ai/models/types.js';
import type { IntegrationRegistry } from '../../runtime/integrations/registry/integration-registry.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockModelAdapter(): AahiModelAdapter {
  return {
    provider: 'mock',
    model: 'mock-1',
    capabilities: ['chat'],
    maxContextTokens: 100_000,
    supportsToolUse: true,
    call: vi.fn().mockResolvedValue({
      content: 'Analysis complete.',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      finishReason: 'stop',
      model: 'mock-1',
    } satisfies ModelResponse),
    streamCall: vi.fn().mockReturnValue((async function* () {})()),
    countTokens: vi.fn().mockResolvedValue(10),
  };
}

function createMockIntegrationRegistry(): IntegrationRegistry {
  return {
    get: vi.fn().mockReturnValue(undefined),
  } as unknown as IntegrationRegistry;
}

function makeStep(overrides: Partial<AgentStep> & { id: string; name: string }): AgentStep {
  return {
    type: 'llm',
    status: 'pending',
    dependsOn: [],
    modelRequest: { messages: [{ role: 'user', content: 'test' }] },
    ...overrides,
  };
}

function makePlan(steps: AgentStep[]): ExecutionPlan {
  return {
    id: 'plan-redact',
    intent: 'redaction test',
    steps,
    createdAt: new Date(),
    status: 'pending',
    agentId: 'test-agent',
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Redaction Flow — Integration', () => {
  let pipeline: RedactionPipeline;

  beforeEach(() => {
    pipeline = new RedactionPipeline();
  });

  // ── API key in chat message → redacted before model call ──────────────

  it('API key in chat message is redacted before model call', async () => {
    const model = createMockModelAdapter();
    const registry = createMockIntegrationRegistry();

    const steps: AgentStep[] = [
      makeStep({
        id: 'chat',
        name: 'Chat with secrets',
        type: 'llm',
        modelRequest: {
          messages: [
            { role: 'user', content: 'Use this key: sk-abcdefghijklmnopqrstuvwxyz' },
          ],
        },
      }),
    ];
    const plan = makePlan(steps);
    const executor = new DAGExecutor(model, registry, pipeline);

    await executor.execute(plan);

    const callArgs = (model.call as any).mock.calls[0][0] as ModelRequest;
    const content = callArgs.messages[0].content as string;
    expect(content).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(content).toMatch(/<API_KEY_\d+>/);
  });

  // ── Connection string in context → redacted ───────────────────────────

  it('connection string in context is redacted in assembled context', async () => {
    const model = createMockModelAdapter();
    const registry = createMockIntegrationRegistry();

    const steps: AgentStep[] = [
      makeStep({
        id: 'conn',
        name: 'Context with connection string',
        type: 'llm',
        modelRequest: {
          messages: [
            {
              role: 'user',
              content: 'DB is at postgres://admin:supersecret@db.example.com:5432/mydb',
            },
          ],
        },
      }),
    ];
    const plan = makePlan(steps);
    const executor = new DAGExecutor(model, registry, pipeline);

    await executor.execute(plan);

    const callArgs = (model.call as any).mock.calls[0][0] as ModelRequest;
    const content = callArgs.messages[0].content as string;
    expect(content).not.toContain('postgres://admin:supersecret@db.example.com');
    expect(content).toMatch(/<CONNECTION_STRING_\d+>/);
  });

  // ── Email in agent step output → redacted in activity log ─────────────

  it('email addresses are detected and redacted', () => {
    const input = 'Contact admin@example.com for access';
    const result = pipeline.redact(input);

    expect(result.sanitized).not.toContain('admin@example.com');
    expect(result.sanitized).toMatch(/<EMAIL_\d+>/);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.some(m => m.type === 'EMAIL')).toBe(true);
  });

  // ── Multimodal content (array messages) → text blocks redacted ────────

  it('multimodal content with text blocks is redacted', async () => {
    const model = createMockModelAdapter();
    const registry = createMockIntegrationRegistry();

    const steps: AgentStep[] = [
      makeStep({
        id: 'multimodal',
        name: 'Multimodal with secrets',
        type: 'llm',
        modelRequest: {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Token: sk-multimodalsecretvalue123' },
                {
                  type: 'image',
                  source: { type: 'base64', mediaType: 'image/png', data: 'abc' },
                },
                {
                  type: 'tool_result',
                  toolUseId: 'tool-1',
                  content: 'Result with key sk-toolresultsecret1234',
                },
              ],
            },
          ],
        },
      }),
    ];
    const plan = makePlan(steps);
    const executor = new DAGExecutor(model, registry, pipeline);

    await executor.execute(plan);

    const callArgs = (model.call as any).mock.calls[0][0] as ModelRequest;
    const blocks = callArgs.messages[0].content as any[];

    // Text block should have the secret redacted
    expect(blocks[0].text).not.toContain('sk-multimodalsecretvalue123');
    expect(blocks[0].text).toMatch(/<API_KEY_\d+>/);

    // Image block should be preserved
    expect(blocks[1].type).toBe('image');

    // Tool result block should have the secret redacted
    expect(blocks[2].content).not.toContain('sk-toolresultsecret1234');
  });

  // ── Tool step responses → checked for sensitive data ──────────────────

  it('tool step responses are checked for sensitive data', () => {
    const toolOutput = '{"apiKey": "sk-responsekey12345678901234"}';
    expect(pipeline.hasSensitiveData(toolOutput)).toBe(true);

    const result = pipeline.redact(toolOutput);
    expect(result.sanitized).not.toContain('sk-responsekey12345678901234');
  });

  // ── Redaction map stored → de-redaction works for UI display ──────────

  it('redaction map allows de-redaction for UI display', () => {
    const original = 'My secret key is sk-abcdefghijklmnopqrst123 and email is user@test.com';
    const result = pipeline.redact(original);

    // Verify redacted
    expect(result.sanitized).not.toContain('sk-abcdefghijklmnopqrst123');
    expect(result.sanitized).not.toContain('user@test.com');
    expect(result.redactionMapId).toBeDefined();

    // De-redact using the map
    const deRedacted = pipeline.deRedact(result.sanitized, result.redactionMapId);
    expect(deRedacted).toContain('sk-abcdefghijklmnopqrst123');
    expect(deRedacted).toContain('user@test.com');
  });

  // ── Custom patterns added → detected in subsequent calls ──────────────

  it('custom patterns are detected after being added', () => {
    // Before adding pattern, internal IDs are not detected
    const beforeResult = pipeline.redact('Internal ID: AAHI-12345-SECRET');
    expect(beforeResult.sanitized).toBe('Internal ID: AAHI-12345-SECRET');

    // Add custom pattern
    pipeline.addPatterns([
      {
        type: 'INTERNAL_ID',
        pattern: /AAHI-\d{5}-SECRET/g,
        description: 'Internal secret identifier',
      },
    ]);

    // After adding pattern, it should be detected
    const afterResult = pipeline.redact('Internal ID: AAHI-12345-SECRET');
    expect(afterResult.sanitized).not.toContain('AAHI-12345-SECRET');
    expect(afterResult.sanitized).toMatch(/<INTERNAL_ID_\d+>/);
  });

  // ── System prompt redaction ───────────────────────────────────────────

  it('system prompt secrets are redacted', async () => {
    const model = createMockModelAdapter();
    const registry = createMockIntegrationRegistry();

    const steps: AgentStep[] = [
      makeStep({
        id: 'sys',
        name: 'System with secrets',
        type: 'llm',
        modelRequest: {
          messages: [{ role: 'user', content: 'hello' }],
          systemPrompt: 'Use API key sk-systempromptkeysecret1234 for auth',
        },
      }),
    ];
    const plan = makePlan(steps);
    const executor = new DAGExecutor(model, registry, pipeline);

    await executor.execute(plan);

    const callArgs = (model.call as any).mock.calls[0][0] as ModelRequest;
    expect(callArgs.systemPrompt).not.toContain('sk-systempromptkeysecret1234');
    expect(callArgs.systemPrompt).toMatch(/<API_KEY_\d+>/);
  });

  // ── Multiple secret types in one message ──────────────────────────────

  it('detects multiple secret types in a single message', () => {
    const input = [
      'API key: sk-myapikey12345678901234',
      'AWS key: AKIA1234567890ABCDEF',
      'Email: admin@company.com',
      'DB: postgres://user:pass@host:5432/db',
    ].join('\n');

    const result = pipeline.redact(input);

    expect(result.sanitized).not.toContain('sk-myapikey12345678901234');
    expect(result.sanitized).not.toContain('AKIA1234567890ABCDEF');
    expect(result.sanitized).not.toContain('admin@company.com');
    expect(result.sanitized).not.toContain('postgres://user:pass@host:5432/db');

    // Should have matches for each type
    const types = result.matches.map(m => m.type);
    expect(types).toContain('API_KEY');
    expect(types).toContain('AWS_KEY');
    expect(types).toContain('EMAIL');
    expect(types).toContain('CONNECTION_STRING');
  });
});
