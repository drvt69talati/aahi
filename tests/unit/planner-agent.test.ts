import { describe, it, expect, beforeEach } from 'vitest';
import { PlannerAgent } from '../../runtime/agents/planner/planner-agent.js';
import { CapabilityRegistry } from '../../runtime/agents/a2a/capability-registry.js';
import type { ContextChunk } from '../../runtime/integrations/registry/types.js';

describe('PlannerAgent', () => {
  let registry: CapabilityRegistry;
  let planner: PlannerAgent;

  const stubContext: ContextChunk[] = [
    {
      source: 'user',
      type: 'code',
      content: 'Error in auth service',
      timestamp: new Date(),
    },
  ];

  beforeEach(() => {
    registry = new CapabilityRegistry();
    planner = new PlannerAgent(registry);
  });

  // ── Basic interface compliance ─────────────────────────────────────────

  it('implements AgentDefinition with correct metadata', () => {
    expect(planner.id).toBe('planner');
    expect(planner.name).toBe('PlannerAgent');
    expect(planner.defaultModel).toBe('agent-planning');
    expect(planner.capabilities).toContain('plan.*');
    expect(planner.triggers).toContain('*');
  });

  // ── Simple intent: single agent ────────────────────────────────────────

  it('creates a plan for a simple single-agent intent', async () => {
    registry.register(
      { agentId: 'debug', intents: ['debug.*'], requiredIntegrations: [] },
      async (msg) => ({ ...msg, fromAgent: 'debug', toAgent: msg.fromAgent, timestamp: new Date() }),
    );

    const plan = await planner.plan('debug.pod crashing in production', stubContext);

    expect(plan.agentId).toBe('planner');
    expect(plan.intent).toBe('debug.pod crashing in production');
    expect(plan.status).toBe('pending');

    // Must have at least 3 steps: decompose, dispatch, synthesize
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);

    // First step is always LLM decomposition
    const decomposeStep = plan.steps[0];
    expect(decomposeStep.type).toBe('llm');
    expect(decomposeStep.name).toContain('Decompose');
    expect(decomposeStep.dependsOn).toEqual([]);
    expect(decomposeStep.modelRequest).toBeDefined();
    expect(decomposeStep.modelRequest!.temperature).toBeLessThanOrEqual(0.2);

    // Last step is always synthesis
    const synthesizeStep = plan.steps[plan.steps.length - 1];
    expect(synthesizeStep.type).toBe('llm');
    expect(synthesizeStep.name).toContain('Synthesize');
  });

  // ── Multi-agent intent: parallel fan-out ───────────────────────────────

  it('creates a parallel fan-out plan when multiple agents match', async () => {
    registry.register(
      { agentId: 'debug', intents: ['analyze.*'], requiredIntegrations: [] },
      async (msg) => ({ ...msg, fromAgent: 'debug', toAgent: msg.fromAgent, timestamp: new Date() }),
    );
    registry.register(
      { agentId: 'security', intents: ['analyze.*'], requiredIntegrations: [] },
      async (msg) => ({ ...msg, fromAgent: 'security', toAgent: msg.fromAgent, timestamp: new Date() }),
    );

    const plan = await planner.plan('analyze.code for vulnerabilities and bugs', stubContext);

    // Should have: decompose, parallel fan-out, synthesize
    expect(plan.steps).toHaveLength(3);

    const parallelStep = plan.steps[1];
    expect(parallelStep.type).toBe('parallel');
    expect(parallelStep.name).toContain('Fan-out');
    expect(parallelStep.parallelSteps).toBeDefined();
    expect(parallelStep.parallelSteps!.length).toBe(2);

    // Both sub-steps should be A2A dispatches
    const agentIds = parallelStep.parallelSteps!.map(s => s.a2aMessage!.toAgent);
    expect(agentIds).toContain('debug');
    expect(agentIds).toContain('security');

    // Each parallel sub-step should have a2aMessage from planner
    for (const subStep of parallelStep.parallelSteps!) {
      expect(subStep.type).toBe('a2a');
      expect(subStep.a2aMessage!.fromAgent).toBe('planner');
    }
  });

  // ── Step dependency correctness ────────────────────────────────────────

  it('ensures synthesize step depends on decomposition and all subtask steps', async () => {
    registry.register(
      { agentId: 'debug', intents: ['debug.*'], requiredIntegrations: [] },
      async (msg) => ({ ...msg, fromAgent: 'debug', toAgent: msg.fromAgent, timestamp: new Date() }),
    );

    const plan = await planner.plan('debug.service auth failure', stubContext);

    const decomposeStep = plan.steps[0];
    const subtaskSteps = plan.steps.slice(1, -1);
    const synthesizeStep = plan.steps[plan.steps.length - 1];

    // Synthesize must depend on decomposition step
    expect(synthesizeStep.dependsOn).toContain(decomposeStep.id);

    // Synthesize must depend on every subtask step
    for (const subtask of subtaskSteps) {
      expect(synthesizeStep.dependsOn).toContain(subtask.id);
    }

    // Subtask steps depend on decomposition
    for (const subtask of subtaskSteps) {
      expect(subtask.dependsOn).toContain(decomposeStep.id);
    }

    // Decomposition has no dependencies
    expect(decomposeStep.dependsOn).toEqual([]);
  });

  // ── Fallback when no agents match ──────────────────────────────────────

  it('creates a fallback dispatch when no agents match the intent', async () => {
    // Registry is empty — no agents registered
    const plan = await planner.plan('unknown.task do something', stubContext);

    // Should still produce a valid plan with fallback
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);

    const subtaskStep = plan.steps[1];
    expect(subtaskStep.type).toBe('a2a');
    expect(subtaskStep.a2aMessage!.toAgent).toBe('general');
  });

  // ── All step IDs are unique ────────────────────────────────────────────

  it('generates unique IDs for all steps', async () => {
    registry.register(
      { agentId: 'debug', intents: ['debug.*'], requiredIntegrations: [] },
      async (msg) => ({ ...msg, fromAgent: 'debug', toAgent: msg.fromAgent, timestamp: new Date() }),
    );

    const plan = await planner.plan('debug.pod issue', stubContext);
    const ids = plan.steps.map(s => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  // ── A2A constraints ────────────────────────────────────────────────────

  it('applies default max_time constraint to A2A subtasks', async () => {
    registry.register(
      { agentId: 'debug', intents: ['debug.*'], requiredIntegrations: [] },
      async (msg) => ({ ...msg, fromAgent: 'debug', toAgent: msg.fromAgent, timestamp: new Date() }),
    );

    const plan = await planner.plan('debug.error in payments', stubContext);

    const a2aStep = plan.steps.find(s => s.type === 'a2a');
    expect(a2aStep).toBeDefined();
    expect(a2aStep!.a2aMessage!.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'max_time' }),
      ]),
    );
  });
});
