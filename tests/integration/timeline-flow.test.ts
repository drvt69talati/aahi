// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Integration Test: Timeline + Proactive Flow
// Event ingested → timeline stores → query works → proactive detects anomaly
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TimelineStore, type TimelineEvent } from '../../runtime/intelligence/timeline/timeline-store.js';
import { ProactiveAgent, type ProactiveAlert } from '../../runtime/agents/proactive.agent.js';
import type { IntegrationRegistry } from '../../runtime/integrations/registry/integration-registry.js';
import type { SystemEvent, EventHandler } from '../../runtime/integrations/registry/types.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

function createMockIntegrationRegistry(): IntegrationRegistry & {
  _eventHandlers: EventHandler[];
  _emitEvent: (event: SystemEvent) => void;
} {
  const eventHandlers: EventHandler[] = [];

  return {
    onEvent: vi.fn().mockImplementation((handler: EventHandler) => {
      eventHandlers.push(handler);
    }),
    startHealthChecks: vi.fn(),
    stopHealthChecks: vi.fn(),
    _eventHandlers: eventHandlers,
    _emitEvent: (event: SystemEvent) => {
      for (const handler of eventHandlers) {
        handler(event);
      }
    },
  } as unknown as IntegrationRegistry & {
    _eventHandlers: EventHandler[];
    _emitEvent: (event: SystemEvent) => void;
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Timeline Flow — Integration', () => {
  let timeline: TimelineStore;

  beforeEach(() => {
    timeline = new TimelineStore();
  });

  // ── Append event → queryable by time range ────────────────────────────

  it('appended event is queryable by time range', () => {
    const now = new Date();
    const event = timeline.append({
      timestamp: now,
      source: 'github',
      category: 'code',
      severity: 'info',
      title: 'Commit merged',
      description: 'PR #42 merged to main',
      data: { sha: 'abc123', branch: 'main' },
      relatedEventIds: [],
      tags: ['github', 'merge'],
      service: 'auth-service',
    });

    expect(event.id).toBeDefined();

    // Query by time range that includes the event
    const results = timeline.query({
      timeRange: {
        start: new Date(now.getTime() - 1000),
        end: new Date(now.getTime() + 1000),
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Commit merged');
    expect(results[0].id).toBe(event.id);
  });

  // ── Events from different sources → filtered correctly ────────────────

  it('events from different sources are filtered correctly', () => {
    const now = new Date();

    timeline.append({
      timestamp: now,
      source: 'github',
      category: 'code',
      severity: 'info',
      title: 'GitHub commit',
      description: 'Commit pushed',
      data: {},
      relatedEventIds: [],
      tags: ['github'],
    });

    timeline.append({
      timestamp: now,
      source: 'kubernetes',
      category: 'deploy',
      severity: 'info',
      title: 'K8s deploy',
      description: 'Deployment started',
      data: {},
      relatedEventIds: [],
      tags: ['k8s'],
    });

    timeline.append({
      timestamp: now,
      source: 'sentry',
      category: 'alert',
      severity: 'error',
      title: 'Sentry error',
      description: 'NullPointerException',
      data: {},
      relatedEventIds: [],
      tags: ['sentry'],
    });

    // Filter by source
    const githubOnly = timeline.query({ sources: ['github'] });
    expect(githubOnly).toHaveLength(1);
    expect(githubOnly[0].source).toBe('github');

    // Filter by category
    const deploysOnly = timeline.query({ categories: ['deploy'] });
    expect(deploysOnly).toHaveLength(1);
    expect(deploysOnly[0].category).toBe('deploy');

    // Filter by severity
    const errorsOnly = timeline.query({ severities: ['error'] });
    expect(errorsOnly).toHaveLength(1);
    expect(errorsOnly[0].severity).toBe('error');

    // Filter by service
    expect(timeline.query({ services: ['auth-service'] })).toHaveLength(0);
  });

  // ── Causal chain detection (deploy → error spike) ─────────────────────

  it('detects causal chain: deploy followed by error spike', () => {
    const baseTime = new Date('2026-03-17T10:00:00Z');

    // Event 1: Deployment
    const deployEvent = timeline.append({
      timestamp: new Date(baseTime.getTime()),
      source: 'argocd',
      category: 'deploy',
      severity: 'info',
      title: 'Deployment: auth-service v2.3.1',
      description: 'ArgoCD synced auth-service',
      data: { version: '2.3.1' },
      relatedEventIds: [],
      tags: ['deploy', 'auth-service'],
      service: 'auth-service',
    });

    // Event 2: Error spike 2 minutes after deploy
    const errorEvent = timeline.append({
      timestamp: new Date(baseTime.getTime() + 2 * 60_000),
      source: 'sentry',
      category: 'alert',
      severity: 'error',
      title: 'Error spike: auth-service',
      description: 'Error rate jumped to 15%',
      data: { errorRate: 15 },
      relatedEventIds: [deployEvent.id],
      tags: ['error', 'auth-service'],
      service: 'auth-service',
    });

    // Find causal chain for the error event
    const chain = timeline.findCausalChain(errorEvent.id);

    // The deploy should be in the causal chain
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.some(e => e.id === deployEvent.id)).toBe(true);
  });

  // ── Proactive anomaly detector ────────────────────────────────────────

  it('proactive agent fires alert on error rate spike event', () => {
    const registry = createMockIntegrationRegistry();
    const proactive = new ProactiveAgent(registry, timeline);

    const receivedAlerts: ProactiveAlert[] = [];
    proactive.onAlert((alert) => {
      receivedAlerts.push(alert);
    });

    proactive.start();

    // Simulate an error rate spike event from integrations
    registry._emitEvent({
      id: 'evt-1',
      source: 'datadog',
      type: 'metric.threshold',
      timestamp: new Date(),
      data: {
        metric: 'error_rate',
        service: 'auth-service',
        value: 25,
        threshold: 5,
      },
      severity: 'warning',
    });

    // Proactive agent should have emitted an alert
    expect(receivedAlerts.length).toBe(1);
    expect(receivedAlerts[0].severity).toBe('warning');
    expect(receivedAlerts[0].title).toContain('Error rate spike');
    expect(receivedAlerts[0].source).toBe('auth-service');

    // Alert should also be recorded in timeline
    const timelineAlerts = timeline.query({ categories: ['alert'] });
    expect(timelineAlerts.length).toBeGreaterThanOrEqual(1);

    proactive.stop();
  });

  // ── Correlation engine → links anomaly to recent deploy ───────────────

  it('correlation engine links error to recent deploy via temporal proximity', () => {
    const baseTime = new Date('2026-03-17T14:00:00Z');

    // Deploy event
    timeline.append({
      timestamp: new Date(baseTime.getTime()),
      source: 'argocd',
      category: 'deploy',
      severity: 'info',
      title: 'Deploy auth-service v3.0',
      description: 'New version deployed',
      data: {},
      relatedEventIds: [],
      tags: ['deploy'],
      service: 'auth-service',
    });

    // Error event 3 minutes later (same service)
    const errorEvent = timeline.append({
      timestamp: new Date(baseTime.getTime() + 3 * 60_000),
      source: 'sentry',
      category: 'alert',
      severity: 'error',
      title: 'Auth failures spiking',
      description: '500 errors on /login',
      data: {},
      relatedEventIds: [],
      tags: ['error'],
      service: 'auth-service',
    });

    // Use findNearest to correlate — look for deploys near the error
    const nearby = timeline.findNearest(
      errorEvent.timestamp,
      300_000, // 5 min window
      { categories: ['deploy'], services: ['auth-service'] },
    );

    expect(nearby.length).toBeGreaterThan(0);
    expect(nearby[0].category).toBe('deploy');
    expect(nearby[0].title).toContain('v3.0');
  });

  // ── Timeline stats accurate after many events ─────────────────────────

  it('timeline stats are accurate after many events', () => {
    const baseTime = new Date('2026-03-17T12:00:00Z');

    // Add events from different sources
    for (let i = 0; i < 10; i++) {
      timeline.append({
        timestamp: new Date(baseTime.getTime() + i * 60_000),
        source: 'github',
        category: 'code',
        severity: 'info',
        title: `Commit ${i}`,
        description: `Commit message ${i}`,
        data: {},
        relatedEventIds: [],
        tags: ['commit'],
        service: 'api-service',
      });
    }

    for (let i = 0; i < 5; i++) {
      timeline.append({
        timestamp: new Date(baseTime.getTime() + (10 + i) * 60_000),
        source: 'sentry',
        category: 'alert',
        severity: 'error',
        title: `Error ${i}`,
        description: `Error message ${i}`,
        data: {},
        relatedEventIds: [],
        tags: ['error'],
        service: 'auth-service',
      });
    }

    for (let i = 0; i < 3; i++) {
      timeline.append({
        timestamp: new Date(baseTime.getTime() + (15 + i) * 60_000),
        source: 'argocd',
        category: 'deploy',
        severity: 'info',
        title: `Deploy ${i}`,
        description: `Deployment ${i}`,
        data: {},
        relatedEventIds: [],
        tags: ['deploy'],
        service: 'api-service',
      });
    }

    const stats = timeline.getStats();

    expect(stats.totalEvents).toBe(18);
    expect(stats.bySource['github']).toBe(10);
    expect(stats.bySource['sentry']).toBe(5);
    expect(stats.bySource['argocd']).toBe(3);
    expect(stats.byCategory['code']).toBe(10);
    expect(stats.byCategory['alert']).toBe(5);
    expect(stats.byCategory['deploy']).toBe(3);
    expect(stats.bySeverity['info']).toBe(13);
    expect(stats.bySeverity['error']).toBe(5);
    expect(stats.services).toContain('api-service');
    expect(stats.services).toContain('auth-service');
    expect(stats.oldestEvent).toEqual(baseTime);
  });

  // ── Search across title and description ───────────────────────────────

  it('search matches across title and description', () => {
    timeline.append({
      timestamp: new Date(),
      source: 'sentry',
      category: 'alert',
      severity: 'error',
      title: 'NullPointerException in UserService',
      description: 'Stack trace: at com.auth.UserService.login()',
      data: {},
      relatedEventIds: [],
      tags: ['error'],
    });

    timeline.append({
      timestamp: new Date(),
      source: 'github',
      category: 'code',
      severity: 'info',
      title: 'PR merged: fix login flow',
      description: 'Fixed null check in authentication',
      data: {},
      relatedEventIds: [],
      tags: ['code'],
    });

    const searchResults = timeline.query({ search: 'login' });
    expect(searchResults).toHaveLength(2);

    const nullResults = timeline.query({ search: 'NullPointer' });
    expect(nullResults).toHaveLength(1);
  });

  // ── Tag-based filtering ───────────────────────────────────────────────

  it('filters events by tags', () => {
    timeline.append({
      timestamp: new Date(),
      source: 'github',
      category: 'code',
      severity: 'info',
      title: 'Tagged event',
      description: 'Has specific tags',
      data: {},
      relatedEventIds: [],
      tags: ['urgent', 'production'],
    });

    timeline.append({
      timestamp: new Date(),
      source: 'github',
      category: 'code',
      severity: 'info',
      title: 'Other event',
      description: 'Different tags',
      data: {},
      relatedEventIds: [],
      tags: ['staging'],
    });

    const productionEvents = timeline.query({ tags: ['production'] });
    expect(productionEvents).toHaveLength(1);
    expect(productionEvents[0].title).toBe('Tagged event');
  });
});
