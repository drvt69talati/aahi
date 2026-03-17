// ─────────────────────────────────────────────────────────────────────────────
// Aahi — ArgoCD Integration
// Read + write for ArgoCD applications, sync status, and rollback.
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

export class ArgoCDIntegration implements AahiIntegration {
  readonly id = 'argocd';
  readonly name = 'ArgoCD';
  readonly category: IntegrationCategory = 'devops';
  readonly authMethod: AuthMethod = 'token';
  readonly dataTypes: DataType[] = ['events', 'infra'];
  readonly permissions: PermissionLevel = 'read';

  readonly redactionRules: RedactionRule[] = [
    { pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: '<ARGOCD_JWT>', description: 'ArgoCD JWT token' },
    { pattern: /argocd\.token=[a-zA-Z0-9_.-]+/g, replacement: 'argocd.token=<REDACTED>', description: 'ArgoCD token cookie' },
  ];

  readonly readActions: AgentAction[] = [
    {
      id: 'argocd.list_applications',
      name: 'List Applications',
      description: 'List all ArgoCD applications, optionally filtered by project',
      category: 'read',
      params: [
        { name: 'project', type: 'string', description: 'Filter by ArgoCD project name', required: false },
      ],
      requiresApproval: false,
    },
    {
      id: 'argocd.get_application',
      name: 'Get Application',
      description: 'Fetch details for a specific ArgoCD application',
      category: 'read',
      params: [
        { name: 'name', type: 'string', description: 'Application name', required: true },
      ],
      requiresApproval: false,
    },
    {
      id: 'argocd.get_sync_status',
      name: 'Get Sync Status',
      description: 'Fetch the sync and health status of an ArgoCD application',
      category: 'read',
      params: [
        { name: 'name', type: 'string', description: 'Application name', required: true },
      ],
      requiresApproval: false,
    },
    {
      id: 'argocd.get_app_history',
      name: 'Get Application History',
      description: 'Fetch deployment history for an ArgoCD application',
      category: 'read',
      params: [
        { name: 'name', type: 'string', description: 'Application name', required: true },
      ],
      requiresApproval: false,
    },
  ];

  readonly writeActions: AgentAction[] = [
    {
      id: 'argocd.sync_application',
      name: 'Sync Application',
      description: 'Trigger a sync operation for an ArgoCD application',
      category: 'write',
      params: [
        { name: 'name', type: 'string', description: 'Application name', required: true },
        { name: 'prune', type: 'boolean', description: 'Allow pruning of resources not in Git', required: false, default: false },
        { name: 'dry_run', type: 'boolean', description: 'Perform a dry-run sync', required: false, default: false },
        { name: 'revision', type: 'string', description: 'Git revision to sync to', required: false },
      ],
      requiresApproval: true,
    },
    {
      id: 'argocd.rollback_application',
      name: 'Rollback Application',
      description: 'Rollback an ArgoCD application to a previous deployment',
      category: 'destructive',
      params: [
        { name: 'name', type: 'string', description: 'Application name', required: true },
        { name: 'history_id', type: 'number', description: 'Deployment history ID to rollback to', required: true },
      ],
      requiresApproval: true,
    },
  ];

  private token: string | null = null;
  private baseUrl: string | null = null;

  async connect(credentials: Credentials): Promise<ConnectionResult> {
    this.token = credentials.token ?? credentials.apiKey ?? null;
    if (!this.token) {
      return { connected: false, error: 'ArgoCD auth token is required' };
    }

    // ArgoCD base URL from oauth2.tokenUrl (convention for self-hosted)
    this.baseUrl = credentials.oauth2?.tokenUrl ?? null;
    if (!this.baseUrl) {
      return { connected: false, error: 'ArgoCD server URL is required (pass via oauth2.tokenUrl, e.g. https://argocd.example.com)' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/session/userinfo`, {
        headers: this.headers(),
      });

      if (!response.ok) {
        return { connected: false, error: `ArgoCD auth failed: ${response.status}` };
      }

      const user = await response.json() as Record<string, any>;
      return {
        connected: true,
        metadata: { username: user.username, iss: user.iss },
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
        case 'argocd.list_applications':
          return await this.listApplications(params, start);
        case 'argocd.get_application':
          return await this.getApplication(params, start);
        case 'argocd.get_sync_status':
          return await this.getSyncStatus(params, start);
        case 'argocd.get_app_history':
          return await this.getAppHistory(params, start);
        case 'argocd.sync_application':
          return await this.syncApplication(params, start);
        case 'argocd.rollback_application':
          return await this.rollbackApplication(params, start);
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
    // In production, this would use ArgoCD SSE stream or gRPC events
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/session/userinfo`, {
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

  private async listApplications(params: ActionParams, start: number): Promise<ActionResult> {
    const project = params.project ? `?project=${encodeURIComponent(params.project as string)}` : '';
    const data = await this.apiGet(`/api/v1/applications${project}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async getApplication(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiGet(`/api/v1/applications/${encodeURIComponent(params.name as string)}`);
    return { success: true, data, duration: Date.now() - start };
  }

  private async getSyncStatus(params: ActionParams, start: number): Promise<ActionResult> {
    const app = await this.apiGet(`/api/v1/applications/${encodeURIComponent(params.name as string)}`) as Record<string, any>;
    const data = {
      sync: app.status?.sync,
      health: app.status?.health,
      operationState: app.status?.operationState,
    };
    return { success: true, data, duration: Date.now() - start };
  }

  private async getAppHistory(params: ActionParams, start: number): Promise<ActionResult> {
    const app = await this.apiGet(`/api/v1/applications/${encodeURIComponent(params.name as string)}`) as Record<string, any>;
    const data = app.status?.history ?? [];
    return { success: true, data, duration: Date.now() - start };
  }

  private async syncApplication(params: ActionParams, start: number): Promise<ActionResult> {
    const body: Record<string, unknown> = {
      prune: (params.prune as boolean) ?? false,
      dryRun: (params.dry_run as boolean) ?? false,
    };
    if (params.revision) {
      body.revision = params.revision;
    }
    const data = await this.apiPost(
      `/api/v1/applications/${encodeURIComponent(params.name as string)}/sync`,
      body,
    );
    return { success: true, data, duration: Date.now() - start };
  }

  private async rollbackApplication(params: ActionParams, start: number): Promise<ActionResult> {
    const data = await this.apiPost(
      `/api/v1/applications/${encodeURIComponent(params.name as string)}/rollback`,
      { id: params.history_id },
    );
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
      throw new Error(`ArgoCD API error ${response.status}: ${await response.text()}`);
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
      throw new Error(`ArgoCD API error ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }
}
