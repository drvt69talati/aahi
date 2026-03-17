// ─────────────────────────────────────────────────────────────────────────────
// Aahi — PagerDuty Integration
// Read + write for PagerDuty incidents, on-calls, and services.
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

export class PagerDutyIntegration implements AahiIntegration {
  readonly id = 'pagerduty';
  readonly name = 'PagerDuty';
  readonly category: IntegrationCategory = 'observability';
  readonly authMethod: AuthMethod = 'token';
  readonly dataTypes: DataType[] = ['events'];
  readonly permissions: PermissionLevel = 'read';

  readonly redactionRules: RedactionRule[] = [
    { pattern: /[a-zA-Z0-9+/]{20}\+[a-zA-Z0-9+/]{20}/g, replacement: '<PD_API_KEY>', description: 'PagerDuty REST API key' },
    { pattern: /[a-f0-9]{32}/g, replacement: '<PD_INTEGRATION_KEY>', description: 'PagerDuty integration/routing key' },
  ];

  readonly readActions: AgentAction[] = [
    {
      id: 'pagerduty.list_incidents',
      name: 'List Incidents',
      description: 'List PagerDuty incidents, optionally filtered by status or urgency',
      category: 'read',
      params: [
        { name: 'statuses', type: 'string', description: 'Comma-separated statuses (triggered, acknowledged, resolved)', required: false, default: 'triggered,acknowledged' },
        { name: 'urgencies', type: 'string', description: 'Comma-separated urgencies (high, low)', required: false },
        { name: 'limit', type: 'number', description: 'Max incidents to return', required: false, default: 25 },
      ],
      requiresApproval: false,
    },
    {
      id: 'pagerduty.get_incident',
      name: 'Get Incident',
      description: 'Fetch details for a specific PagerDuty incident',
      category: 'read',
      params: [
        { name: 'incident_id', type: 'string', description: 'PagerDuty incident ID', required: true },
      ],
      requiresApproval: false,
    },
    {
      id: 'pagerduty.list_oncalls',
      name: 'List On-Calls',
      description: 'List current on-call entries across escalation policies',
      category: 'read',
      params: [
        { name: 'escalation_policy_ids', type: 'string', description: 'Comma-separated escalation policy IDs to filter', required: false },
        { name: 'schedule_ids', type: 'string', description: 'Comma-separated schedule IDs to filter', required: false },
      ],
      requiresApproval: false,
    },
    {
      id: 'pagerduty.get_service',
      name: 'Get Service',
      description: 'Fetch details for a specific PagerDuty service',
      category: 'read',
      params: [
        { name: 'service_id', type: 'string', description: 'PagerDuty service ID', required: true },
      ],
      requiresApproval: false,
    },
  ];

  readonly writeActions: AgentAction[] = [
    {
      id: 'pagerduty.acknowledge_incident',
      name: 'Acknowledge Incident',
      description: 'Acknowledge a triggered PagerDuty incident',
      category: 'write',
      params: [
        { name: 'incident_id', type: 'string', description: 'PagerDuty incident ID', required: true },
        { name: 'from', type: 'string', description: 'Email of the user performing the action', required: true },
      ],
      requiresApproval: true,
    },
    {
      id: 'pagerduty.resolve_incident',
      name: 'Resolve Incident',
      description: 'Resolve a PagerDuty incident',
      category: 'write',
      params: [
        { name: 'incident_id', type: 'string', description: 'PagerDuty incident ID', required: true },
        { name: 'from', type: 'string', description: 'Email of the user performing the action', required: true },
      ],
      requiresApproval: true,
    },
    {
      id: 'pagerduty.create_incident',
      name: 'Create Incident',
      description: 'Create a new PagerDuty incident',
      category: 'write',
      params: [
        { name: 'title', type: 'string', description: 'Incident title', required: true },
        { name: 'service_id', type: 'string', description: 'PagerDuty service ID to create incident on', required: true },
        { name: 'urgency', type: 'string', description: 'Incident urgency (high or low)', required: false, default: 'high' },
        { name: 'body', type: 'string', description: 'Incident body/details', required: false },
        { name: 'from', type: 'string', description: 'Email of the user creating the incident', required: true },
      ],
      requiresApproval: true,
    },
  ];

  private token: string | null = null;
  private baseUrl = 'https://api.pagerduty.com';

  async connect(credentials: Credentials): Promise<ConnectionResult> {
    this.token = credentials.token ?? credentials.apiKey ?? null;
    if (!this.token) {
      return { connected: false, error: 'PagerDuty API token is required' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/abilities`, {
        headers: this.headers(),
      });

      if (!response.ok) {
        return { connected: false, error: `PagerDuty auth failed: ${response.status}` };
      }

      const result = await response.json() as Record<string, any>;
      return {
        connected: true,
        metadata: { abilities: result.abilities },
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disconnect(): Promise<void> {
    this.token = null;
  }

  async fetchContext(query: ContextQuery): Promise<ContextChunk[]> {
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
        case 'pagerduty.list_incidents':
          return await this.listIncidents(params, start);
        case 'pagerduty.get_incident':
          return await this.getIncident(params, start);
        case 'pagerduty.list_oncalls':
          return await this.listOncalls(params, start);
        case 'pagerduty.get_service':
          return await this.getService(params, start);
        case 'pagerduty.acknowledge_incident':
          return await this.updateIncidentStatus(params, 'acknowledged', start);
        case 'pagerduty.resolve_incident':
          return await this.updateIncidentStatus(params, 'resolved', start);
        case 'pagerduty.create_incident':
          return await this.createIncident(params, start);
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
    // In production, this would use PagerDuty webhooks v3
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/abilities`, {
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

  private async listIncidents(params: ActionParams, start: number): Promise<ActionResult> {
    const queryParts: string[] = [];
    const statuses = ((params.statuses as string) ?? 'triggered,acknowledged').split(',');
    for (const s of statuses) {
      queryParts.push(`statuses[]=${s.trim()}`);
    }
    if (params.urgencies) {
      const urgencies = (params.urgencies as string).split(',');
      for (const u of urgencies) {
        queryParts.push(`urgencies[]=${u.trim()}`);
      }
    }
    queryParts.push(`limit=${(params.limit as number) ?? 25}`);
    const data = await this.apiGet(`/incidents?${queryParts.join('&')}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async getIncident(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiGet(`/incidents/${params.incident_id}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async listOncalls(params: ActionParams, start: number): Promise<ActionResult> {
    const queryParts: string[] = [];
    if (params.escalation_policy_ids) {
      const ids = (params.escalation_policy_ids as string).split(',');
      for (const id of ids) {
        queryParts.push(`escalation_policy_ids[]=${id.trim()}`);
      }
    }
    if (params.schedule_ids) {
      const ids = (params.schedule_ids as string).split(',');
      for (const id of ids) {
        queryParts.push(`schedule_ids[]=${id.trim()}`);
      }
    }
    const query = queryParts.length ? `?${queryParts.join('&')}` : '';
    const data = await this.apiGet(`/oncalls${query}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async getService(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiGet(`/services/${params.service_id}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async updateIncidentStatus(
    params: ActionParams,
    status: string,
    start: number,
  ): Promise<ActionResult> {
    const data = await this.apiPut(
      `/incidents/${params.incident_id}`,
      {
        incident: {
          type: 'incident_reference',
          status,
        },
      },
      params.from as string,
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async createIncident(params: ActionParams, start: number): Promise<ActionResult> {
    const incident: Record<string, unknown> = {
      type: 'incident',
      title: params.title,
      service: {
        id: params.service_id,
        type: 'service_reference',
      },
      urgency: (params.urgency as string) ?? 'high',
    };
    if (params.body) {
      incident.body = { type: 'incident_body', details: params.body };
    }
    const data = await this.apiPost('/incidents', { incident }, params.from as string);
    return { success: true, data, duration: Date.now() - start };
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────

  private headers(from?: string): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.pagerduty+json;version=2',
    };
    if (this.token) h['Authorization'] = `Token token=${this.token}`;
    if (from) h['From'] = from;
    return h;
  }

  private async apiGet(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`PagerDuty API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  private async apiPost(
    path: string,
    body: Record<string, unknown>,
    from?: string,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(from),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`PagerDuty API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  private async apiPut(
    path: string,
    body: Record<string, unknown>,
    from?: string,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: this.headers(from),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`PagerDuty API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }
}
