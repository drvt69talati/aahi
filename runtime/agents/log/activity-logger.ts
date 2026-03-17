// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Agent Activity Logger
// Immutable append-only log of all agent actions. Queryable by agent,
// session, time range, and status. Exportable for compliance.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';

export type ActivityStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'approval_requested'
  | 'approved'
  | 'declined';

export interface ActivityLogEntry {
  id: string;
  timestamp: Date;
  agentId: string;
  sessionId: string;
  stepId: string;
  action: string;
  status: ActivityStatus;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface ActivityQueryFilter {
  agentId?: string;
  sessionId?: string;
  status?: ActivityStatus;
  action?: string;
  timeRange?: { start: Date; end: Date };
  limit?: number;
  offset?: number;
}

export interface ActivityStats {
  totalEntries: number;
  byAgent: Record<string, number>;
  byStatus: Record<string, number>;
  byAction: Record<string, number>;
  averageDurationMs: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}

// ─── Activity Logger ────────────────────────────────────────────────────────

export class ActivityLogger {
  private readonly entries: Readonly<ActivityLogEntry>[] = [];

  /**
   * Log an activity entry. Frozen on write — immutable.
   */
  log(
    input: Omit<ActivityLogEntry, 'id' | 'timestamp'> & { timestamp?: Date },
  ): Readonly<ActivityLogEntry> {
    const entry: ActivityLogEntry = Object.freeze({
      id: uuid(),
      timestamp: input.timestamp ?? new Date(),
      agentId: input.agentId,
      sessionId: input.sessionId,
      stepId: input.stepId,
      action: input.action,
      status: input.status,
      params: Object.freeze({ ...input.params }) as Record<string, unknown>,
      result: input.result,
      error: input.error,
      durationMs: input.durationMs,
    });

    this.entries.push(entry);
    return entry;
  }

  /**
   * Query entries with flexible filtering.
   */
  query(filter: ActivityQueryFilter): ReadonlyArray<Readonly<ActivityLogEntry>> {
    let results = [...this.entries];

    if (filter.agentId) {
      results = results.filter((e) => e.agentId === filter.agentId);
    }
    if (filter.sessionId) {
      results = results.filter((e) => e.sessionId === filter.sessionId);
    }
    if (filter.status) {
      results = results.filter((e) => e.status === filter.status);
    }
    if (filter.action) {
      results = results.filter((e) => e.action === filter.action);
    }
    if (filter.timeRange) {
      const { start, end } = filter.timeRange;
      results = results.filter(
        (e) => e.timestamp >= start && e.timestamp <= end,
      );
    }

    // Sort newest first
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filter.offset) {
      results = results.slice(filter.offset);
    }
    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Get all entries for a specific session.
   */
  getBySession(sessionId: string): ReadonlyArray<Readonly<ActivityLogEntry>> {
    return this.query({ sessionId });
  }

  /**
   * Get all entries for a specific agent.
   */
  getByAgent(agentId: string): ReadonlyArray<Readonly<ActivityLogEntry>> {
    return this.query({ agentId });
  }

  /**
   * Export all entries as JSON.
   */
  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Get summary statistics.
   */
  getStats(): ActivityStats {
    const byAgent: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    let totalDuration = 0;

    for (const entry of this.entries) {
      byAgent[entry.agentId] = (byAgent[entry.agentId] ?? 0) + 1;
      byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
      byAction[entry.action] = (byAction[entry.action] ?? 0) + 1;
      totalDuration += entry.durationMs;
    }

    return {
      totalEntries: this.entries.length,
      byAgent,
      byStatus,
      byAction,
      averageDurationMs: this.entries.length > 0 ? totalDuration / this.entries.length : 0,
      oldestEntry: this.entries.length > 0 ? this.entries[0].timestamp : null,
      newestEntry: this.entries.length > 0
        ? this.entries[this.entries.length - 1].timestamp
        : null,
    };
  }

  /**
   * Total number of entries.
   */
  get size(): number {
    return this.entries.length;
  }
}
