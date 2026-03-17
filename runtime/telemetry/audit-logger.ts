// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Immutable Audit Logger
// Append-only log for SOC2 compliance. Every LLM call, integration action,
// and agent execution is logged. Never modifiable after write.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';

export type AuditActor = 'user' | 'agent' | 'system';
export type AuditResult = 'success' | 'failure' | 'denied';
export type AuditExportFormat = 'json' | 'csv' | 'jsonl';

export interface AuditEntry {
  id: string;
  timestamp: Date;
  actor: AuditActor;
  actorId: string;
  action: string;
  resource: string;
  params: Record<string, unknown>;
  result: AuditResult;
  redactedFields: string[];
  durationMs: number;
}

export interface AuditQueryFilter {
  actor?: AuditActor;
  actorId?: string;
  action?: string;
  resource?: string;
  result?: AuditResult;
  timeRange?: { start: Date; end: Date };
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  totalEntries: number;
  byActor: Record<string, number>;
  byResult: Record<string, number>;
  byAction: Record<string, number>;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}

// ─── Audit Logger ───────────────────────────────────────────────────────────

export class AuditLogger {
  /** Immutable, append-only entries. Frozen on write. */
  private readonly entries: ReadonlyArray<Readonly<AuditEntry>>[] = [];
  private entryList: Readonly<AuditEntry>[] = [];

  /**
   * Log an audit entry. The entry is frozen and can never be modified.
   */
  log(
    input: Omit<AuditEntry, 'id' | 'timestamp'> & { timestamp?: Date },
  ): Readonly<AuditEntry> {
    const entry: AuditEntry = Object.freeze({
      id: uuid(),
      timestamp: input.timestamp ?? new Date(),
      actor: input.actor,
      actorId: input.actorId,
      action: input.action,
      resource: input.resource,
      params: Object.freeze({ ...input.params }) as Record<string, unknown>,
      result: input.result,
      redactedFields: Object.freeze([...input.redactedFields]) as string[],
      durationMs: input.durationMs,
    });

    this.entryList.push(entry);
    return entry;
  }

  /**
   * Query audit entries with flexible filtering.
   */
  query(filter: AuditQueryFilter): ReadonlyArray<Readonly<AuditEntry>> {
    let results = [...this.entryList];

    if (filter.actor) {
      results = results.filter((e) => e.actor === filter.actor);
    }
    if (filter.actorId) {
      results = results.filter((e) => e.actorId === filter.actorId);
    }
    if (filter.action) {
      results = results.filter((e) => e.action === filter.action);
    }
    if (filter.resource) {
      results = results.filter((e) => e.resource === filter.resource);
    }
    if (filter.result) {
      results = results.filter((e) => e.result === filter.result);
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
   * Export audit log in the specified format.
   */
  export(format: AuditExportFormat): string {
    switch (format) {
      case 'json':
        return JSON.stringify(this.entryList, null, 2);

      case 'jsonl':
        return this.entryList.map((e) => JSON.stringify(e)).join('\n');

      case 'csv': {
        const headers = [
          'id', 'timestamp', 'actor', 'actorId', 'action',
          'resource', 'result', 'redactedFields', 'durationMs',
        ];
        const rows = this.entryList.map((e) => [
          e.id,
          e.timestamp.toISOString(),
          e.actor,
          e.actorId,
          e.action,
          e.resource,
          e.result,
          e.redactedFields.join(';'),
          String(e.durationMs),
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));

        return [headers.join(','), ...rows].join('\n');
      }

      default:
        return JSON.stringify(this.entryList, null, 2);
    }
  }

  /**
   * Get summary statistics for the audit log.
   */
  getStats(): AuditStats {
    const byActor: Record<string, number> = {};
    const byResult: Record<string, number> = {};
    const byAction: Record<string, number> = {};

    for (const entry of this.entryList) {
      byActor[entry.actor] = (byActor[entry.actor] ?? 0) + 1;
      byResult[entry.result] = (byResult[entry.result] ?? 0) + 1;
      byAction[entry.action] = (byAction[entry.action] ?? 0) + 1;
    }

    return {
      totalEntries: this.entryList.length,
      byActor,
      byResult,
      byAction,
      oldestEntry: this.entryList.length > 0 ? this.entryList[0].timestamp : null,
      newestEntry: this.entryList.length > 0
        ? this.entryList[this.entryList.length - 1].timestamp
        : null,
    };
  }

  /**
   * Get total number of entries.
   */
  get size(): number {
    return this.entryList.length;
  }
}
