// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Jira Integration
// Read + write for Jira issues, projects, and sprints via REST API v3.
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

export class JiraIntegration implements AahiIntegration {
  readonly id = 'jira';
  readonly name = 'Jira';
  readonly category: IntegrationCategory = 'collaboration';
  readonly authMethod: AuthMethod = 'apiKey';
  readonly dataTypes: DataType[] = ['events'];
  readonly permissions: PermissionLevel = 'read';

  readonly redactionRules: RedactionRule[] = [
    { pattern: /ATATT3x[a-zA-Z0-9_-]{50,}/g, replacement: '<JIRA_API_TOKEN>', description: 'Jira Cloud API token' },
    { pattern: /[a-zA-Z0-9+/]{64,}/g, replacement: '<JIRA_BASE64_CRED>', description: 'Jira base64-encoded credentials' },
  ];

  readonly readActions: AgentAction[] = [
    {
      id: 'jira.get_issue',
      name: 'Get Issue',
      description: 'Fetch details for a specific Jira issue by key',
      category: 'read',
      params: [
        { name: 'issue_key', type: 'string', description: 'Jira issue key (e.g. PROJ-123)', required: true },
        { name: 'fields', type: 'string', description: 'Comma-separated field names to include', required: false },
      ],
      requiresApproval: false,
    },
    {
      id: 'jira.search_issues',
      name: 'Search Issues',
      description: 'Search Jira issues using JQL',
      category: 'read',
      params: [
        { name: 'jql', type: 'string', description: 'JQL query string', required: true },
        { name: 'max_results', type: 'number', description: 'Max results to return', required: false, default: 50 },
        { name: 'fields', type: 'string', description: 'Comma-separated field names to include', required: false },
      ],
      requiresApproval: false,
    },
    {
      id: 'jira.list_projects',
      name: 'List Projects',
      description: 'List all accessible Jira projects',
      category: 'read',
      params: [],
      requiresApproval: false,
    },
    {
      id: 'jira.get_sprint',
      name: 'Get Sprint',
      description: 'Fetch details for a specific sprint',
      category: 'read',
      params: [
        { name: 'sprint_id', type: 'number', description: 'Sprint ID', required: true },
      ],
      requiresApproval: false,
    },
  ];

  readonly writeActions: AgentAction[] = [
    {
      id: 'jira.create_issue',
      name: 'Create Issue',
      description: 'Create a new Jira issue',
      category: 'write',
      params: [
        { name: 'project_key', type: 'string', description: 'Project key (e.g. PROJ)', required: true },
        { name: 'summary', type: 'string', description: 'Issue summary/title', required: true },
        { name: 'issue_type', type: 'string', description: 'Issue type (Bug, Task, Story, etc.)', required: true },
        { name: 'description', type: 'string', description: 'Issue description', required: false },
        { name: 'priority', type: 'string', description: 'Priority name (Highest, High, Medium, Low, Lowest)', required: false },
        { name: 'assignee_id', type: 'string', description: 'Assignee account ID', required: false },
        { name: 'labels', type: 'array', description: 'Labels to add', required: false },
      ],
      requiresApproval: true,
    },
    {
      id: 'jira.update_issue',
      name: 'Update Issue',
      description: 'Update fields on an existing Jira issue',
      category: 'write',
      params: [
        { name: 'issue_key', type: 'string', description: 'Jira issue key (e.g. PROJ-123)', required: true },
        { name: 'fields', type: 'object', description: 'Fields to update (key-value map)', required: true },
      ],
      requiresApproval: true,
    },
    {
      id: 'jira.transition_issue',
      name: 'Transition Issue',
      description: 'Move a Jira issue to a new status via workflow transition',
      category: 'write',
      params: [
        { name: 'issue_key', type: 'string', description: 'Jira issue key (e.g. PROJ-123)', required: true },
        { name: 'transition_id', type: 'string', description: 'Workflow transition ID', required: true },
        { name: 'comment', type: 'string', description: 'Optional comment to add with transition', required: false },
      ],
      requiresApproval: true,
    },
  ];

  private email: string | null = null;
  private apiToken: string | null = null;
  private baseUrl: string | null = null;

  async connect(credentials: Credentials): Promise<ConnectionResult> {
    this.apiToken = credentials.apiKey ?? credentials.token ?? null;
    if (!this.apiToken) {
      return { connected: false, error: 'Jira API token is required' };
    }

    // Expect email in oauth2.clientId or as a convention
    this.email = credentials.oauth2?.clientId ?? null;
    if (!this.email) {
      return { connected: false, error: 'Jira email is required (pass via oauth2.clientId)' };
    }

    // Base URL from oauth2.tokenUrl or metadata
    this.baseUrl = credentials.oauth2?.tokenUrl ?? null;
    if (!this.baseUrl) {
      return { connected: false, error: 'Jira site URL is required (pass via oauth2.tokenUrl, e.g. https://yoursite.atlassian.net)' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/rest/api/3/myself`, {
        headers: this.headers(),
      });

      if (!response.ok) {
        return { connected: false, error: `Jira auth failed: ${response.status}` };
      }

      const user = await response.json() as Record<string, any>;
      return {
        connected: true,
        metadata: { accountId: user.accountId, displayName: user.displayName },
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disconnect(): Promise<void> {
    this.email = null;
    this.apiToken = null;
    this.baseUrl = null;
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
        case 'jira.get_issue':
          return await this.getIssue(params, start);
        case 'jira.search_issues':
          return await this.searchIssues(params, start);
        case 'jira.list_projects':
          return await this.listProjects(start);
        case 'jira.get_sprint':
          return await this.getSprint(params, start);
        case 'jira.create_issue':
          return await this.createIssue(params, start);
        case 'jira.update_issue':
          return await this.updateIssue(params, start);
        case 'jira.transition_issue':
          return await this.transitionIssue(params, start);
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
    // In production, this would use Jira webhooks
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/rest/api/3/myself`, {
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

  private async getIssue(params: ActionParams, start: number): Promise<ActionResult> {
    const fields = params.fields ? `?fields=${encodeURIComponent(params.fields as string)}` : '';
    const data = await this.apiGet(`/rest/api/3/issue/${params.issue_key}${fields}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async searchIssues(params: ActionParams, start: number): Promise<ActionResult> {
    const maxResults = (params.max_results as number) ?? 50;
    const body: Record<string, unknown> = {
      jql: params.jql,
      maxResults,
    };
    if (params.fields) {
      body.fields = (params.fields as string).split(',').map(f => f.trim());
    }
    const data = await this.apiPost('/rest/api/3/search', body);
    return { success: true, data, duration: Date.now() - start };
  }

  private async listProjects(start: number): Promise<ActionResult> {
    const data = await this.apiGet('/rest/api/3/project');
    return { success: true, data, duration: Date.now() - start };
  }

  private async getSprint(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiGet(`/rest/agile/1.0/sprint/${params.sprint_id}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async createIssue(params: ActionParams, start: number): Promise<ActionResult> {
    const fields: Record<string, unknown> = {
      project: { key: params.project_key },
      summary: params.summary,
      issuetype: { name: params.issue_type },
    };
    if (params.description) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: params.description }] }] };
    if (params.priority) fields.priority = { name: params.priority };
    if (params.assignee_id) fields.assignee = { accountId: params.assignee_id };
    if (params.labels) fields.labels = params.labels;

    const data = await this.apiPost('/rest/api/3/issue', { fields });
    return { success: true, data, duration: Date.now() - start };
  }

  private async updateIssue(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiPut(`/rest/api/3/issue/${params.issue_key}`, {
      fields: params.fields,
    });
    return { success: true, data, duration: Date.now() - start };
  }

  private async transitionIssue(params: ActionParams, start: number): Promise<ActionResult> {
    const body: Record<string, unknown> = {
      transition: { id: params.transition_id },
    };
    if (params.comment) {
      body.update = {
        comment: [
          {
            add: {
              body: {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: params.comment }] }],
              },
            },
          },
        ],
      };
    }
    const data = await this.apiPost(`/rest/api/3/issue/${params.issue_key}/transitions`, body);
    return { success: true, data, duration: Date.now() - start };
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.email && this.apiToken) {
      const encoded = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
      h['Authorization'] = `Basic ${encoded}`;
    }
    return h;
  }

  private async apiGet(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`Jira API error ${response.status}: ${await response.text()}`);
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
      throw new Error(`Jira API error ${response.status}: ${await response.text()}`);
    }
    // Some Jira endpoints return 204 with no body
    const text = await response.text();
    return text ? JSON.parse(text) : {};
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
      throw new Error(`Jira API error ${response.status}: ${await response.text()}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
}
