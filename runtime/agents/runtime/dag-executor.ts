// ─────────────────────────────────────────────────────────────────────────────
// Aahi — DAG Executor
// Executes agent plans as directed acyclic graphs with parallel execution,
// approval gates, and A2A message passing.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type {
  ExecutionPlan,
  AgentStep,
  StepResult,
  AgentCallbacks,
  AgentActivityEntry,
  A2AMessage,
} from './types.js';
import type { AahiModelAdapter } from '../../ai/models/types.js';
import type { IntegrationRegistry } from '../../integrations/registry/integration-registry.js';
import type { RedactionPipeline } from '../../ai/redaction/redaction-pipeline.js';

export class DAGExecutor {
  private activityLog: AgentActivityEntry[] = [];
  private aborted = false;

  constructor(
    private modelAdapter: AahiModelAdapter,
    private integrationRegistry: IntegrationRegistry,
    private redactionPipeline: RedactionPipeline,
    private callbacks: AgentCallbacks = {},
    private a2aHandler?: (message: A2AMessage) => Promise<A2AMessage>,
  ) {}

  /**
   * Execute an entire plan. Respects dependencies, runs parallel branches
   * concurrently, and gates destructive actions through approval.
   */
  async execute(plan: ExecutionPlan): Promise<ExecutionPlan> {
    this.aborted = false;
    this.validatePlan(plan);
    plan.status = 'running';
    this.callbacks.onPlanCreated?.(plan);

    try {
      await this.executeSteps(plan.steps, plan.id);
      plan.status = plan.steps.every(s => s.status === 'completed') ? 'completed' : 'failed';
    } catch (error) {
      plan.status = 'failed';
      throw error;
    } finally {
      this.callbacks.onAgentComplete?.(plan);
    }

    return plan;
  }

  /**
   * Abort execution of the current plan.
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Get the immutable activity log for audit purposes.
   */
  getActivityLog(): readonly AgentActivityEntry[] {
    return this.activityLog;
  }

  /**
   * Validate the execution plan before running.
   * Checks for cycles, missing dependencies, and invalid step configurations.
   */
  private validatePlan(plan: ExecutionPlan): void {
    const stepIds = new Set(plan.steps.map(s => s.id));

    // Check for missing dependency references
    for (const step of plan.steps) {
      for (const dep of step.dependsOn) {
        if (!stepIds.has(dep)) {
          throw new Error(
            `Step "${step.name}" (${step.id}) depends on unknown step "${dep}"`
          );
        }
      }
      // Validate step has required config for its type
      if (step.type === 'tool' && !step.toolAction) {
        throw new Error(`Step "${step.name}" is type "tool" but has no toolAction`);
      }
      if (step.type === 'llm' && !step.modelRequest) {
        throw new Error(`Step "${step.name}" is type "llm" but has no modelRequest`);
      }
      if (step.type === 'a2a' && !step.a2aMessage) {
        throw new Error(`Step "${step.name}" is type "a2a" but has no a2aMessage`);
      }
    }

    // Cycle detection using DFS with coloring
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const step of plan.steps) {
      color.set(step.id, WHITE);
    }

    const depsMap = new Map<string, string[]>();
    for (const step of plan.steps) {
      depsMap.set(step.id, step.dependsOn);
    }

    function hasCycle(nodeId: string): boolean {
      color.set(nodeId, GRAY);
      for (const dep of depsMap.get(nodeId) ?? []) {
        if (color.get(dep) === GRAY) return true; // back edge = cycle
        if (color.get(dep) === WHITE && hasCycle(dep)) return true;
      }
      color.set(nodeId, BLACK);
      return false;
    }

    for (const step of plan.steps) {
      if (color.get(step.id) === WHITE && hasCycle(step.id)) {
        throw new Error(
          `Cycle detected in execution plan "${plan.id}": step "${step.name}" is part of a dependency cycle`
        );
      }
    }
  }

  private async executeSteps(steps: AgentStep[], planId: string): Promise<void> {
    // Build dependency graph
    const completed = new Set<string>();
    const remaining = new Map(steps.map(s => [s.id, s]));

    while (remaining.size > 0) {
      if (this.aborted) {
        for (const step of remaining.values()) {
          step.status = 'cancelled';
        }
        return;
      }

      // Find all steps whose dependencies are satisfied
      const ready: AgentStep[] = [];
      for (const step of remaining.values()) {
        if (step.dependsOn.every(dep => completed.has(dep))) {
          ready.push(step);
        }
      }

      if (ready.length === 0) {
        // Deadlock — remaining steps have unsatisfied deps
        for (const step of remaining.values()) {
          step.status = 'failed';
          step.result = {
            success: false,
            data: null,
            error: 'Deadlock: unsatisfied dependencies',
          };
        }
        return;
      }

      // Execute ready steps in parallel
      await Promise.allSettled(
        ready.map(step => this.executeStep(step, planId))
      );

      for (const step of ready) {
        remaining.delete(step.id);
        if (step.status === 'completed') {
          completed.add(step.id);
        }
      }
    }
  }

  private async executeStep(step: AgentStep, planId: string): Promise<void> {
    step.status = 'running';
    step.startedAt = new Date();
    this.callbacks.onStepStart?.(step);

    try {
      // Check approval gate
      if (step.approvalGate) {
        step.status = 'waiting_approval';
        const approved = await this.requestApproval(step);
        if (!approved) {
          step.status = 'cancelled';
          step.result = { success: false, data: null, error: 'User declined approval' };
          this.logActivity(step, planId, 'declined');
          return;
        }
      }

      let result: StepResult;

      switch (step.type) {
        case 'llm':
          result = await this.executeLLMStep(step);
          break;
        case 'tool':
          result = await this.executeToolStep(step);
          break;
        case 'parallel':
          result = await this.executeParallelStep(step, planId);
          break;
        case 'conditional':
          result = await this.executeConditionalStep(step, planId);
          break;
        case 'a2a':
          result = await this.executeA2AStep(step);
          break;
        default:
          result = { success: false, data: null, error: `Unknown step type: ${step.type}` };
      }

      step.result = result;
      step.status = result.success ? 'completed' : 'failed';
      step.completedAt = new Date();

      this.callbacks.onStepComplete?.(step, result);
      this.logActivity(step, planId, step.approvalGate ? 'approved' : 'auto');
    } catch (error) {
      step.status = 'failed';
      step.completedAt = new Date();
      const err = error instanceof Error ? error : new Error(String(error));
      step.result = { success: false, data: null, error: err.message };
      this.callbacks.onError?.(step, err);
      this.logActivity(step, planId, 'auto');
    }
  }

  private async executeLLMStep(step: AgentStep): Promise<StepResult> {
    if (!step.modelRequest) {
      return { success: false, data: null, error: 'No model request provided' };
    }

    // Redact all message content before sending to LLM
    const redactedRequest = { ...step.modelRequest };
    redactedRequest.messages = redactedRequest.messages.map(msg => {
      if (typeof msg.content === 'string') {
        const { sanitized } = this.redactionPipeline.redact(msg.content);
        return { ...msg, content: sanitized };
      }
      if (Array.isArray(msg.content)) {
        // Redact text blocks, strip image blocks (images can contain visible secrets)
        const redactedBlocks = msg.content.map(block => {
          if (block.type === 'text' && block.text) {
            const { sanitized } = this.redactionPipeline.redact(block.text);
            return { ...block, text: sanitized };
          }
          if (block.type === 'tool_result' && block.content) {
            const { sanitized } = this.redactionPipeline.redact(
              typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
            );
            return { ...block, content: sanitized };
          }
          // Images pass through — can't redact binary data
          // But we could add a flag to strip images if desired
          return block;
        });
        return { ...msg, content: redactedBlocks };
      }
      return msg;
    });

    if (redactedRequest.systemPrompt) {
      const { sanitized } = this.redactionPipeline.redact(redactedRequest.systemPrompt);
      redactedRequest.systemPrompt = sanitized;
    }

    const response = await this.modelAdapter.call(redactedRequest);
    return {
      success: true,
      data: response.content,
      modelResponse: response,
    };
  }

  private async executeToolStep(step: AgentStep): Promise<StepResult> {
    if (!step.toolAction) {
      return { success: false, data: null, error: 'No tool action provided' };
    }

    const integration = this.integrationRegistry.get(step.toolAction.integrationId);
    if (!integration) {
      return {
        success: false,
        data: null,
        error: `Integration "${step.toolAction.integrationId}" not found`,
      };
    }

    const action = [...integration.readActions, ...integration.writeActions]
      .find(a => a.id === step.toolAction!.actionId);

    if (!action) {
      return {
        success: false,
        data: null,
        error: `Action "${step.toolAction.actionId}" not found in integration "${step.toolAction.integrationId}"`,
      };
    }

    const gate = step.approvalGate ?? {
      actionId: action.id,
      integration: integration.id,
      actionType: action.category,
      description: `${action.name}: ${action.description}`,
      params: step.toolAction.params,
      riskLevel: action.category === 'destructive' ? 'critical' : action.category === 'write' ? 'medium' : 'low',
      requiresApproval: action.category !== 'read',
      requiresTypedConfirmation: action.category === 'destructive',
      timeout: 120_000,
    };

    let actionResult = await integration.executeAction(action, step.toolAction.params, gate);

    // Redact sensitive data from the integration response
    if (actionResult.data) {
      const dataStr = typeof actionResult.data === 'string'
        ? actionResult.data
        : JSON.stringify(actionResult.data);
      if (this.redactionPipeline.hasSensitiveData(dataStr)) {
        const { sanitized } = this.redactionPipeline.redact(dataStr);
        actionResult = { ...actionResult, data: JSON.parse(sanitized) };
      }
    }

    return {
      success: actionResult.success,
      data: actionResult.data,
      error: actionResult.error,
      actionResult,
    };
  }

  private async executeParallelStep(step: AgentStep, planId: string): Promise<StepResult> {
    if (!step.parallelSteps || step.parallelSteps.length === 0) {
      return { success: true, data: [] };
    }

    await Promise.allSettled(
      step.parallelSteps.map(s => this.executeStep(s, planId))
    );

    const allSucceeded = step.parallelSteps.every(s => s.status === 'completed');
    return {
      success: allSucceeded,
      data: step.parallelSteps.map(s => s.result),
      error: allSucceeded ? undefined : 'One or more parallel steps failed',
    };
  }

  private async executeConditionalStep(step: AgentStep, planId: string): Promise<StepResult> {
    if (!step.condition) {
      return { success: false, data: null, error: 'No condition provided' };
    }

    // Simple expression evaluation (extend as needed)
    const conditionMet = this.evaluateCondition(step.condition.expression);

    const targetStep = conditionMet ? step.condition.thenStep : step.condition.elseStep;
    if (!targetStep) {
      return { success: true, data: null };
    }

    await this.executeStep(targetStep, planId);
    return targetStep.result ?? { success: false, data: null, error: 'No result from conditional branch' };
  }

  private async executeA2AStep(step: AgentStep): Promise<StepResult> {
    if (!step.a2aMessage) {
      return { success: false, data: null, error: 'No A2A message provided' };
    }

    if (!this.a2aHandler) {
      return { success: false, data: null, error: 'No A2A handler registered' };
    }

    const response = await this.a2aHandler(step.a2aMessage);
    return {
      success: true,
      data: response,
      a2aResponse: response,
    };
  }

  private async requestApproval(step: AgentStep): Promise<boolean> {
    if (!this.callbacks.onApprovalRequired || !step.approvalGate) {
      // No approval callback — reject by default for safety
      return false;
    }

    return this.callbacks.onApprovalRequired(step.approvalGate);
  }

  private evaluateCondition(expression: string): boolean {
    // Simple truthy check — in production, use a safe expression evaluator
    return expression === 'true' || expression === '1';
  }

  private logActivity(
    step: AgentStep,
    planId: string,
    approvalStatus: 'approved' | 'declined' | 'auto',
  ): void {
    const entry: AgentActivityEntry = {
      id: uuid(),
      timestamp: new Date(),
      agentId: step.name,
      planId,
      stepId: step.id,
      action: `${step.type}:${step.name}`,
      params: step.toolAction?.params ?? {},
      result: step.result ?? { success: false, data: null },
      approvalStatus,
      durationMs: step.startedAt && step.completedAt
        ? step.completedAt.getTime() - step.startedAt.getTime()
        : 0,
    };

    this.activityLog.push(entry);
  }
}
