import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DAGExecutor } from '../../runtime/agents/runtime/dag-executor.js';
import type {
  ExecutionPlan,
  AgentStep,
  AgentCallbacks,
} from '../../runtime/agents/runtime/types.js';
import type { AahiModelAdapter, ModelRequest, ModelResponse, ModelChunk } from '../../runtime/ai/models/types.js';
import type { IntegrationRegistry } from '../../runtime/integrations/registry/integration-registry.js';
import type { RedactionPipeline, RedactionResult } from '../../runtime/ai/redaction/redaction-pipeline.js';

// ─── Mock Model Adapter ─────────────────────────────────────────────────────

function createMockModelAdapter(response?: Partial<ModelResponse>): AahiModelAdapter {
  return {
    provider: 'mock',
    model: 'mock-1',
    capabilities: ['chat'],
    maxContextTokens: 100_000,
    supportsToolUse: true,
    call: vi.fn().mockResolvedValue({
      content: 'mock response',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      finishReason: 'stop',
      model: 'mock-1',
      ...response,
    }),
    streamCall: vi.fn().mockReturnValue((async function* () {})()),
    countTokens: vi.fn().mockResolvedValue(10),
  };
}

// ─── Mock Redaction Pipeline ────────────────────────────────────────────────

function createMockRedactionPipeline(): RedactionPipeline {
  return {
    redact(text: string): RedactionResult {
      // Replace anything that looks like a secret key
      const sanitized = text.replace(/sk-[a-zA-Z0-9]+/g, '<REDACTED_KEY>');
      return {
        sanitized,
        matches: sanitized !== text
          ? [{ type: 'API_KEY', original: '', replacement: '<REDACTED_KEY>', start: 0, end: 0, confidence: 1 }]
          : [],
        redactionMapId: 'test-map',
      };
    },
    hasSensitiveData(text: string): boolean {
      return /sk-[a-zA-Z0-9]+/.test(text);
    },
  } as unknown as RedactionPipeline;
}

// ─── Mock Integration Registry ──────────────────────────────────────────────

function createMockIntegrationRegistry(): IntegrationRegistry {
  return {
    get: vi.fn().mockReturnValue(undefined),
  } as unknown as IntegrationRegistry;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<AgentStep> & { id: string; name: string }): AgentStep {
  return {
    type: 'llm',
    status: 'pending',
    dependsOn: [],
    modelRequest: { messages: [{ role: 'user', content: 'test' }] },
    ...overrides,
  };
}

function makePlan(steps: AgentStep[], overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    id: 'plan-1',
    intent: 'test intent',
    steps,
    createdAt: new Date(),
    status: 'pending',
    agentId: 'test-agent',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DAGExecutor', () => {
  let model: AahiModelAdapter;
  let registry: IntegrationRegistry;
  let redaction: RedactionPipeline;

  beforeEach(() => {
    model = createMockModelAdapter();
    registry = createMockIntegrationRegistry();
    redaction = createMockRedactionPipeline();
  });

  // ── Cycle detection ──────────────────────────────────────────────────

  describe('cycle detection', () => {
    it('throws on direct circular dependency (A depends on B, B depends on A)', async () => {
      const steps: AgentStep[] = [
        makeStep({ id: 'a', name: 'Step A', dependsOn: ['b'] }),
        makeStep({ id: 'b', name: 'Step B', dependsOn: ['a'] }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(model, registry, redaction);

      await expect(executor.execute(plan)).rejects.toThrow(/[Cc]ycle/);
    });

    it('throws on transitive circular dependency (A -> B -> C -> A)', async () => {
      const steps: AgentStep[] = [
        makeStep({ id: 'a', name: 'Step A', dependsOn: ['c'] }),
        makeStep({ id: 'b', name: 'Step B', dependsOn: ['a'] }),
        makeStep({ id: 'c', name: 'Step C', dependsOn: ['b'] }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(model, registry, redaction);

      await expect(executor.execute(plan)).rejects.toThrow(/[Cc]ycle/);
    });

    it('throws on self-referencing step', async () => {
      const steps: AgentStep[] = [
        makeStep({ id: 'a', name: 'Step A', dependsOn: ['a'] }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(model, registry, redaction);

      await expect(executor.execute(plan)).rejects.toThrow(/[Cc]ycle/);
    });
  });

  // ── Plan validation ──────────────────────────────────────────────────

  describe('plan validation', () => {
    it('throws when tool step has no toolAction', async () => {
      const steps: AgentStep[] = [
        makeStep({ id: 'a', name: 'Tool Step', type: 'tool' }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(model, registry, redaction);

      await expect(executor.execute(plan)).rejects.toThrow(/toolAction/);
    });

    it('throws when llm step has no modelRequest', async () => {
      const steps: AgentStep[] = [
        makeStep({ id: 'a', name: 'LLM Step', type: 'llm', modelRequest: undefined }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(model, registry, redaction);

      await expect(executor.execute(plan)).rejects.toThrow(/modelRequest/);
    });

    it('throws when a2a step has no a2aMessage', async () => {
      const steps: AgentStep[] = [
        makeStep({ id: 'a', name: 'A2A Step', type: 'a2a' }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(model, registry, redaction);

      await expect(executor.execute(plan)).rejects.toThrow(/a2aMessage/);
    });

    it('throws when step depends on unknown step', async () => {
      const steps: AgentStep[] = [
        makeStep({ id: 'a', name: 'Step A', dependsOn: ['nonexistent'] }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(model, registry, redaction);

      await expect(executor.execute(plan)).rejects.toThrow(/unknown step/);
    });
  });

  // ── Multimodal content redaction ─────────────────────────────────────

  describe('multimodal content redaction', () => {
    it('redacts secrets from string message content before LLM call', async () => {
      const steps: AgentStep[] = [
        makeStep({
          id: 'a',
          name: 'LLM Step',
          type: 'llm',
          modelRequest: {
            messages: [
              { role: 'user', content: 'My key is sk-secret123abc' },
            ],
          },
        }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(model, registry, redaction);

      await executor.execute(plan);

      const callArgs = (model.call as any).mock.calls[0][0] as ModelRequest;
      expect(callArgs.messages[0].content).toBe('My key is <REDACTED_KEY>');
    });

    it('redacts secrets from multimodal content blocks', async () => {
      const steps: AgentStep[] = [
        makeStep({
          id: 'a',
          name: 'LLM Step',
          type: 'llm',
          modelRequest: {
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Token: sk-multimodalsecret' },
                  { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'abc' } },
                ],
              },
            ],
          },
        }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(model, registry, redaction);

      await executor.execute(plan);

      const callArgs = (model.call as any).mock.calls[0][0] as ModelRequest;
      const blocks = callArgs.messages[0].content as any[];
      expect(blocks[0].text).toBe('Token: <REDACTED_KEY>');
      // Image block should be preserved
      expect(blocks[1].type).toBe('image');
    });

    it('redacts secrets from system prompt', async () => {
      const steps: AgentStep[] = [
        makeStep({
          id: 'a',
          name: 'LLM Step',
          type: 'llm',
          modelRequest: {
            messages: [{ role: 'user', content: 'hello' }],
            systemPrompt: 'System key: sk-systempromptkey',
          },
        }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(model, registry, redaction);

      await executor.execute(plan);

      const callArgs = (model.call as any).mock.calls[0][0] as ModelRequest;
      expect(callArgs.systemPrompt).toBe('System key: <REDACTED_KEY>');
    });
  });

  // ── Step execution order respects dependencies ───────────────────────

  describe('execution order', () => {
    it('executes steps respecting dependency order', async () => {
      const executionOrder: string[] = [];
      const mockModel = createMockModelAdapter();
      (mockModel.call as any).mockImplementation(async () => {
        return {
          content: 'ok',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
          model: 'mock-1',
        };
      });

      const callbacks: AgentCallbacks = {
        onStepStart: (step) => executionOrder.push(step.id),
      };

      const steps: AgentStep[] = [
        makeStep({
          id: 'first',
          name: 'First',
          type: 'llm',
          modelRequest: { messages: [{ role: 'user', content: 'a' }] },
        }),
        makeStep({
          id: 'second',
          name: 'Second',
          type: 'llm',
          dependsOn: ['first'],
          modelRequest: { messages: [{ role: 'user', content: 'b' }] },
        }),
        makeStep({
          id: 'third',
          name: 'Third',
          type: 'llm',
          dependsOn: ['second'],
          modelRequest: { messages: [{ role: 'user', content: 'c' }] },
        }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(mockModel, registry, redaction, callbacks);

      await executor.execute(plan);

      expect(executionOrder).toEqual(['first', 'second', 'third']);
    });
  });

  // ── Parallel steps run concurrently ──────────────────────────────────

  describe('parallel execution', () => {
    it('runs independent steps concurrently', async () => {
      const startTimes: Record<string, number> = {};
      const endTimes: Record<string, number> = {};

      const slowModel = createMockModelAdapter();
      (slowModel.call as any).mockImplementation(async () => {
        const id = `step-${Date.now()}`;
        await new Promise(r => setTimeout(r, 50));
        return {
          content: 'ok',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
          model: 'mock-1',
        };
      });

      const callbacks: AgentCallbacks = {
        onStepStart: (step) => { startTimes[step.id] = Date.now(); },
        onStepComplete: (step) => { endTimes[step.id] = Date.now(); },
      };

      const steps: AgentStep[] = [
        makeStep({
          id: 'parallel-a',
          name: 'Parallel A',
          type: 'llm',
          modelRequest: { messages: [{ role: 'user', content: 'a' }] },
        }),
        makeStep({
          id: 'parallel-b',
          name: 'Parallel B',
          type: 'llm',
          modelRequest: { messages: [{ role: 'user', content: 'b' }] },
        }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(slowModel, registry, redaction, callbacks);

      await executor.execute(plan);

      // Both should have started before either finished (or near-simultaneously)
      // The key check: they started within a small window of each other
      const startDiff = Math.abs(startTimes['parallel-a'] - startTimes['parallel-b']);
      expect(startDiff).toBeLessThan(30); // Should start nearly simultaneously
    });
  });

  // ── Failed steps don't block independent branches ────────────────────

  describe('failure isolation', () => {
    it('failed steps do not block independent branches', async () => {
      const failModel = createMockModelAdapter();
      let callCount = 0;
      (failModel.call as any).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Intentional failure');
        }
        return {
          content: 'ok',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
          model: 'mock-1',
        };
      });

      const steps: AgentStep[] = [
        makeStep({
          id: 'failing',
          name: 'Failing Step',
          type: 'llm',
          modelRequest: { messages: [{ role: 'user', content: 'fail' }] },
        }),
        makeStep({
          id: 'independent',
          name: 'Independent Step',
          type: 'llm',
          modelRequest: { messages: [{ role: 'user', content: 'succeed' }] },
        }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(failModel, registry, redaction);

      await executor.execute(plan);

      // The failing step should have failed
      expect(steps[0].status).toBe('failed');
      // The independent step should have completed successfully
      expect(steps[1].status).toBe('completed');
    });

    it('dependent steps are not executed when their dependency fails', async () => {
      const failModel = createMockModelAdapter();
      (failModel.call as any).mockRejectedValueOnce(new Error('Intentional failure'));
      (failModel.call as any).mockResolvedValue({
        content: 'ok',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        model: 'mock-1',
      });

      const steps: AgentStep[] = [
        makeStep({
          id: 'root',
          name: 'Root (fails)',
          type: 'llm',
          modelRequest: { messages: [{ role: 'user', content: 'fail' }] },
        }),
        makeStep({
          id: 'dependent',
          name: 'Dependent Step',
          type: 'llm',
          dependsOn: ['root'],
          modelRequest: { messages: [{ role: 'user', content: 'never runs' }] },
        }),
        makeStep({
          id: 'independent',
          name: 'Independent Step',
          type: 'llm',
          modelRequest: { messages: [{ role: 'user', content: 'runs fine' }] },
        }),
      ];
      const plan = makePlan(steps);
      const executor = new DAGExecutor(failModel, registry, redaction);

      await executor.execute(plan);

      expect(steps[0].status).toBe('failed');
      // The dependent step should be failed due to deadlock (unsatisfied deps)
      expect(steps[1].status).toBe('failed');
      expect(steps[1].result?.error).toContain('Deadlock');
      // The independent step should have completed
      expect(steps[2].status).toBe('completed');
    });
  });
});
