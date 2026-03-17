import { describe, it, expect, beforeEach } from 'vitest';
import { TimelineStore } from '../../src/intelligence/timeline/timeline-store.js';
import type { TimelineEvent } from '../../src/intelligence/timeline/timeline-store.js';

describe('TimelineStore', () => {
  let store: TimelineStore;

  beforeEach(() => {
    store = new TimelineStore();
  });

  it('appends events and assigns IDs', () => {
    const event = store.append({
      timestamp: new Date('2025-01-15T10:00:00Z'),
      source: 'github',
      category: 'code',
      severity: 'info',
      title: 'Commit pushed',
      description: 'feat: add auth module',
      data: { sha: 'abc123' },
      relatedEventIds: [],
      tags: ['commit'],
      service: 'auth-service',
    });

    expect(event.id).toBeDefined();
    expect(store.size).toBe(1);
  });

  it('queries by time range', () => {
    store.append({
      timestamp: new Date('2025-01-15T08:00:00Z'),
      source: 'github', category: 'code', severity: 'info',
      title: 'Old commit', description: '', data: {},
      relatedEventIds: [], tags: [],
    });
    store.append({
      timestamp: new Date('2025-01-15T12:00:00Z'),
      source: 'github', category: 'deploy', severity: 'info',
      title: 'Deploy v2', description: '', data: {},
      relatedEventIds: [], tags: [],
    });

    const results = store.query({
      timeRange: {
        start: new Date('2025-01-15T10:00:00Z'),
        end: new Date('2025-01-15T14:00:00Z'),
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Deploy v2');
  });

  it('queries by source and category', () => {
    store.append({
      timestamp: new Date(), source: 'github', category: 'code', severity: 'info',
      title: 'Commit', description: '', data: {}, relatedEventIds: [], tags: [],
    });
    store.append({
      timestamp: new Date(), source: 'kubernetes', category: 'infra', severity: 'error',
      title: 'Pod crash', description: '', data: {}, relatedEventIds: [], tags: [],
    });

    expect(store.query({ sources: ['kubernetes'] })).toHaveLength(1);
    expect(store.query({ categories: ['code'] })).toHaveLength(1);
  });

  it('queries by service', () => {
    store.append({
      timestamp: new Date(), source: 'github', category: 'code', severity: 'info',
      title: 'Commit to auth', description: '', data: {},
      relatedEventIds: [], tags: [], service: 'auth-service',
    });
    store.append({
      timestamp: new Date(), source: 'github', category: 'code', severity: 'info',
      title: 'Commit to billing', description: '', data: {},
      relatedEventIds: [], tags: [], service: 'billing-service',
    });

    expect(store.query({ services: ['auth-service'] })).toHaveLength(1);
  });

  it('finds nearest events for temporal correlation', () => {
    const t = new Date('2025-01-15T12:00:00Z');

    store.append({
      timestamp: new Date('2025-01-15T11:55:00Z'),
      source: 'argocd', category: 'deploy', severity: 'info',
      title: 'Deploy v2.4.1', description: '', data: {},
      relatedEventIds: [], tags: [], service: 'api',
    });
    store.append({
      timestamp: new Date('2025-01-15T08:00:00Z'),
      source: 'github', category: 'code', severity: 'info',
      title: 'Old commit', description: '', data: {},
      relatedEventIds: [], tags: [],
    });

    const nearby = store.findNearest(t, 600_000); // 10 min window
    expect(nearby).toHaveLength(1);
    expect(nearby[0].title).toBe('Deploy v2.4.1');
  });

  it('builds causal chains via related events', () => {
    const e1 = store.append({
      timestamp: new Date('2025-01-15T11:50:00Z'),
      source: 'github', category: 'code', severity: 'info',
      title: 'Commit abc123', description: '', data: {},
      relatedEventIds: [], tags: [], service: 'api',
    });
    const e2 = store.append({
      timestamp: new Date('2025-01-15T11:55:00Z'),
      source: 'argocd', category: 'deploy', severity: 'info',
      title: 'Deploy v2.4.1', description: '', data: {},
      relatedEventIds: [e1.id], tags: [], service: 'api',
    });
    const e3 = store.append({
      timestamp: new Date('2025-01-15T12:00:00Z'),
      source: 'datadog', category: 'alert', severity: 'error',
      title: 'Error rate spike', description: '', data: {},
      relatedEventIds: [e2.id], tags: [], service: 'api',
    });

    const chain = store.findCausalChain(e3.id);
    expect(chain.length).toBeGreaterThanOrEqual(1);
    // Chain should include deploy and commit events
    expect(chain.some(e => e.title === 'Deploy v2.4.1')).toBe(true);
  });

  it('returns stats', () => {
    store.append({
      timestamp: new Date(), source: 'github', category: 'code', severity: 'info',
      title: 'Commit', description: '', data: {}, relatedEventIds: [], tags: [],
      service: 'api',
    });
    store.append({
      timestamp: new Date(), source: 'kubernetes', category: 'infra', severity: 'critical',
      title: 'OOM', description: '', data: {}, relatedEventIds: [], tags: [],
      service: 'worker',
    });

    const stats = store.getStats();
    expect(stats.totalEvents).toBe(2);
    expect(stats.bySource.github).toBe(1);
    expect(stats.bySource.kubernetes).toBe(1);
    expect(stats.services).toContain('api');
    expect(stats.services).toContain('worker');
  });

  it('searches by text', () => {
    store.append({
      timestamp: new Date(), source: 'github', category: 'code', severity: 'info',
      title: 'Fix authentication bug', description: 'Fixed JWT validation', data: {},
      relatedEventIds: [], tags: [],
    });
    store.append({
      timestamp: new Date(), source: 'github', category: 'code', severity: 'info',
      title: 'Add billing feature', description: '', data: {},
      relatedEventIds: [], tags: [],
    });

    expect(store.query({ search: 'authentication' })).toHaveLength(1);
    expect(store.query({ search: 'JWT' })).toHaveLength(1);
    expect(store.query({ search: 'billing' })).toHaveLength(1);
  });
});
