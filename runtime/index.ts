// ─────────────────────────────────────────────────────────────────────────────
// Aahi — AI-native Software Operations Platform
// The IDE that sees your living system.
// ─────────────────────────────────────────────────────────────────────────────

export { Aahi, default } from './aahi.js';
export type { AahiConfig } from './aahi.js';

// Model Layer
export {
  ModelRouter,
  AnthropicAdapter,
  OpenAIAdapter,
  OllamaAdapter,
} from './ai/models/index.js';
export type {
  AahiModelAdapter,
  ModelConfig,
  ModelRequest,
  ModelResponse,
  ModelChunk,
  TaskType,
  ModelRouterConfig,
} from './ai/models/index.js';

// Redaction Pipeline
export { RedactionPipeline } from './ai/redaction/index.js';
export type { RedactionResult, RedactionMatch } from './ai/redaction/index.js';

// Context Engine
export { ContextEngine, MentionParser, TokenBudgetManager } from './ai/context/index.js';
export type { ContextSource, ContextAssembly, Mention, MentionType } from './ai/context/index.js';

// Chat Service
export { ChatService, SlashCommandRouter } from './ai/chat/index.js';
export type { ChatMessage, ChatSession, SlashCommand } from './ai/chat/index.js';

// Integration Layer
export { IntegrationRegistry } from './integrations/registry/index.js';
export type {
  AahiIntegration,
  IntegrationCategory,
  Credentials,
  ContextChunk,
  AgentAction,
  ActionResult,
  ApprovalGate,
  SystemEvent,
} from './integrations/registry/index.js';

// Integrations — DevOps
export { GitHubIntegration, KubernetesIntegration, ArgoCDIntegration } from './integrations/devops/index.js';
export { MCPClientIntegration } from './integrations/mcp/index.js';

// Integrations — Observability
export { SentryIntegration } from './integrations/observability/index.js';
export { DatadogIntegration } from './integrations/observability/index.js';
export { PagerDutyIntegration } from './integrations/observability/index.js';

// Integrations — Collaboration
export { SlackIntegration } from './integrations/collaboration/index.js';
export { JiraIntegration } from './integrations/collaboration/index.js';

// Timeline Store
export { TimelineStore } from './intelligence/timeline/index.js';
export type { TimelineEvent, TimelineQuery, EventSource, EventCategory } from './intelligence/timeline/index.js';

// TeamBrain Knowledge Graph
export { KnowledgeGraph } from './intelligence/teambrain/index.js';
export type { ServiceOwnership, ExpertiseEntry, ArchitecturalDecision, IncidentLearning } from './intelligence/teambrain/index.js';

// Impact Engine
export { ImpactEngine } from './intelligence/impact/index.js';
export type { ImpactReport, ImpactWarning, HistoricalChange } from './intelligence/impact/index.js';

// Agent Runtime
export { DAGExecutor } from './agents/runtime/index.js';
export { CapabilityRegistry } from './agents/a2a/index.js';
export { AgentRegistry } from './agents/registry/index.js';
export type {
  ExecutionPlan,
  AgentStep,
  AgentDefinition,
  A2AMessage,
  AgentCallbacks,
} from './agents/runtime/index.js';

// Agents
export { PlannerAgent } from './agents/planner/index.js';
export { DebugAgent } from './agents/debug.agent.js';
export { TemporalAgent } from './agents/temporal.agent.js';
export { ProactiveAgent } from './agents/proactive.agent.js';
export { IncidentAgent } from './agents/incident.agent.js';
export { DeployAgent } from './agents/deploy.agent.js';
export { ReviewAgent } from './agents/review.agent.js';
export { SecurityAgent } from './agents/security.agent.js';
export { ImpactAgent } from './agents/impact.agent.js';
export { CostAgent } from './agents/cost.agent.js';
export { QueryAgent } from './agents/query.agent.js';
export { ScaffoldAgent } from './agents/scaffold.agent.js';
export { ReleaseAgent } from './agents/release.agent.js';
export { OnCallAgent } from './agents/oncall.agent.js';
export { FeatureFlagAgent } from './agents/featureflag.agent.js';
export { CustomAgentLoader } from './agents/custom.agent.js';
