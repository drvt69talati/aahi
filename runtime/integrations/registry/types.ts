// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Integration Layer Types
// ─────────────────────────────────────────────────────────────────────────────

export type IntegrationCategory =
  | 'cloud'
  | 'devops'
  | 'observability'
  | 'database'
  | 'collaboration'
  | 'security'
  | 'custom';

export type DataType = 'logs' | 'traces' | 'metrics' | 'events' | 'code' | 'infra';

export type AuthMethod = 'apiKey' | 'oauth2' | 'token' | 'webhook' | 'mcp';

export type PermissionLevel = 'read' | 'read-write';

export interface Credentials {
  type: AuthMethod;
  apiKey?: string;
  token?: string;
  oauth2?: {
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    refreshToken?: string;
    tokenUrl: string;
  };
  webhookSecret?: string;
}

export interface ConnectionResult {
  connected: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  lastChecked: Date;
  error?: string;
}

export interface ContextQuery {
  type: DataType;
  timeRange?: { start: Date; end: Date };
  filters?: Record<string, string>;
  limit?: number;
  query?: string;
}

export interface ContextChunk {
  source: string;
  type: DataType;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  tokenEstimate?: number;
}

export interface AgentAction {
  id: string;
  name: string;
  description: string;
  category: 'read' | 'write' | 'destructive';
  params: ActionParamDef[];
  requiresApproval: boolean;
}

export interface ActionParamDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ActionParams {
  [key: string]: unknown;
}

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
}

export interface RedactionRule {
  pattern: RegExp;
  replacement: string;
  description: string;
}

export interface SystemEvent {
  id: string;
  source: string;
  type: string;
  timestamp: Date;
  data: Record<string, unknown>;
  severity?: 'info' | 'warning' | 'error' | 'critical';
}

export interface ApprovalGate {
  actionId: string;
  integration: string;
  actionType: 'read' | 'write' | 'destructive';
  description: string;
  params: ActionParams;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  requiresTypedConfirmation: boolean;
  timeout: number;
  alternativeIfDeclined?: AgentAction;
}

export type EventHandler = (event: SystemEvent) => void;

/**
 * Core integration interface — every Aahi integration implements this.
 * Read-only by default. Write actions are explicitly declared and approval-gated.
 */
export interface AahiIntegration {
  readonly id: string;
  readonly name: string;
  readonly category: IntegrationCategory;
  readonly authMethod: AuthMethod;
  readonly dataTypes: DataType[];
  readonly permissions: PermissionLevel;
  readonly redactionRules: RedactionRule[];
  readonly readActions: AgentAction[];
  readonly writeActions: AgentAction[];

  connect(credentials: Credentials): Promise<ConnectionResult>;
  disconnect(): Promise<void>;
  fetchContext(query: ContextQuery): Promise<ContextChunk[]>;
  executeAction(
    action: AgentAction,
    params: ActionParams,
    approval: ApprovalGate,
  ): Promise<ActionResult>;
  streamEvents(handler: EventHandler): AsyncIterable<SystemEvent>;
  healthCheck(): Promise<HealthStatus>;
}
