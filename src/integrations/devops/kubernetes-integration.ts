// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Kubernetes Integration
// Read pods, deployments, logs, events. Write: scale, restart, rollback.
// All write actions are approval-gated.
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

export class KubernetesIntegration implements AahiIntegration {
  readonly id = 'kubernetes';
  readonly name = 'Kubernetes';
  readonly category: IntegrationCategory = 'devops';
  readonly authMethod: AuthMethod = 'token';
  readonly dataTypes: DataType[] = ['logs', 'events', 'infra', 'metrics'];
  readonly permissions: PermissionLevel = 'read';

  readonly redactionRules: RedactionRule[] = [
    { pattern: /(?:password|secret|token):\s*["']?[^\s"']+/gi, replacement: '<K8S_SECRET>', description: 'K8s secret value' },
  ];

  readonly readActions: AgentAction[] = [
    {
      id: 'k8s.list_pods',
      name: 'List Pods',
      description: 'List pods in a namespace',
      category: 'read',
      params: [
        { name: 'namespace', type: 'string', description: 'Kubernetes namespace', required: false, default: 'default' },
        { name: 'labelSelector', type: 'string', description: 'Label selector', required: false },
      ],
      requiresApproval: false,
    },
    {
      id: 'k8s.get_pod_logs',
      name: 'Get Pod Logs',
      description: 'Fetch logs from a pod',
      category: 'read',
      params: [
        { name: 'namespace', type: 'string', description: 'Namespace', required: true },
        { name: 'pod', type: 'string', description: 'Pod name', required: true },
        { name: 'container', type: 'string', description: 'Container name', required: false },
        { name: 'tailLines', type: 'number', description: 'Number of lines from end', required: false, default: 100 },
        { name: 'sinceSeconds', type: 'number', description: 'Since N seconds ago', required: false },
      ],
      requiresApproval: false,
    },
    {
      id: 'k8s.list_deployments',
      name: 'List Deployments',
      description: 'List deployments in a namespace',
      category: 'read',
      params: [
        { name: 'namespace', type: 'string', description: 'Namespace', required: false, default: 'default' },
      ],
      requiresApproval: false,
    },
    {
      id: 'k8s.get_events',
      name: 'Get Events',
      description: 'List recent Kubernetes events',
      category: 'read',
      params: [
        { name: 'namespace', type: 'string', description: 'Namespace', required: false },
        { name: 'fieldSelector', type: 'string', description: 'Field selector', required: false },
      ],
      requiresApproval: false,
    },
    {
      id: 'k8s.describe_pod',
      name: 'Describe Pod',
      description: 'Get detailed pod information including status, conditions, events',
      category: 'read',
      params: [
        { name: 'namespace', type: 'string', description: 'Namespace', required: true },
        { name: 'pod', type: 'string', description: 'Pod name', required: true },
      ],
      requiresApproval: false,
    },
  ];

  readonly writeActions: AgentAction[] = [
    {
      id: 'k8s.scale_deployment',
      name: 'Scale Deployment',
      description: 'Scale a deployment to N replicas',
      category: 'write',
      params: [
        { name: 'namespace', type: 'string', description: 'Namespace', required: true },
        { name: 'deployment', type: 'string', description: 'Deployment name', required: true },
        { name: 'replicas', type: 'number', description: 'Target replica count', required: true },
      ],
      requiresApproval: true,
    },
    {
      id: 'k8s.restart_deployment',
      name: 'Restart Deployment',
      description: 'Trigger a rolling restart of a deployment',
      category: 'write',
      params: [
        { name: 'namespace', type: 'string', description: 'Namespace', required: true },
        { name: 'deployment', type: 'string', description: 'Deployment name', required: true },
      ],
      requiresApproval: true,
    },
    {
      id: 'k8s.delete_pod',
      name: 'Delete Pod',
      description: 'Delete a pod (triggers recreation by controller)',
      category: 'destructive',
      params: [
        { name: 'namespace', type: 'string', description: 'Namespace', required: true },
        { name: 'pod', type: 'string', description: 'Pod name', required: true },
      ],
      requiresApproval: true,
    },
  ];

  private apiServer: string | null = null;
  private token: string | null = null;
  private caCert: string | null = null;

  async connect(credentials: Credentials): Promise<ConnectionResult> {
    this.token = credentials.token ?? null;

    // Try in-cluster config first, then explicit
    if (!this.token) {
      try {
        // In-cluster: read service account token
        const { readFileSync } = await import('fs');
        this.token = readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
        this.apiServer = `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`;
        this.caCert = readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt', 'utf8');
      } catch {
        return { connected: false, error: 'No token provided and not running in-cluster' };
      }
    }

    if (!this.apiServer) {
      this.apiServer = (credentials as any).apiServer ?? 'https://localhost:6443';
    }

    try {
      const health = await this.healthCheck();
      return {
        connected: health.healthy,
        error: health.error,
        metadata: { apiServer: this.apiServer },
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
    this.apiServer = null;
  }

  async fetchContext(query: ContextQuery): Promise<ContextChunk[]> {
    const chunks: ContextChunk[] = [];

    if (query.type === 'logs') {
      // Fetch pod logs for context
      const namespace = query.filters?.namespace ?? 'default';
      const pod = query.filters?.pod;
      if (pod) {
        const result = await this.executeAction(
          this.readActions.find(a => a.id === 'k8s.get_pod_logs')!,
          { namespace, pod, tailLines: query.limit ?? 50 },
          {} as ApprovalGate,
        );
        if (result.success) {
          chunks.push({
            source: 'kubernetes',
            type: 'logs',
            content: String(result.data),
            timestamp: new Date(),
            metadata: { namespace, pod },
          });
        }
      }
    }

    if (query.type === 'events') {
      const result = await this.executeAction(
        this.readActions.find(a => a.id === 'k8s.get_events')!,
        { namespace: query.filters?.namespace },
        {} as ApprovalGate,
      );
      if (result.success) {
        chunks.push({
          source: 'kubernetes',
          type: 'events',
          content: JSON.stringify(result.data),
          timestamp: new Date(),
        });
      }
    }

    return chunks;
  }

  async executeAction(
    action: AgentAction,
    params: ActionParams,
    _approval: ApprovalGate,
  ): Promise<ActionResult> {
    const start = Date.now();

    if (!this.apiServer || !this.token) {
      return { success: false, error: 'Not connected to Kubernetes', duration: 0 };
    }

    try {
      switch (action.id) {
        case 'k8s.list_pods': {
          const ns = (params.namespace as string) ?? 'default';
          let path = `/api/v1/namespaces/${ns}/pods`;
          if (params.labelSelector) path += `?labelSelector=${encodeURIComponent(params.labelSelector as string)}`;
          const data = await this.apiGet(path);
          return { success: true, data, duration: Date.now() - start };
        }
        case 'k8s.get_pod_logs': {
          const queryParts: string[] = [];
          if (params.container) queryParts.push(`container=${params.container}`);
          if (params.tailLines) queryParts.push(`tailLines=${params.tailLines}`);
          if (params.sinceSeconds) queryParts.push(`sinceSeconds=${params.sinceSeconds}`);
          const query = queryParts.length ? `?${queryParts.join('&')}` : '';
          const path = `/api/v1/namespaces/${params.namespace}/pods/${params.pod}/log${query}`;
          const data = await this.apiGetText(path);
          return { success: true, data, duration: Date.now() - start };
        }
        case 'k8s.list_deployments': {
          const ns = (params.namespace as string) ?? 'default';
          const data = await this.apiGet(`/apis/apps/v1/namespaces/${ns}/deployments`);
          return { success: true, data, duration: Date.now() - start };
        }
        case 'k8s.get_events': {
          const ns = params.namespace as string;
          const basePath = ns
            ? `/api/v1/namespaces/${ns}/events`
            : '/api/v1/events';
          let path = basePath;
          if (params.fieldSelector) path += `?fieldSelector=${encodeURIComponent(params.fieldSelector as string)}`;
          const data = await this.apiGet(path);
          return { success: true, data, duration: Date.now() - start };
        }
        case 'k8s.describe_pod': {
          const data = await this.apiGet(
            `/api/v1/namespaces/${params.namespace}/pods/${params.pod}`
          );
          return { success: true, data, duration: Date.now() - start };
        }
        case 'k8s.scale_deployment': {
          const data = await this.apiPatch(
            `/apis/apps/v1/namespaces/${params.namespace}/deployments/${params.deployment}/scale`,
            { spec: { replicas: params.replicas } }
          );
          return { success: true, data, duration: Date.now() - start };
        }
        case 'k8s.restart_deployment': {
          // Rolling restart: patch deployment with annotation
          const data = await this.apiPatch(
            `/apis/apps/v1/namespaces/${params.namespace}/deployments/${params.deployment}`,
            {
              spec: {
                template: {
                  metadata: {
                    annotations: {
                      'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
                    },
                  },
                },
              },
            }
          );
          return { success: true, data, duration: Date.now() - start };
        }
        case 'k8s.delete_pod': {
          const data = await this.apiDelete(
            `/api/v1/namespaces/${params.namespace}/pods/${params.pod}`
          );
          return { success: true, data, duration: Date.now() - start };
        }
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
    // Watch Kubernetes events via the watch API
    // In production, this would use the K8s watch API with reconnection
    if (!this.apiServer || !this.token) return;

    // Placeholder: would use /api/v1/events?watch=true
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.apiServer}/healthz`, {
        headers: this.headers(),
      });
      return {
        healthy: response.ok,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
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

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Accept': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async apiGet(path: string): Promise<unknown> {
    const response = await fetch(`${this.apiServer}${path}`, { headers: this.headers() });
    if (!response.ok) throw new Error(`K8s API error ${response.status}: ${await response.text()}`);
    return response.json();
  }

  private async apiGetText(path: string): Promise<string> {
    const response = await fetch(`${this.apiServer}${path}`, {
      headers: { ...this.headers(), 'Accept': 'text/plain' },
    });
    if (!response.ok) throw new Error(`K8s API error ${response.status}: ${await response.text()}`);
    return response.text();
  }

  private async apiPatch(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.apiServer}${path}`, {
      method: 'PATCH',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/strategic-merge-patch+json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`K8s API error ${response.status}: ${await response.text()}`);
    return response.json();
  }

  private async apiDelete(path: string): Promise<unknown> {
    const response = await fetch(`${this.apiServer}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!response.ok) throw new Error(`K8s API error ${response.status}: ${await response.text()}`);
    return response.json();
  }
}
