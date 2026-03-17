// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Approval Manager
// Queues approval requests for agent actions. Supports timeout, typed
// confirmation for critical actions, and event notification for UI.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type { ApprovalGate } from '../../integrations/registry/types.js';

export type ApprovalStatus = 'pending' | 'approved' | 'declined' | 'expired';

export interface ApprovalRequest {
  id: string;
  gate: ApprovalGate;
  status: ApprovalStatus;
  requestedAt: Date;
  respondedAt?: Date;
  respondedBy?: string;
}

export type ApprovalRequestHandler = (request: ApprovalRequest) => void;

// ─── Approval Manager ──────────────────────────────────────────────────────

export class ApprovalManager {
  private requests = new Map<string, ApprovalRequest>();
  private handlers: ApprovalRequestHandler[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Create an approval request for a gated action.
   * Returns the request, which will be auto-declined after gate.timeout ms.
   */
  requestApproval(gate: ApprovalGate): ApprovalRequest {
    const request: ApprovalRequest = {
      id: uuid(),
      gate,
      status: 'pending',
      requestedAt: new Date(),
    };

    this.requests.set(request.id, request);

    // Set up auto-expiry timer
    if (gate.timeout > 0) {
      const timer = setTimeout(() => {
        const req = this.requests.get(request.id);
        if (req && req.status === 'pending') {
          req.status = 'expired';
          req.respondedAt = new Date();
        }
        this.timers.delete(request.id);
      }, gate.timeout);
      this.timers.set(request.id, timer);
    }

    // Notify handlers
    for (const handler of this.handlers) {
      try {
        handler(request);
      } catch {
        // Don't let one handler crash others
      }
    }

    return request;
  }

  /**
   * Respond to an approval request.
   * For critical actions requiring typed confirmation, the typedConfirmation
   * must match the action description.
   */
  respond(
    id: string,
    approved: boolean,
    options?: { typedConfirmation?: string; respondedBy?: string },
  ): ApprovalRequest | null {
    const request = this.requests.get(id);
    if (!request) return null;
    if (request.status !== 'pending') return request;

    // Validate typed confirmation for critical actions
    if (approved && request.gate.requiresTypedConfirmation) {
      if (!options?.typedConfirmation || options.typedConfirmation !== request.gate.description) {
        // Typed confirmation doesn't match — decline
        request.status = 'declined';
        request.respondedAt = new Date();
        request.respondedBy = options?.respondedBy;
        this.clearTimer(id);
        return request;
      }
    }

    request.status = approved ? 'approved' : 'declined';
    request.respondedAt = new Date();
    request.respondedBy = options?.respondedBy;

    this.clearTimer(id);
    return request;
  }

  /**
   * Get all pending approval requests.
   */
  getPending(): ApprovalRequest[] {
    return [...this.requests.values()].filter((r) => r.status === 'pending');
  }

  /**
   * Get full approval history.
   */
  getHistory(): ApprovalRequest[] {
    return [...this.requests.values()].sort(
      (a, b) => b.requestedAt.getTime() - a.requestedAt.getTime(),
    );
  }

  /**
   * Get a specific request by ID.
   */
  getRequest(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  /**
   * Subscribe to new approval requests (for UI notifications).
   * Returns an unsubscribe function.
   */
  onRequest(handler: ApprovalRequestHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  /**
   * Clean up all timers (for shutdown).
   */
  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}
