// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Datadog Integration
// Read + write for Datadog metrics, logs, monitors, traces, and incidents.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AahiIntegration,
  IntegrationCategory,
  AuthMethod,
  DataType,
  PermissionLevel,
  Credentials,
  ConnectionResult,
  HealthStatus,
  ContextQuery,
  ContextChunk,
  AgentAction,
  ActionParams,
  ActionResult,
  RedactionRule,
  SystemEvent,
  ApprovalGate,
  EventHandler,
} from '../registry/types.js';

export class DatadogIntegration implements AahiIntegration {
  readonly id = 'datadog';
  readonly name = 'Datadog';
  readonly category: IntegrationCategory = 'observability';
  readonly authMethod: AuthMethod = 'apiKey';
  readonly dataTypes: DataType[] = ['logs', 'metrics', 'traces', 'events'];
  readonly permissions: PermissionLevel = 'read';

  readonly redactionRules: RedactionRule[] = [
    { pattern: /[a-f0-9]{32}/g, replacement: '<DD_API_KEY>', description: 'Datadog API key' },
    { pattern: /[a-f0-9]{40}/g, replacement: '<DD_APP_KEY>', description: 'Datadog application key' },
  ];

  readonly readActions: AgentAction[] = [
    {
      id: 'datadog.query_metrics',
      name: 'Query Metrics',
      description: 'Query Datadog metrics using a metrics query string',
      category: 'read',
      params: [
        { name: 'query', type: 'string', description: 'Datadog metrics query (e.g. avg:system.cpu.user{*})', required: true },
        { name: 'from', type: 'number', description: 'Start time as UNIX epoch seconds', required: true },
        { name: 'to', type: 'number', description: 'End time as UNIX epoch seconds', required: true },
      ],
      requiresApproval: false,
    },
    {
      id: 'datadog.search_logs',
      name: 'Search Logs',
      description: 'Search Datadog logs using a query string',
      category: 'read',
      params: [
        { name: 'query', type: 'string', description: 'Log search query', required: true },
        { name: 'from', type: 'string', description: 'Start time (ISO 8601)', required: true },
        { name: 'to', type: 'string', description: 'End time (ISO 8601)', required: true },
        { name: 'limit', type: 'number', description: 'Max logs to return', required: false, default: 50 },
      ],
      requiresApproval: false,
    },
    {
      id: 'datadog.list_monitors',
      name: 'List Monitors',
      description: 'List all Datadog monitors, optionally filtered by tags',
      category: 'read',
      params: [
        { name: 'tags', type: 'string', description: 'Comma-separated tag filters', required: false },
        { name: 'name', type: 'string', description: 'Filter by monitor name substring', required: false },
      ],
      requiresApproval: false,
    },
    {
      id: 'datadog.get_monitor',
      name: 'Get Monitor',
      description: 'Fetch details for a specific Datadog monitor',
      category: 'read',
      params: [
        { name: 'monitor_id', type: 'number', description: 'Datadog monitor ID', required: true },
      ],
      requiresApproval: false,
    },
    {
      id: 'datadog.list_incidents',
      name: 'List Incidents',
      description: 'List active Datadog incidents',
      category: 'read',
      params: [
        { name: 'page_size', type: 'number', description: 'Number of incidents per page', required: false, default: 25 },
        { name: 'page_offset', type: 'number', description: 'Page offset', required: false, default: 0 },
      ],
      requiresApproval: false,
    },
  ];

  readonly writeActions: AgentAction[] = [
    {
      id: 'datadog.create_monitor',
      name: 'Create Monitor',
      description: 'Create a new Datadog monitor',
      category: 'write',
      params: [
        { name: 'name', type: 'string', description: 'Monitor name', required: true },
        { name: 'type', type: 'string', description: 'Monitor type (metric alert, service check, etc.)', required: true },
        { name: 'query', type: 'string', description: 'Monitor query', required: true },
        { name: 'message', type: 'string', description: 'Notification message (supports @-mentions)', required: true },
        { name: 'tags', type: 'array', description: 'Tags to associate with the monitor', required: false },
      ],
      requiresApproval: true,
    },
    {
      id: 'datadog.mute_monitor',
      name: 'Mute Monitor',
      description: 'Mute a Datadog monitor to suppress notifications',
      category: 'write',
      params: [
        { name: 'monitor_id', type: 'number', description: 'Datadog monitor ID', required: true },
        { name: 'end', type: 'number', description: 'UNIX timestamp when mute should end (omit for indefinite)', required: false },
        { name: 'scope', type: 'string', description: 'Scope to mute (e.g. host:myhost)', required: false },
      ],
      requiresApproval: true,
    },
  ];

  private apiKey: string | null = null;
  private appKey: string | null = null;
  private baseUrl = 'https://api.datadoghq.com';

  async connect(credentials: Credentials): Promise<ConnectionResult> {
    this.apiKey = credentials.apiKey ?? null;
    this.appKey = credentials.token ?? null;
    if (!this.apiKey || !this.appKey) {
      return { connected: false, error: 'Datadog API key and application key are required' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/validate`, {
        headers: this.headers(),
      });

      if (!response.ok) {
        return { connected: false, error: `Datadog auth failed: ${response.status}` };
      }

      const result = await response.json() as Record<string, any>;
      return {
        connected: true,
        metadata: { valid: result.valid },
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disconnect(): Promise<void> {
    this.apiKey = null;
    this.appKey = null;
  }

  async fetchContext(query: ContextQuery): Promise<ContextChunk[]> {
    // Fetch relevant Datadog context based on query type
    return [];
  }

  async executeAction(
    action: AgentAction,
    params: ActionParams,
    _approval: ApprovalGate,
  ): Promise<ActionResult> {
    const start = Date.now();

    try {
      switch (action.id) {
        case 'datadog.query_metrics':
          return await this.queryMetrics(params, start);
        case 'datadog.search_logs':
          return await this.searchLogs(params, start);
        case 'datadog.list_monitors':
          return await this.listMonitors(params, start);
        case 'datadog.get_monitor':
          return await this.getMonitor(params, start);
        case 'datadog.list_incidents':
          return await this.listIncidents(params, start);
        case 'datadog.create_monitor':
          return await this.createMonitor(params, start);
        case 'datadog.mute_monitor':
          return await this.muteMonitor(params, start);
        default:
          return { success: false, error: `Unknown action: ${action.id}`, duration: Date.now() - start };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  }

  async *streamEvents(_handler: EventHandler): AsyncIterable<SystemEvent> {
    // In production, this would use Datadog webhooks
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/validate`, {
        headers: this.headers(),
      });
      return {
        healthy: response.ok,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        error: response.ok ? undefined : `Status ${response.status}`,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ─── Action Implementations ─────────────────────────────────────────────

  private async queryMetrics(params: ActionParams, start: number): Promise<ActionResult> {
    const query = encodeURIComponent(params.query as string);
    const data = await this.apiGet(
      `/api/v1/query?query=${query}&from=${params.from}&to=${params.to}`
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async searchLogs(params: ActionParams, start: number): Promise<ActionResult> {
    const limit = (params.limit as number) ?? 50;
    const data = await this.apiPost('/api/v2/logs/events/search', {
      filter: {
        query: params.query,
        from: params.from,
        to: params.to,
      },
      page: { limit },
    });
    return { success: true, data, duration: Date.now() - start };
  }

  private async listMonitors(params: ActionParams, start: number): Promise<ActionResult> {
    const queryParts: string[] = [];
    if (params.tags) queryParts.push(`tags=${encodeURIComponent(params.tags as string)}`);
    if (params.name) queryParts.push(`name=${encodeURIComponent(params.name as string)}`);
    const query = queryParts.length ? `?${queryParts.join('&')}` : '';
    const data = await this.apiGet(`/api/v1/monitor${query}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async getMonitor(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiGet(`/api/v1/monitor/${params.monitor_id}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async listIncidents(params: ActionParams, start: number): Promise<ActionResult> {
    const pageSize = (params.page_size as number) ?? 25;
    const pageOffset = (params.page_offset as number) ?? 0;
    const data = await this.apiGet(
      `/api/v2/incidents?page[size]=${pageSize}&page[offset]=${pageOffset}`
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async createMonitor(params: ActionParams, start: number): Promise<ActionResult> {
    const body: Record<string, unknown> = {
      name: params.name,
      type: params.type,
      query: params.query,
      message: params.message,
    };
    if (params.tags) body.tags = params.tags;
    const data = await this.apiPost('/api/v1/monitor', body);
    return { success: true, data, duration: Date.now() - start };
  }

  private async muteMonitor(params: ActionParams, start: number): Promise<ActionResult> {
    const body: Record<string, unknown> = {};
    if (params.end) body.end = params.end;
    if (params.scope) body.scope = params.scope;
    const data = await this.apiPost(`/api/v1/monitor/${params.monitor_id}/mute`, body);
    return { success: true, data, duration: Date.now() - start };
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) h['DD-API-KEY'] = this.apiKey;
    if (this.appKey) h['DD-APPLICATION-KEY'] = this.appKey;
    return h;
  }

  private async apiGet(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`Datadog API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  private async apiPost(
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Datadog API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }
}
