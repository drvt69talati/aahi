// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Vault Client
// HashiCorp Vault integration for enterprise secrets management.
// Supports KV v2 engine for read/write/list operations.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VaultConfig {
  url: string;
  token: string;
  namespace?: string;
  kvMountPath?: string; // defaults to "secret"
}

export interface VaultSecret {
  data: Record<string, unknown>;
  metadata: {
    createdTime: string;
    version: number;
  };
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class VaultClient {
  private url: string = '';
  private token: string = '';
  private namespace?: string;
  private kvMount: string = 'secret';
  private connected: boolean = false;

  /**
   * Connect to a HashiCorp Vault server.
   * Validates the connection by checking the server health endpoint.
   */
  async connect(url: string, token: string, options?: { namespace?: string; kvMountPath?: string }): Promise<void> {
    this.url = url.replace(/\/+$/, ''); // strip trailing slashes
    this.token = token;
    this.namespace = options?.namespace;
    this.kvMount = options?.kvMountPath ?? 'secret';

    // Validate connection with a health check
    const response = await this.request('GET', '/v1/sys/health');
    if (!response.ok && response.status !== 429 && response.status !== 472 && response.status !== 473) {
      this.connected = false;
      throw new Error(`Vault connection failed: ${response.status} ${response.statusText}`);
    }

    this.connected = true;
  }

  /**
   * Read a secret from the KV v2 engine.
   */
  async readSecret(path: string): Promise<Record<string, unknown>> {
    this.requireConnection();

    const response = await this.request('GET', `/v1/${this.kvMount}/data/${path}`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Secret not found: ${path}`);
      }
      throw new Error(`Failed to read secret: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as { data: VaultSecret };
    return body.data.data;
  }

  /**
   * Write a secret to the KV v2 engine.
   */
  async writeSecret(path: string, data: Record<string, unknown>): Promise<void> {
    this.requireConnection();

    const response = await this.request('POST', `/v1/${this.kvMount}/data/${path}`, {
      data,
    });

    if (!response.ok) {
      throw new Error(`Failed to write secret: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * List secrets at a given path (returns key names, not values).
   */
  async listSecrets(path: string): Promise<string[]> {
    this.requireConnection();

    const response = await this.request('LIST', `/v1/${this.kvMount}/metadata/${path}`);
    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error(`Failed to list secrets: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as { data: { keys: string[] } };
    return body.data.keys;
  }

  /**
   * Check whether the client is connected to Vault.
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private requireConnection(): void {
    if (!this.connected) {
      throw new Error('Not connected to Vault. Call connect() first.');
    }
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'X-Vault-Token': this.token,
      'Content-Type': 'application/json',
    };

    if (this.namespace) {
      headers['X-Vault-Namespace'] = this.namespace;
    }

    // Vault uses LIST verb but HTTP doesn't support it natively
    const httpMethod = method === 'LIST' ? 'GET' : method;
    const url = method === 'LIST'
      ? `${this.url}${path}?list=true`
      : `${this.url}${path}`;

    return fetch(url, {
      method: httpMethod,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}
