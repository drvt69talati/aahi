// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Integration Test: Agent Flow
// Agent receives intent → creates plan → DAG executes → timeline updated →
// result returned.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DAGExecutor } from '../../runtime/agents/runtime/dag-executor.js';
import { DebugAgent } from '../../runtime/agents/debug.agent.js';
import { TimelineStore } from '../../runtime/intelligence/timeline/timeline-store.js';
import type {
  ExecutionPlan,
  AgentStep,
  AgentCallbacks,
  A2AMessage,
} from '../../runtime/agents/runtime/types.js';
import type {
  AahiModelAdapter,
  ModelRequest,
  ModelResponse,
  ModelChunk,
} from '../../runtime/ai/models/types.js';
import type { IntegrationRegistry } from '../../runtime/integrations/registry/integration-registry.js';
import type { RedactionPipeline, RedactionResult } from '../../runtime/ai/redaction/redaction-pipeline.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

function createMockModelAdapter(response?: string): AahiModelAdapter {
  return {
    provider: 'mock',
    model: 'mock-1',
    capabilities: ['chat'],
    maxContextTokens: 100_000,
    supportsToolUse: true,
    call: vi.fn().mockResolvedValue({
      content: response ?? 'Root cause: null pointer in auth module',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      finishReason: 'stop',
      model: 'mock-1',
    } satisfies ModelResponse),
    streamCall: vi.fn().mockReturnValue((async function* () {})()),
    countTokens: vi.fn().mockResolvedValue(10),
  };
}

function createMockRedaction(): RedactionPipeline {
  return {
    redact(text: string): RedactionResult {
      return { sanitized: text, matches: [], redactionMapId: 'map-1' };
    },
    hasSensitiveData(_text: string): boolean {
      return false;
    },
  } as unknown as RedactionPipeline;
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

describe('Agent Flow — Integration', () => {
  let model: AahiModelAdapter;
  let registry: IntegrationRegistry;
  let redaction: RedactionPipeline;
  let timeline: TimelineStore;

  beforeEach(() => {
    model = createMockModelAdapter();
    registry = createMockIntegrationRegistry();
    redaction = createMockRedaction();
    timeline = new TimelineStore();
  });

  // ── DebugAgent.plan() creates valid plan ──────────────────────────────

  it('DebugAgent.plan() creates a valid execution plan', async () => {
    const agent = new DebugAgent();
    const plan = await agent.plan('CrashLoopBackOff in auth-service namespace=production', []);

    expect(plan.id).toBeDefined();
    expect(plan.intent).toContain('CrashLoopBackOff');
    expect(plan.agentId).toBe('debug');
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    expect(plan.status).toBe('pending');

    // First step should be a parallel gather step
    const gatherStep = plan.steps[0];
    expect(gatherStep.type).toBe('parallel');
    expect(gatherStep.parallelSteps!.length).toBeGreaterThan(0);

    // Should have an A2A correlation step
    const a2aStep = plan.steps.find(s => s.type === 'a2a');
    expect(a2aStep).toBeDefined();
    expect(a2aStep!.a2aMessage!.toAgent).toBe('temporal');

    // Should have an LLM analysis step
    const llmStep = plan.steps.find(s => s.type === 'llm');
    expect(llmStep).toBeDefined();
    expect(llmStep!.modelRequest!.systemPrompt).toContain('DebugAgent');
  });

  // ── DAG execution with dependencies ───────────────────────────────────

  it('DAGExecutor runs plan with steps in correct dependency order', async () => {
    const executionOrder: string[] = [];
    const callbacks: AgentCallbacks = {
      onStepStart: (step) => executionOrder.push(`start:${step.id}`),
      onStepComplete: (step) => executionOrder.push(`complete:${step.id}`),
    };

    const steps: AgentStep[] = [
      makeStep({ id: 'gather', name: 'Gather' }),
      makeStep({ id: 'analyze', name: 'Analyze', dependsOn: ['gather'] }),
      makeStep({ id: 'report', name: 'Report', dependsOn: ['analyze'] }),
    ];
    const plan = makePlan(steps);
    const executor = new DAGExecutor(model, registry, redaction, callbacks);

    const result = await executor.execute(plan);

    expect(result.status).toBe('completed');
    // Verify order: gather must start before analyze, analyze before report
    const gatherCompleteIdx = executionOrder.indexOf('complete:gather');
    const analyzeStartIdx = executionOrder.indexOf('start:analyze');
    const analyzeCompleteIdx = executionOrder.indexOf('complete:analyze');
    const reportStartIdx = executionOrder.indexOf('start:report');

    expect(gatherCompleteIdx).toBeLessThan(analyzeStartIdx);
    expect(analyzeCompleteIdx).toBeLessThan(reportStartIdx);
  });

  // ── Approval gates ────────────────────────────────────────────────────

  it('approval gate pauses execution and resumes on approve', async () => {
    let approvalRequested = false;

    const callbacks: AgentCallbacks = {
      onApprovalRequired: async (gate) => {
        approvalRequested = true;
        return true; // Auto-approve
      },
    };

    const steps: AgentStep[] = [
      makeStep({
        id: 'destructive',
        name: 'Destructive Action',
        approvalGate: {
          actionId: 'delete-pod',
          integration: 'kubernetes',
          actionType: 'destructive',
          description: 'Delete failing pod',
          params: {},
          riskLevel: 'critical',
          requiresApproval: true,
          requiresTypedConfirmation: true,
          timeout: 120_000,
        },
      }),
    ];
    const plan = makePlan(steps);
    const executor = new DAGExecutor(model, registry, redaction, callbacks);

    const result = await executor.execute(plan);

    expect(approvalRequested).toBe(true);
    expect(result.steps[0].status).toBe('completed');
  });

  it('approval gate cancels step when declined', async () => {
    const callbacks: AgentCallbacks = {
      onApprovalRequired: async () => false, // Decline
    };

    const steps: AgentStep[] = [
      makeStep({
        id: 'destructive',
        name: 'Destructive Action',
        approvalGate: {
          actionId: 'delete-pod',
          integration: 'kubernetes',
          actionType: 'destructive',
          description: 'Delete failing pod',
          params: {},
          riskLevel: 'critical',
          requiresApproval: true,
          requiresTypedConfirmation: true,
          timeout: 120_000,
        },
      }),
    ];
    const plan = makePlan(steps);
    const executor = new DAGExecutor(model, registry, redaction, callbacks);

    const result = await executor.execute(plan);

    expect(result.steps[0].status).toBe('cancelled');
    expect(result.steps[0].result!.error).toContain('declined');
  });

  // ── Failed steps don't block independent branches ─────────────────────

  it('failed steps do not block independent branches', async () => {
    const failModel = createMockModelAdapter();
    let callCount = 0;
    (failModel.call as any).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('Intentional failure');
      return {
        content: 'success',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        model: 'mock-1',
      };
    });

    const steps: AgentStep[] = [
      makeStep({ id: 'branch-a', name: 'Branch A (fails)' }),
      makeStep({ id: 'branch-b', name: 'Branch B (succeeds)' }),
    ];
    const plan = makePlan(steps);
    const executor = new DAGExecutor(failModel, registry, redaction);

    await executor.execute(plan);

    expect(steps[0].status).toBe('failed');
    expect(steps[1].status).toBe('completed');
  });

  // ── Timeline receives events from agent execution ─────────────────────

  it('timeline receives events when agent steps complete', async () => {
    const callbacks: AgentCallbacks = {
      onStepComplete: (step, result) => {
        // Simulate what Aahi does: log step completions to timeline
        timeline.append({
          timestamp: new Date(),
          source: 'custom',
          category: 'custom',
          severity: result.success ? 'info' : 'error',
          title: `Agent step: ${step.name}`,
          description: `Step ${step.id} ${result.success ? 'completed' : 'failed'}`,
          data: { stepId: step.id, planId: 'plan-1' },
          relatedEventIds: [],
          tags: ['agent', step.name],
        });
      },
    };

    const steps: AgentStep[] = [
      makeStep({ id: 's1', name: 'Step One' }),
      makeStep({ id: 's2', name: 'Step Two', dependsOn: ['s1'] }),
    ];
    const plan = makePlan(steps);
    const executor = new DAGExecutor(model, registry, redaction, callbacks);

    await executor.execute(plan);

    expect(timeline.size).toBe(2);
    const events = timeline.query({});
    const titles = events.map(e => e.title);
    expect(titles.some(t => t.includes('Step One'))).toBe(true);
    expect(titles.some(t => t.includes('Step Two'))).toBe(true);
  });

  // ── Activity log records all steps ────────────────────────────────────

  it('activity log records all executed steps', async () => {
    const steps: AgentStep[] = [
      makeStep({ id: 's1', name: 'Step One' }),
      makeStep({ id: 's2', name: 'Step Two' }),
    ];
    const plan = makePlan(steps);
    const executor = new DAGExecutor(model, registry, redaction);

    await executor.execute(plan);

    const log = executor.getActivityLog();
    expect(log).toHaveLength(2);
    expect(log[0].stepId).toBe('s1');
    expect(log[1].stepId).toBe('s2');
    expect(log[0].result.success).toBe(true);
  });

  // ── A2A message routing ───────────────────────────────────────────────

  it('A2A messages are routed correctly between agents', async () => {
    const a2aHandler = vi.fn().mockImplementation(async (message: A2AMessage) => ({
      id: 'response-1',
      fromAgent: message.toAgent,
      toAgent: message.fromAgent,
      intent: `${message.toAgent}.result`,
      context: [],
      constraints: [],
      replyTo: message.id,
      timestamp: new Date(),
    }));

    const steps: AgentStep[] = [
      makeStep({
        id: 'a2a-step',
        name: 'Cross-Agent Call',
        type: 'a2a',
        modelRequest: undefined,
        a2aMessage: {
          id: 'msg-1',
          fromAgent: 'debug',
          toAgent: 'temporal',
          intent: 'correlate.error',
          context: [],
          constraints: [{ type: 'max_time', value: 30_000 }],
          timestamp: new Date(),
        },
      }),
    ];
    const plan = makePlan(steps);
    const executor = new DAGExecutor(model, registry, redaction, {}, a2aHandler);

    const result = await executor.execute(plan);

    expect(a2aHandler).toHaveBeenCalledTimes(1);
    expect(a2aHandler.mock.calls[0][0].toAgent).toBe('temporal');
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].result!.a2aResponse).toBeDefined();
    expect(result.steps[0].result!.a2aResponse!.fromAgent).toBe('temporal');
  });
});
