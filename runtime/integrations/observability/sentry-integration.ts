// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Sentry Integration
// Read + write for Sentry issues, events, traces, and projects.
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

export class SentryIntegration implements AahiIntegration {
  readonly id = 'sentry';
  readonly name = 'Sentry';
  readonly category: IntegrationCategory = 'observability';
  readonly authMethod: AuthMethod = 'token';
  readonly dataTypes: DataType[] = ['events', 'traces'];
  readonly permissions: PermissionLevel = 'read';

  readonly redactionRules: RedactionRule[] = [
    { pattern: /https:\/\/[a-f0-9]{32}@[a-z0-9]+\.ingest\.sentry\.io\/\d+/g, replacement: '<SENTRY_DSN>', description: 'Sentry DSN' },
    { pattern: /sntrys_[a-zA-Z0-9]{40,}/g, replacement: '<SENTRY_AUTH_TOKEN>', description: 'Sentry auth token' },
    { pattern: /[a-f0-9]{32}/g, replacement: '<SENTRY_KEY>', description: 'Sentry project key (broad match)' },
  ];

  readonly readActions: AgentAction[] = [
    {
      id: 'sentry.list_issues',
      name: 'List Issues',
      description: 'List issues for a Sentry project, optionally filtered by query',
      category: 'read',
      params: [
        { name: 'organization_slug', type: 'string', description: 'Sentry organization slug', required: true },
        { name: 'project_slug', type: 'string', description: 'Sentry project slug', required: true },
        { name: 'query', type: 'string', description: 'Search query (e.g. is:unresolved)', required: false, default: 'is:unresolved' },
        { name: 'limit', type: 'number', description: 'Max results to return', required: false, default: 25 },
      ],
      requiresApproval: false,
    },
    {
      id: 'sentry.get_issue',
      name: 'Get Issue',
      description: 'Fetch details for a specific Sentry issue by ID',
      category: 'read',
      params: [
        { name: 'issue_id', type: 'string', description: 'Sentry issue ID', required: true },
      ],
      requiresApproval: false,
    },
    {
      id: 'sentry.get_issue_events',
      name: 'Get Issue Events',
      description: 'List events (occurrences) for a specific Sentry issue',
      category: 'read',
      params: [
        { name: 'issue_id', type: 'string', description: 'Sentry issue ID', required: true },
        { name: 'limit', type: 'number', description: 'Max events to return', required: false, default: 20 },
      ],
      requiresApproval: false,
    },
    {
      id: 'sentry.list_projects',
      name: 'List Projects',
      description: 'List all projects in a Sentry organization',
      category: 'read',
      params: [
        { name: 'organization_slug', type: 'string', description: 'Sentry organization slug', required: true },
      ],
      requiresApproval: false,
    },
  ];

  readonly writeActions: AgentAction[] = [
    {
      id: 'sentry.resolve_issue',
      name: 'Resolve Issue',
      description: 'Mark a Sentry issue as resolved',
      category: 'write',
      params: [
        { name: 'issue_id', type: 'string', description: 'Sentry issue ID', required: true },
      ],
      requiresApproval: true,
    },
    {
      id: 'sentry.assign_issue',
      name: 'Assign Issue',
      description: 'Assign a Sentry issue to a user or team',
      category: 'write',
      params: [
        { name: 'issue_id', type: 'string', description: 'Sentry issue ID', required: true },
        { name: 'assignee', type: 'string', description: 'User email or team slug (prefix with team:)', required: true },
      ],
      requiresApproval: true,
    },
  ];

  private token: string | null = null;
  private baseUrl = 'https://sentry.io/api/0';

  async connect(credentials: Credentials): Promise<ConnectionResult> {
    this.token = credentials.token ?? credentials.apiKey ?? null;
    if (!this.token) {
      return { connected: false, error: 'Sentry auth token is required' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/`, {
        headers: this.headers(),
      });

      if (!response.ok) {
        return { connected: false, error: `Sentry auth failed: ${response.status}` };
      }

      return { connected: true, metadata: { api: 'sentry' } };
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
    // Fetch relevant Sentry context based on query type
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
        case 'sentry.list_issues':
          return await this.listIssues(params, start);
        case 'sentry.get_issue':
          return await this.getIssue(params, start);
        case 'sentry.get_issue_events':
          return await this.getIssueEvents(params, start);
        case 'sentry.list_projects':
          return await this.listProjects(params, start);
        case 'sentry.resolve_issue':
          return await this.resolveIssue(params, start);
        case 'sentry.assign_issue':
          return await this.assignIssue(params, start);
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
    if (!this.token) return;

    const pollIntervalMs = 60_000;
    let lastSeen = new Date().toISOString();

    while (true) {
      try {
        // Fetch recent unresolved issues across all organizations the token has access to
        // Use the projects endpoint to discover orgs, then poll issues
        const projects = await this.apiGet('/projects/') as any[];
        const orgSlugs = [...new Set(projects.map((p: any) => p.organization?.slug).filter(Boolean))];

        for (const org of orgSlugs) {
          const issues = await this.apiGet(
            `/organizations/${org}/issues/?query=is:unresolved&sort=date&limit=10`
          ) as any[];

          for (const issue of issues) {
            if (new Date(issue.lastSeen) <= new Date(lastSeen)) continue;

            const systemEvent: SystemEvent = {
              id: issue.id,
              source: 'sentry',
              type: 'sentry.issue',
              timestamp: new Date(issue.lastSeen),
              data: {
                title: issue.title,
                culprit: issue.culprit,
                level: issue.level,
                count: issue.count,
                project: issue.project?.slug,
              },
              severity: issue.level === 'fatal' || issue.level === 'error' ? 'error' : 'warning',
            };
            yield systemEvent;
          }
        }

        lastSeen = new Date().toISOString();
      } catch {
        // Continue on errors
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/`, {
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

  private async listIssues(params: ActionParams, start: number): Promise<ActionResult> {
    const query = encodeURIComponent((params.query as string) ?? 'is:unresolved');
    const limit = (params.limit as number) ?? 25;
    const data = await this.apiGet(
      `/projects/${params.organization_slug}/${params.project_slug}/issues/?query=${query}&limit=${limit}`
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async getIssue(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiGet(`/issues/${params.issue_id}/`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async getIssueEvents(params: ActionParams, start: number): Promise<ActionResult> {
    const limit = (params.limit as number) ?? 20;
    const data = await this.apiGet(`/issues/${params.issue_id}/events/?limit=${limit}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async listProjects(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiGet(`/organizations/${params.organization_slug}/projects/`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async resolveIssue(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiPut(`/issues/${params.issue_id}/`, { status: 'resolved' });
    return { success: true, data, duration: Date.now() - start };
  }

  private async assignIssue(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiPut(`/issues/${params.issue_id}/`, {
      assignedTo: params.assignee,
    });
    return { success: true, data, duration: Date.now() - start };
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async apiGet(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`Sentry API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  private async apiPut(
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Sentry API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }
}
