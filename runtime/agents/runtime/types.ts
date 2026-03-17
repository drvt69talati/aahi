// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Agent Runtime Types
// DAG-based execution engine with approval gates and A2A protocol.
// ─────────────────────────────────────────────────────────────────────────────

import type { AahiModelAdapter, ModelRequest, ModelResponse } from '../../ai/models/types.js';
import type { ApprovalGate, ActionResult, ContextChunk } from '../../integrations/registry/types.js';

export type AgentStatus = 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export type StepType = 'llm' | 'tool' | 'parallel' | 'conditional' | 'a2a';

export interface AgentStep {
  id: string;
  name: string;
  type: StepType;
  status: AgentStatus;
  /** IDs of steps that must complete before this one */
  dependsOn: string[];
  /** For 'llm' steps */
  modelRequest?: ModelRequest;
  /** For 'tool' steps */
  toolAction?: {
    integrationId: string;
    actionId: string;
    params: Record<string, unknown>;
  };
  /** For 'parallel' steps — sub-steps to run concurrently */
  parallelSteps?: AgentStep[];
  /** For 'conditional' steps */
  condition?: {
    expression: string;
    thenStep: AgentStep;
    elseStep?: AgentStep;
  };
  /** For 'a2a' steps */
  a2aMessage?: A2AMessage;
  /** Approval gate if this step requires user approval */
  approvalGate?: ApprovalGate;
  /** Result after execution */
  result?: StepResult;
  /** Timing */
  startedAt?: Date;
  completedAt?: Date;
}

export interface StepResult {
  success: boolean;
  data: unknown;
  error?: string;
  modelResponse?: ModelResponse;
  actionResult?: ActionResult;
  a2aResponse?: A2AMessage;
}

export interface ExecutionPlan {
  id: string;
  intent: string;
  steps: AgentStep[];
  createdAt: Date;
  status: AgentStatus;
  agentId: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  requiredIntegrations: string[];
  capabilities: string[];
  defaultModel?: string;

  /**
   * Build an execution plan for the given intent and context.
   */
  plan(intent: string, context: ContextChunk[]): Promise<ExecutionPlan>;
}

// ─── A2A Protocol ───────────────────────────────────────────────────────────

export interface A2AMessage {
  id: string;
  fromAgent: string;
  toAgent: string;
  intent: string;
  context: ContextChunk[];
  constraints: AgentConstraint[];
  replyTo?: string;
  timestamp: Date;
}

export interface AgentConstraint {
  type: 'max_time' | 'max_cost' | 'required_approval' | 'read_only' | 'custom';
  value: unknown;
}

export interface AgentCapability {
  agentId: string;
  intents: string[];
  requiredIntegrations: string[];
  outputSchema?: Record<string, unknown>;
}

// ─── Activity Log ───────────────────────────────────────────────────────────

export interface AgentActivityEntry {
  id: string;
  timestamp: Date;
  agentId: string;
  planId: string;
  stepId: string;
  action: string;
  params: Record<string, unknown>;
  result: StepResult;
  approvalStatus?: 'approved' | 'declined' | 'auto';
  durationMs: number;
}

// ─── Callbacks ──────────────────────────────────────────────────────────────

export interface AgentCallbacks {
  onStepStart?(step: AgentStep): void;
  onStepComplete?(step: AgentStep, result: StepResult): void;
  onApprovalRequired?(gate: ApprovalGate): Promise<boolean>;
  onPlanCreated?(plan: ExecutionPlan): void;
  onAgentComplete?(plan: ExecutionPlan): void;
  onError?(step: AgentStep, error: Error): void;
}
