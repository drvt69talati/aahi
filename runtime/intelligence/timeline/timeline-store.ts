// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Timeline Store
// Append-only, time-indexed event log across all sources.
// This is the backbone of Temporal Intelligence — every commit, deploy,
// alert, config change, and incident is a timestamped event here.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';

export type EventSource =
  | 'github'
  | 'kubernetes'
  | 'argocd'
  | 'datadog'
  | 'sentry'
  | 'pagerduty'
  | 'slack'
  | 'jira'
  | 'vault'
  | 'launchdarkly'
  | 'custom';

export type EventCategory =
  | 'code'       // commit, PR, branch, tag
  | 'deploy'     // deployment, rollback, sync
  | 'alert'      // alert fire, resolve, acknowledge
  | 'incident'   // incident create, update, resolve
  | 'config'     // config change, feature flag toggle
  | 'infra'      // scale, restart, crash, OOM
  | 'security'   // CVE, vulnerability, audit event
  | 'metric'     // anomaly, threshold breach
  | 'custom';

export type Severity = 'info' | 'warning' | 'error' | 'critical';

export interface TimelineEvent {
  id: string;
  timestamp: Date;
  source: EventSource;
  category: EventCategory;
  severity: Severity;
  title: string;
  description: string;
  data: Record<string, unknown>;
  /** Links to related events (causal chain) */
  relatedEventIds: string[];
  /** Tags for filtering */
  tags: string[];
  /** Service or component this event relates to */
  service?: string;
  /** The actor (user, system, agent) that caused this event */
  actor?: string;
}

export interface TimelineQuery {
  timeRange?: { start: Date; end: Date };
  sources?: EventSource[];
  categories?: EventCategory[];
  severities?: Severity[];
  services?: string[];
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CorrelationResult {
  event: TimelineEvent;
  correlatedEvents: TimelineEvent[];
  confidence: number;
  explanation: string;
}

export class TimelineStore {
  // In-memory append-only log (will be backed by persistent storage later)
  private events: TimelineEvent[] = [];
  private eventIndex = new Map<string, TimelineEvent>();
  private serviceIndex = new Map<string, Set<string>>(); // service → event IDs
  private tagIndex = new Map<string, Set<string>>();      // tag → event IDs

  /**
   * Append an event to the timeline. Events are immutable once stored.
   */
  append(event: Omit<TimelineEvent, 'id'>): TimelineEvent {
    const fullEvent: TimelineEvent = {
      ...event,
      id: uuid(),
    };

    this.events.push(fullEvent);
    this.eventIndex.set(fullEvent.id, fullEvent);

    // Index by service
    if (fullEvent.service) {
      if (!this.serviceIndex.has(fullEvent.service)) {
        this.serviceIndex.set(fullEvent.service, new Set());
      }
      this.serviceIndex.get(fullEvent.service)!.add(fullEvent.id);
    }

    // Index by tags
    for (const tag of fullEvent.tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(fullEvent.id);
    }

    return fullEvent;
  }

  /**
   * Query events with flexible filtering.
   */
  query(query: TimelineQuery): TimelineEvent[] {
    let results = [...this.events];

    if (query.timeRange) {
      const { start, end } = query.timeRange;
      results = results.filter(e =>
        e.timestamp >= start && e.timestamp <= end
      );
    }

    if (query.sources?.length) {
      const sourceSet = new Set(query.sources);
      results = results.filter(e => sourceSet.has(e.source));
    }

    if (query.categories?.length) {
      const catSet = new Set(query.categories);
      results = results.filter(e => catSet.has(e.category));
    }

    if (query.severities?.length) {
      const sevSet = new Set(query.severities);
      results = results.filter(e => sevSet.has(e.severity));
    }

    if (query.services?.length) {
      const svcSet = new Set(query.services);
      results = results.filter(e => e.service && svcSet.has(e.service));
    }

    if (query.tags?.length) {
      results = results.filter(e =>
        query.tags!.some(tag => e.tags.includes(tag))
      );
    }

    if (query.search) {
      const searchLower = query.search.toLowerCase();
      results = results.filter(e =>
        e.title.toLowerCase().includes(searchLower) ||
        e.description.toLowerCase().includes(searchLower)
      );
    }

    // Sort by timestamp descending (most recent first)
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (query.offset) {
      results = results.slice(query.offset);
    }

    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get a single event by ID.
   */
  get(eventId: string): TimelineEvent | undefined {
    return this.eventIndex.get(eventId);
  }

  /**
   * Find events nearest in time to a given timestamp.
   * Used by TemporalAgent for causal correlation.
   */
  findNearest(
    timestamp: Date,
    windowMs: number = 3_600_000, // 1 hour default
    filter?: { categories?: EventCategory[]; services?: string[] },
  ): TimelineEvent[] {
    const start = new Date(timestamp.getTime() - windowMs);
    const end = new Date(timestamp.getTime() + windowMs);

    return this.query({
      timeRange: { start, end },
      categories: filter?.categories,
      services: filter?.services,
    });
  }

  /**
   * Find causal chain: events leading up to a target event.
   * Walks backward through related events and temporal proximity.
   */
  findCausalChain(eventId: string, maxDepth: number = 5): TimelineEvent[] {
    const target = this.eventIndex.get(eventId);
    if (!target) return [];

    const chain: TimelineEvent[] = [];
    const visited = new Set<string>();
    const queue = [target];

    while (queue.length > 0 && chain.length < maxDepth) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);

      if (current.id !== eventId) {
        chain.push(current);
      }

      // Follow explicit related event links
      for (const relatedId of current.relatedEventIds) {
        const related = this.eventIndex.get(relatedId);
        if (related && !visited.has(relatedId)) {
          queue.push(related);
        }
      }

      // Also look for temporally proximate events from same service
      if (current.service) {
        const nearby = this.findNearest(
          current.timestamp,
          300_000, // 5 min window
          { services: [current.service] },
        );
        for (const e of nearby) {
          if (!visited.has(e.id) && e.timestamp < current.timestamp) {
            queue.push(e);
          }
        }
      }
    }

    // Sort chain chronologically
    chain.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return chain;
  }

  /**
   * Get all events for a specific service, ordered by time.
   */
  getServiceHistory(service: string, limit: number = 100): TimelineEvent[] {
    return this.query({ services: [service], limit });
  }

  /**
   * Get summary stats for the timeline.
   */
  getStats(): {
    totalEvents: number;
    bySource: Record<string, number>;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    services: string[];
    oldestEvent: Date | null;
    newestEvent: Date | null;
  } {
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const event of this.events) {
      bySource[event.source] = (bySource[event.source] ?? 0) + 1;
      byCategory[event.category] = (byCategory[event.category] ?? 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
    }

    return {
      totalEvents: this.events.length,
      bySource,
      byCategory,
      bySeverity,
      services: [...this.serviceIndex.keys()],
      oldestEvent: this.events.length > 0 ? this.events[0].timestamp : null,
      newestEvent: this.events.length > 0 ? this.events[this.events.length - 1].timestamp : null,
    };
  }

  /**
   * Total number of events stored.
   */
  get size(): number {
    return this.events.length;
  }
}
