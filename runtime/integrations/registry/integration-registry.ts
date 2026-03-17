// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Integration Registry
// Manages all connected integrations, health checks, and event streaming.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AahiIntegration,
  IntegrationCategory,
  HealthStatus,
  SystemEvent,
  EventHandler,
  Credentials,
  ConnectionResult,
} from './types.js';

export interface RegisteredIntegration {
  integration: AahiIntegration;
  connected: boolean;
  health: HealthStatus | null;
  connectedAt: Date | null;
}

export class IntegrationRegistry {
  private integrations = new Map<string, RegisteredIntegration>();
  private eventHandlers: EventHandler[] = [];
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Register an integration (does not connect it).
   */
  register(integration: AahiIntegration): void {
    if (this.integrations.has(integration.id)) {
      throw new Error(`Integration "${integration.id}" is already registered`);
    }
    this.integrations.set(integration.id, {
      integration,
      connected: false,
      health: null,
      connectedAt: null,
    });
  }

  /**
   * Connect an integration with credentials.
   */
  async connect(integrationId: string, credentials: Credentials): Promise<ConnectionResult> {
    const entry = this.integrations.get(integrationId);
    if (!entry) {
      throw new Error(`Integration "${integrationId}" not found`);
    }

    const result = await entry.integration.connect(credentials);
    if (result.connected) {
      entry.connected = true;
      entry.connectedAt = new Date();
      // Start streaming events from this integration
      this.startEventStream(entry);
    }

    return result;
  }

  /**
   * Disconnect an integration.
   */
  async disconnect(integrationId: string): Promise<void> {
    const entry = this.integrations.get(integrationId);
    if (!entry) return;

    await entry.integration.disconnect();
    entry.connected = false;
    entry.health = null;
    entry.connectedAt = null;
  }

  /**
   * Get a specific integration by ID.
   */
  get(integrationId: string): AahiIntegration | undefined {
    return this.integrations.get(integrationId)?.integration;
  }

  /**
   * List all registered integrations, optionally filtered.
   */
  list(filter?: {
    category?: IntegrationCategory;
    connected?: boolean;
  }): RegisteredIntegration[] {
    let entries = [...this.integrations.values()];

    if (filter?.category) {
      entries = entries.filter(e => e.integration.category === filter.category);
    }
    if (filter?.connected !== undefined) {
      entries = entries.filter(e => e.connected === filter.connected);
    }

    return entries;
  }

  /**
   * Get all connected integrations.
   */
  getConnected(): AahiIntegration[] {
    return [...this.integrations.values()]
      .filter(e => e.connected)
      .map(e => e.integration);
  }

  /**
   * Subscribe to events from all connected integrations.
   */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  /**
   * Run health checks on all connected integrations.
   */
  async checkHealth(): Promise<Map<string, HealthStatus>> {
    const results = new Map<string, HealthStatus>();

    const connected = [...this.integrations.entries()].filter(([, e]) => e.connected);

    await Promise.allSettled(
      connected.map(async ([id, entry]) => {
        try {
          const health = await entry.integration.healthCheck();
          entry.health = health;
          results.set(id, health);
        } catch (error) {
          const health: HealthStatus = {
            healthy: false,
            latencyMs: -1,
            lastChecked: new Date(),
            error: error instanceof Error ? error.message : String(error),
          };
          entry.health = health;
          results.set(id, health);
        }
      }),
    );

    return results;
  }

  /**
   * Start periodic health checks.
   */
  startHealthChecks(intervalMs: number = 60_000): void {
    this.stopHealthChecks();
    this.healthCheckInterval = setInterval(() => {
      this.checkHealth().catch(() => {});
    }, intervalMs);
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Unregister all integrations and clean up.
   */
  async shutdown(): Promise<void> {
    this.stopHealthChecks();
    const disconnects = [...this.integrations.keys()].map(id => this.disconnect(id));
    await Promise.allSettled(disconnects);
    this.integrations.clear();
    this.eventHandlers = [];
  }

  private async startEventStream(entry: RegisteredIntegration): Promise<void> {
    try {
      const stream = entry.integration.streamEvents((event) => {
        for (const handler of this.eventHandlers) {
          try {
            handler(event);
          } catch {
            // Don't let one handler crash others
          }
        }
      });

      // Consume the async iterable in the background
      (async () => {
        for await (const event of stream) {
          for (const handler of this.eventHandlers) {
            try {
              handler(event);
            } catch {
              // Don't let one handler crash others
            }
          }
        }
      })().catch(() => {});
    } catch {
      // Integration doesn't support streaming — that's OK
    }
  }
}
