// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Singleton WebSocket client for runtime communication.
// All UI components use this to talk to the Node.js runtime server.
// ─────────────────────────────────────────────────────────────────────────────

export interface IPCRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface IPCResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface IPCEvent {
  event: string;
  data: unknown;
}

type EventHandler = (data: unknown) => void;

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export class RuntimeClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private connected = false;
  private intentionalClose = false;

  constructor(url = 'ws://localhost:9741') {
    this.url = url;
  }

  // ── Connect to runtime server ──────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.ws && this.connected) return;

    return new Promise<void>((resolve, reject) => {
      this.intentionalClose = false;

      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        reject(new Error(`Failed to create WebSocket: ${(err as Error).message}`));
        return;
      }

      this.ws.addEventListener('open', () => {
        this.connected = true;
        this.reconnectAttempt = 0;
        resolve();
      });

      this.ws.addEventListener('message', (event) => {
        this.handleMessage(typeof event.data === 'string' ? event.data : String(event.data));
      });

      this.ws.addEventListener('close', () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.ws = null;

        // Reject all pending requests
        for (const [id, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error('WebSocket connection closed'));
          this.pending.delete(id);
        }

        if (!this.intentionalClose) {
          this.scheduleReconnect();
        }

        // If we never connected, reject the connect promise
        if (!wasConnected) {
          reject(new Error('WebSocket connection closed before opening'));
        }
      });

      this.ws.addEventListener('error', () => {
        // The close handler will fire after this; errors alone don't need
        // special handling beyond what close does.
      });
    });
  }

  // ── Disconnect ─────────────────────────────────────────────────────────

  disconnect(): void {
    this.intentionalClose = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Client disconnected'));
      this.pending.delete(id);
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.connected = false;
    this.reconnectAttempt = 0;
  }

  // ── Send request and wait for response ─────────────────────────────────

  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws || !this.connected) {
      throw new Error('Not connected to runtime server');
    }

    const id = String(++this.requestId);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      const message: IPCRequest = { id, method, params };

      try {
        this.ws!.send(JSON.stringify(message));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Failed to send message: ${(err as Error).message}`));
      }
    });
  }

  // ── Subscribe to server events ─────────────────────────────────────────

  on(event: string, handler: EventHandler): () => void {
    let handlers = this.eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(event, handlers);
    }
    handlers.add(handler);

    // Return unsubscribe function
    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        this.eventHandlers.delete(event);
      }
    };
  }

  // ── Auto-reconnect with exponential backoff ────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalClose) return;

    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempt),
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        // connect failure will trigger close which calls scheduleReconnect again
      }
    }, delay);
  }

  // ── Handle incoming messages (responses + events) ──────────────────────

  private handleMessage(data: string): void {
    let parsed: IPCResponse | IPCEvent;

    try {
      parsed = JSON.parse(data);
    } catch {
      console.error('[RuntimeClient] Failed to parse message:', data);
      return;
    }

    // Response to a pending request
    if ('id' in parsed && (parsed as IPCResponse).id) {
      const response = parsed as IPCResponse;
      const entry = this.pending.get(response.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(response.id);

        if (response.error) {
          entry.reject(new Error(response.error.message));
        } else {
          entry.resolve(response.result);
        }
      }
      return;
    }

    // Server-pushed event
    if ('event' in parsed && (parsed as IPCEvent).event) {
      const event = parsed as IPCEvent;
      const handlers = this.eventHandlers.get(event.event);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(event.data);
          } catch (err) {
            console.error(`[RuntimeClient] Event handler error for "${event.event}":`, err);
          }
        }
      }
    }
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this.connected;
  }
}

// ── Singleton instance ────────────────────────────────────────────────────

export const runtime = new RuntimeClient();
