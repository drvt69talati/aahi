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

// Integrations
export { GitHubIntegration } from './integrations/devops/index.js';
export { KubernetesIntegration } from './integrations/devops/index.js';
export { MCPClientIntegration } from './integrations/mcp/index.js';

// Timeline Store
export { TimelineStore } from './intelligence/timeline/index.js';
export type { TimelineEvent, TimelineQuery, EventSource, EventCategory } from './intelligence/timeline/index.js';

// Agent Runtime
export { DAGExecutor } from './agents/runtime/index.js';
export { CapabilityRegistry } from './agents/a2a/index.js';
export type {
  ExecutionPlan,
  AgentStep,
  AgentDefinition,
  A2AMessage,
  AgentCallbacks,
} from './agents/runtime/index.js';

// Agents
export { DebugAgent } from './agents/debug.agent.js';
export { TemporalAgent } from './agents/temporal.agent.js';
export { ProactiveAgent } from './agents/proactive.agent.js';
