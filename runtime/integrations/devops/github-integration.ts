// ─────────────────────────────────────────────────────────────────────────────
// Aahi — GitHub Integration
// Full read + write + event streaming for GitHub repos, PRs, issues, actions.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
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

export class GitHubIntegration implements AahiIntegration {
  readonly id = 'github';
  readonly name = 'GitHub';
  readonly category: IntegrationCategory = 'devops';
  readonly authMethod: AuthMethod = 'token';
  readonly dataTypes: DataType[] = ['code', 'events'];
  readonly permissions: PermissionLevel = 'read';

  readonly redactionRules: RedactionRule[] = [
    { pattern: /ghp_[a-zA-Z0-9]{36,}/g, replacement: '<GITHUB_PAT>', description: 'GitHub PAT' },
    { pattern: /ghs_[a-zA-Z0-9]{36,}/g, replacement: '<GITHUB_SECRET>', description: 'GitHub secret' },
  ];

  readonly readActions: AgentAction[] = [
    {
      id: 'github.get_pr',
      name: 'Get Pull Request',
      description: 'Fetch PR details including diff, comments, and review status',
      category: 'read',
      params: [
        { name: 'owner', type: 'string', description: 'Repo owner', required: true },
        { name: 'repo', type: 'string', description: 'Repo name', required: true },
        { name: 'pull_number', type: 'number', description: 'PR number', required: true },
      ],
      requiresApproval: false,
    },
    {
      id: 'github.list_prs',
      name: 'List Pull Requests',
      description: 'List open PRs for a repository',
      category: 'read',
      params: [
        { name: 'owner', type: 'string', description: 'Repo owner', required: true },
        { name: 'repo', type: 'string', description: 'Repo name', required: true },
        { name: 'state', type: 'string', description: 'PR state (open/closed/all)', required: false, default: 'open' },
      ],
      requiresApproval: false,
    },
    {
      id: 'github.get_file',
      name: 'Get File Content',
      description: 'Fetch file content from a repository',
      category: 'read',
      params: [
        { name: 'owner', type: 'string', description: 'Repo owner', required: true },
        { name: 'repo', type: 'string', description: 'Repo name', required: true },
        { name: 'path', type: 'string', description: 'File path', required: true },
        { name: 'ref', type: 'string', description: 'Git ref (branch/tag/sha)', required: false },
      ],
      requiresApproval: false,
    },
    {
      id: 'github.list_commits',
      name: 'List Commits',
      description: 'List recent commits for a repository',
      category: 'read',
      params: [
        { name: 'owner', type: 'string', description: 'Repo owner', required: true },
        { name: 'repo', type: 'string', description: 'Repo name', required: true },
        { name: 'since', type: 'string', description: 'ISO date to list commits since', required: false },
        { name: 'path', type: 'string', description: 'Filter by file path', required: false },
      ],
      requiresApproval: false,
    },
    {
      id: 'github.get_workflow_runs',
      name: 'Get Workflow Runs',
      description: 'List GitHub Actions workflow runs',
      category: 'read',
      params: [
        { name: 'owner', type: 'string', description: 'Repo owner', required: true },
        { name: 'repo', type: 'string', description: 'Repo name', required: true },
        { name: 'status', type: 'string', description: 'Filter by status', required: false },
      ],
      requiresApproval: false,
    },
  ];

  readonly writeActions: AgentAction[] = [
    {
      id: 'github.create_pr_comment',
      name: 'Create PR Comment',
      description: 'Post a review comment on a pull request',
      category: 'write',
      params: [
        { name: 'owner', type: 'string', description: 'Repo owner', required: true },
        { name: 'repo', type: 'string', description: 'Repo name', required: true },
        { name: 'pull_number', type: 'number', description: 'PR number', required: true },
        { name: 'body', type: 'string', description: 'Comment body (markdown)', required: true },
      ],
      requiresApproval: true,
    },
    {
      id: 'github.create_issue',
      name: 'Create Issue',
      description: 'Create a new GitHub issue',
      category: 'write',
      params: [
        { name: 'owner', type: 'string', description: 'Repo owner', required: true },
        { name: 'repo', type: 'string', description: 'Repo name', required: true },
        { name: 'title', type: 'string', description: 'Issue title', required: true },
        { name: 'body', type: 'string', description: 'Issue body (markdown)', required: true },
        { name: 'labels', type: 'array', description: 'Labels', required: false },
      ],
      requiresApproval: true,
    },
    {
      id: 'github.merge_pr',
      name: 'Merge Pull Request',
      description: 'Merge a pull request',
      category: 'destructive',
      params: [
        { name: 'owner', type: 'string', description: 'Repo owner', required: true },
        { name: 'repo', type: 'string', description: 'Repo name', required: true },
        { name: 'pull_number', type: 'number', description: 'PR number', required: true },
        { name: 'merge_method', type: 'string', description: 'Merge method (merge/squash/rebase)', required: false, default: 'squash' },
      ],
      requiresApproval: true,
    },
  ];

  private token: string | null = null;
  private baseUrl = 'https://api.github.com';

  async connect(credentials: Credentials): Promise<ConnectionResult> {
    this.token = credentials.token ?? credentials.apiKey ?? null;
    if (!this.token) {
      return { connected: false, error: 'GitHub token is required' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/user`, {
        headers: this.headers(),
      });

      if (!response.ok) {
        return { connected: false, error: `GitHub auth failed: ${response.status}` };
      }

      const user = await response.json() as Record<string, any>;
      return {
        connected: true,
        metadata: { login: user.login, name: user.name },
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
    // Fetch relevant context based on query type
    // This would be expanded based on the specific query
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
        case 'github.get_pr':
          return await this.getPR(params, start);
        case 'github.list_prs':
          return await this.listPRs(params, start);
        case 'github.get_file':
          return await this.getFile(params, start);
        case 'github.list_commits':
          return await this.listCommits(params, start);
        case 'github.get_workflow_runs':
          return await this.getWorkflowRuns(params, start);
        case 'github.create_pr_comment':
          return await this.createPRComment(params, start);
        case 'github.create_issue':
          return await this.createIssue(params, start);
        case 'github.merge_pr':
          return await this.mergePR(params, start);
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
    // In production, this would use GitHub webhooks or polling
    // For now, yield nothing — will be connected to webhook receiver
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/rate_limit`, {
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

  private async getPR(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiGet(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}`
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async listPRs(params: ActionParams, start: number): Promise<ActionResult> {
    const state = (params.state as string) ?? 'open';
    const data = await this.apiGet(
      `/repos/${params.owner}/${params.repo}/pulls?state=${state}`
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async getFile(params: ActionParams, start: number): Promise<ActionResult> {
    const ref = params.ref ? `?ref=${params.ref}` : '';
    const data = await this.apiGet(
      `/repos/${params.owner}/${params.repo}/contents/${params.path}${ref}`
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async listCommits(params: ActionParams, start: number): Promise<ActionResult> {
    const queryParts: string[] = [];
    if (params.since) queryParts.push(`since=${params.since}`);
    if (params.path) queryParts.push(`path=${params.path}`);
    const query = queryParts.length ? `?${queryParts.join('&')}` : '';
    const data = await this.apiGet(
      `/repos/${params.owner}/${params.repo}/commits${query}`
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async getWorkflowRuns(params: ActionParams, start: number): Promise<ActionResult> {
    const status = params.status ? `?status=${params.status}` : '';
    const data = await this.apiGet(
      `/repos/${params.owner}/${params.repo}/actions/runs${status}`
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async createPRComment(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiPost(
      `/repos/${params.owner}/${params.repo}/issues/${params.pull_number}/comments`,
      { body: params.body }
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async createIssue(params: ActionParams, start: number): Promise<ActionResult> {
    const body: Record<string, unknown> = {
      title: params.title,
      body: params.body,
    };
    if (params.labels) body.labels = params.labels;
    const data = await this.apiPost(
      `/repos/${params.owner}/${params.repo}/issues`,
      body
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async mergePR(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiPost(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/merge`,
      { merge_method: (params.merge_method as string) ?? 'squash' },
      'PUT'
    );
    return { success: true, data, duration: Date.now() - start };
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async apiGet(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }

  private async apiPost(
    path: string,
    body: Record<string, unknown>,
    method: string = 'POST',
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }
}
