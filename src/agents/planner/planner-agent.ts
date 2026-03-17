// ─────────────────────────────────────────────────────────────────────────────
// Aahi — PlannerAgent (Orchestrator)
// Decomposes user intents into DAGs and routes subtasks to specialist agents
// via A2A protocol. Uses the most capable model for planning.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  AgentDefinition,
  ExecutionPlan,
  AgentStep,
  A2AMessage,
  AgentConstraint,
} from '../runtime/types.js';
import type { ContextChunk } from '../../integrations/registry/types.js';
import type { CapabilityRegistry } from '../a2a/capability-registry.js';

/**
 * Structured subtask produced by the LLM decomposition step.
 */
export interface SubtaskDescriptor {
  /** Human-readable subtask name */
  name: string;
  /** Intent string for capability routing (e.g. "debug.pod", "deploy.service") */
  intent: string;
  /** IDs of other subtasks this depends on (by index in the array, resolved to IDs later) */
  dependsOnIndices: number[];
  /** Additional constraints for this subtask */
  constraints: AgentConstraint[];
}

/**
 * The raw plan shape the LLM is asked to produce.
 */
export interface DecomposedPlan {
  subtasks: SubtaskDescriptor[];
  reasoning: string;
}

export class PlannerAgent implements AgentDefinition {
  readonly id = 'planner';
  readonly name = 'PlannerAgent';
  readonly description =
    'Orchestrator agent that decomposes user intents into DAGs and routes subtasks to specialist agents';
  readonly triggers = ['*'];
  readonly requiredIntegrations: string[] = [];
  readonly capabilities = ['plan.*', 'orchestrate.*', 'decompose.*'];
  readonly defaultModel = 'agent-planning';

  constructor(private readonly registry: CapabilityRegistry) {}

  async plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan> {
    const planId = uuid();

    // ── Step 1: LLM decomposition ──────────────────────────────────────────
    // Ask the most capable model to break the intent into routable subtasks.
    const availableCapabilities = this.registry.listCapabilities();

    const decompositionStep: AgentStep = {
      id: uuid(),
      name: 'Decompose intent into subtasks',
      type: 'llm',
      status: 'pending',
      dependsOn: [],
      modelRequest: {
        systemPrompt: `You are Aahi's PlannerAgent. Your job is to decompose a user intent into a structured execution plan of subtasks that can be routed to specialist agents.

Available agents and their intents:
${availableCapabilities.map(c => `- ${c.agentId}: ${c.intents.join(', ')}`).join('\n')}

Respond with valid JSON matching this schema:
{
  "reasoning": "Brief explanation of why you chose this decomposition",
  "subtasks": [
    {
      "name": "Human-readable subtask description",
      "intent": "agent.intent.pattern",
      "dependsOnIndices": [],
      "constraints": []
    }
  ]
}

Rules:
1. Each subtask must have an intent that matches a registered agent's capability.
2. Use dependsOnIndices to express ordering — value is the 0-based index of another subtask.
3. Independent subtasks should have empty dependsOnIndices so they can run in parallel.
4. Constraints are optional. Use { "type": "max_time", "value": 30000 } for time limits.
5. If no specialist agent matches, use intent "general.task" as fallback.
6. Return ONLY the JSON object, no markdown fences or extra text.`,
        messages: [
          {
            role: 'user',
            content: `Intent: ${intent}\n\nContext:\n${context.map(c => `[${c.source}] ${c.content}`).join('\n\n')}`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.1,
      },
    };

    // ── Step 2: Build A2A fan-out from decomposition ───────────────────────
    // This is constructed as a template — the runtime will parse the LLM
    // output from step 1 and expand these into concrete A2A steps.
    // For plan construction, we build a representative set of a2a steps
    // based on what we can statically determine. The runtime expands
    // the actual steps after the LLM decomposition completes.
    const subtaskSteps = this.buildSubtaskSteps(intent, context, decompositionStep.id);

    // ── Step 3: Synthesize results ─────────────────────────────────────────
    const allSubtaskIds = subtaskSteps.map(s => s.id);
    const synthesizeStep: AgentStep = {
      id: uuid(),
      name: 'Synthesize agent results',
      type: 'llm',
      status: 'pending',
      dependsOn: [decompositionStep.id, ...allSubtaskIds],
      modelRequest: {
        systemPrompt: `You are Aahi's PlannerAgent in the synthesis phase. You have dispatched subtasks to specialist agents and now have their results. Synthesize all results into a coherent response for the user.

Guidelines:
1. Summarize what each agent found or accomplished.
2. Highlight any conflicts or inconsistencies between agent results.
3. Provide a unified recommendation or answer.
4. If any subtask failed, explain what went wrong and suggest next steps.
5. Be concise but thorough.`,
        messages: [
          {
            role: 'user',
            content: `Original intent: ${intent}\n\nAgent results will be injected by the runtime after subtask completion.`,
          },
        ],
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    return {
      id: planId,
      intent,
      steps: [decompositionStep, ...subtaskSteps, synthesizeStep],
      createdAt: new Date(),
      status: 'pending',
      agentId: this.id,
    };
  }

  /**
   * Build A2A subtask steps by matching the intent against registered agents.
   * Independent subtasks (no cross-dependencies) are wrapped in a parallel step
   * so the runtime can fan them out concurrently.
   */
  private buildSubtaskSteps(
    intent: string,
    context: ContextChunk[],
    decompositionStepId: string,
  ): AgentStep[] {
    const capable = this.registry.findAgents(intent);

    if (capable.length === 0) {
      // No agents match the top-level intent — return a single fallback step.
      return [this.createA2AStep(
        'Route to general agent',
        'general',
        intent,
        context,
        [decompositionStepId],
      )];
    }

    if (capable.length === 1) {
      // Single agent — direct dispatch, no parallelism needed.
      return [this.createA2AStep(
        `Dispatch to ${capable[0].agentId}`,
        capable[0].agentId,
        intent,
        context,
        [decompositionStepId],
      )];
    }

    // Multiple capable agents — fan out in parallel.
    const parallelSubSteps: AgentStep[] = capable.map(cap =>
      this.createA2AStep(
        `Dispatch to ${cap.agentId}`,
        cap.agentId,
        intent,
        context,
        [],
      ),
    );

    const parallelStep: AgentStep = {
      id: uuid(),
      name: 'Fan-out to specialist agents',
      type: 'parallel',
      status: 'pending',
      dependsOn: [decompositionStepId],
      parallelSteps: parallelSubSteps,
    };

    return [parallelStep];
  }

  /**
   * Create a single A2A dispatch step.
   */
  private createA2AStep(
    name: string,
    targetAgent: string,
    intent: string,
    context: ContextChunk[],
    dependsOn: string[],
    constraints: AgentConstraint[] = [{ type: 'max_time', value: 60_000 }],
  ): AgentStep {
    return {
      id: uuid(),
      name,
      type: 'a2a',
      status: 'pending',
      dependsOn,
      a2aMessage: {
        id: uuid(),
        fromAgent: this.id,
        toAgent: targetAgent,
        intent,
        context,
        constraints,
        timestamp: new Date(),
      },
    };
  }
}
