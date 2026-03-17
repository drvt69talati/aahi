import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraph } from '../../src/intelligence/teambrain/knowledge-graph.js';
import type {
  ServiceOwnership,
  ExpertiseEntry,
  ArchitecturalDecision,
  IncidentLearning,
} from '../../src/intelligence/teambrain/knowledge-graph.js';

describe('KnowledgeGraph', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = new KnowledgeGraph();
  });

  // ── Service Ownership ───────────────────────────────────────────────────

  describe('service ownership', () => {
    const ownership: ServiceOwnership = {
      service: 'auth-service',
      team: 'platform',
      owners: ['alice', 'bob'],
      oncallSchedule: 'PD-AUTH-001',
      slackChannel: '#auth-team',
      repoUrl: 'https://github.com/acme/auth-service',
      description: 'Handles authentication and authorization',
      updatedAt: new Date('2025-06-01'),
    };

    it('adds and retrieves service ownership', () => {
      graph.addServiceOwnership(ownership);

      const result = graph.getServiceOwner('auth-service');
      expect(result).toBeDefined();
      expect(result!.team).toBe('platform');
      expect(result!.owners).toEqual(['alice', 'bob']);
      expect(result!.slackChannel).toBe('#auth-team');
    });

    it('returns undefined for unknown service', () => {
      expect(graph.getServiceOwner('nonexistent')).toBeUndefined();
    });

    it('lists all services', () => {
      graph.addServiceOwnership(ownership);
      graph.addServiceOwnership({
        service: 'payments',
        team: 'billing',
        owners: ['carol'],
        updatedAt: new Date('2025-06-01'),
      });

      const services = graph.listServices();
      expect(services).toHaveLength(2);
      expect(services.map(s => s.service)).toContain('auth-service');
      expect(services.map(s => s.service)).toContain('payments');
    });

    it('overwrites ownership for the same service', () => {
      graph.addServiceOwnership(ownership);
      graph.addServiceOwnership({
        ...ownership,
        team: 'identity',
        owners: ['dave'],
      });

      const result = graph.getServiceOwner('auth-service');
      expect(result!.team).toBe('identity');
      expect(result!.owners).toEqual(['dave']);
    });
  });

  // ── Expertise ───────────────────────────────────────────────────────────

  describe('expertise queries', () => {
    beforeEach(() => {
      graph.addExpertise({
        person: 'alice',
        areas: [
          {
            path: 'src/auth/**',
            commitCount: 150,
            lastCommit: new Date('2025-05-20'),
            confidence: 0.95,
          },
          {
            path: 'src/middleware/**',
            commitCount: 30,
            lastCommit: new Date('2025-04-10'),
            confidence: 0.6,
          },
        ],
        lastActive: new Date('2025-05-20'),
      });

      graph.addExpertise({
        person: 'bob',
        areas: [
          {
            path: 'src/auth/**',
            commitCount: 80,
            lastCommit: new Date('2025-05-15'),
            confidence: 0.8,
          },
          {
            path: 'src/payments/**',
            commitCount: 200,
            lastCommit: new Date('2025-05-25'),
            confidence: 0.98,
          },
        ],
        lastActive: new Date('2025-05-25'),
      });
    });

    it('finds the top expert for a path', () => {
      const expert = graph.findExpert('src/auth/login.ts');
      expect(expert).toBeDefined();
      expect(expert!.person).toBe('alice');
      expect(expert!.confidence).toBe(0.95);
    });

    it('returns ranked experts via whoKnows', () => {
      const experts = graph.whoKnows('src/auth/oauth.ts');
      expect(experts).toHaveLength(2);
      expect(experts[0].person).toBe('alice');
      expect(experts[1].person).toBe('bob');
    });

    it('returns empty for unknown path', () => {
      const experts = graph.whoKnows('src/unknown/file.ts');
      expect(experts).toHaveLength(0);
    });

    it('retrieves expertise for a person', () => {
      const entry = graph.getExpertise('bob');
      expect(entry).toBeDefined();
      expect(entry!.areas).toHaveLength(2);
      expect(entry!.areas[1].path).toBe('src/payments/**');
    });

    it('returns undefined for unknown person', () => {
      expect(graph.getExpertise('unknown')).toBeUndefined();
    });
  });

  // ── ADR Search ──────────────────────────────────────────────────────────

  describe('architectural decision records', () => {
    const adr1: ArchitecturalDecision = {
      id: 'ADR-001',
      title: 'Use PostgreSQL for persistent storage',
      status: 'accepted',
      context: 'We need a reliable relational database for transactional data',
      decision: 'Use PostgreSQL 15 with connection pooling via pgBouncer',
      consequences: 'Need to manage schema migrations carefully',
      date: new Date('2025-01-15'),
      authors: ['alice'],
      tags: ['database', 'infrastructure'],
    };

    const adr2: ArchitecturalDecision = {
      id: 'ADR-002',
      title: 'Event-driven architecture for service communication',
      status: 'accepted',
      context: 'Services need to communicate without tight coupling',
      decision: 'Use Kafka for async event streaming between services',
      consequences: 'Eventual consistency must be handled in consumers',
      date: new Date('2025-02-20'),
      authors: ['bob'],
      tags: ['architecture', 'messaging'],
    };

    const adr3: ArchitecturalDecision = {
      id: 'ADR-003',
      title: 'Deprecated: Use MongoDB for user profiles',
      status: 'deprecated',
      context: 'Originally chose MongoDB for flexible user data',
      decision: 'Migrate user profiles to PostgreSQL',
      consequences: 'Need migration script and dual-read period',
      date: new Date('2025-03-10'),
      authors: ['alice', 'carol'],
      tags: ['database', 'migration'],
    };

    beforeEach(() => {
      graph.addADR(adr1);
      graph.addADR(adr2);
      graph.addADR(adr3);
    });

    it('adds and retrieves an ADR by ID', () => {
      const result = graph.getADR('ADR-001');
      expect(result).toBeDefined();
      expect(result!.title).toBe('Use PostgreSQL for persistent storage');
    });

    it('returns undefined for unknown ADR ID', () => {
      expect(graph.getADR('ADR-999')).toBeUndefined();
    });

    it('searches ADRs by keyword in title', () => {
      const results = graph.searchADRs('PostgreSQL');
      expect(results.length).toBeGreaterThanOrEqual(2); // ADR-001 and ADR-003 mention PostgreSQL
    });

    it('searches ADRs by keyword in context', () => {
      const results = graph.searchADRs('coupling');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('ADR-002');
    });

    it('searches ADRs by tag', () => {
      const results = graph.searchADRs('database');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty for unmatched search', () => {
      const results = graph.searchADRs('zzz_nonexistent_term');
      expect(results).toHaveLength(0);
    });

    it('returns empty for empty query', () => {
      const results = graph.searchADRs('');
      expect(results).toHaveLength(0);
    });
  });

  // ── Incident Learning ──────────────────────────────────────────────────

  describe('incident learning', () => {
    const incident1: IncidentLearning = {
      id: 'IL-001',
      incidentId: 'INC-2025-042',
      title: 'Auth service outage due to connection pool exhaustion',
      rootCause: 'Database connection pool was not properly sized for peak traffic',
      impact: '15 minutes of authentication failures affecting 10k users',
      resolution: 'Increased connection pool size and added circuit breaker',
      lessons: [
        'Load test connection pools under peak conditions',
        'Add connection pool monitoring alerts',
      ],
      preventionMeasures: [
        'Automated load testing in CI pipeline',
        'Connection pool size alert threshold at 80%',
      ],
      affectedServices: ['auth-service', 'api-gateway'],
      date: new Date('2025-04-10'),
      postmortemUrl: 'https://wiki.acme.com/postmortems/INC-2025-042',
    };

    const incident2: IncidentLearning = {
      id: 'IL-002',
      incidentId: 'INC-2025-067',
      title: 'Payment processing delays due to Kafka consumer lag',
      rootCause: 'Consumer group rebalance caused by a faulty deployment',
      impact: 'Payment confirmations delayed by 30 minutes',
      resolution: 'Rolled back deployment and fixed consumer configuration',
      lessons: [
        'Canary deployments for Kafka consumers',
        'Monitor consumer lag with alerting',
      ],
      preventionMeasures: [
        'Canary deployment for consumer services',
        'Consumer lag alert at 1000 messages',
      ],
      affectedServices: ['payments', 'notifications'],
      date: new Date('2025-05-05'),
    };

    beforeEach(() => {
      graph.addIncidentLearning(incident1);
      graph.addIncidentLearning(incident2);
    });

    it('searches incidents by keyword', () => {
      const results = graph.searchIncidents('connection pool');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('IL-001');
    });

    it('searches incidents by affected service', () => {
      const results = graph.searchIncidents('payments');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('IL-002');
    });

    it('finds similar incidents by description', () => {
      const results = graph.findSimilarIncidents(
        'database connection timeout during high traffic',
      );
      expect(results.length).toBeGreaterThan(0);
      // IL-001 should rank higher (connection, database match)
      expect(results[0].id).toBe('IL-001');
    });

    it('finds similar incidents ranked by relevance', () => {
      const results = graph.findSimilarIncidents('deployment caused consumer lag');
      expect(results.length).toBeGreaterThan(0);
      // IL-002 should rank higher (deployment, consumer, lag match)
      expect(results[0].id).toBe('IL-002');
    });

    it('returns empty for unmatched incident search', () => {
      const results = graph.searchIncidents('zzz_no_match');
      expect(results).toHaveLength(0);
    });

    it('returns empty for empty description', () => {
      const results = graph.findSimilarIncidents('');
      expect(results).toHaveLength(0);
    });
  });

  // ── whoOwns ─────────────────────────────────────────────────────────────

  describe('whoOwns', () => {
    it('returns ownership info for a known service', () => {
      graph.addServiceOwnership({
        service: 'auth-service',
        team: 'platform',
        owners: ['alice', 'bob'],
        slackChannel: '#auth-team',
        updatedAt: new Date('2025-06-01'),
      });

      const info = graph.whoOwns('auth-service');
      expect(info).toBeDefined();
      expect(info!.team).toBe('platform');
      expect(info!.owners).toEqual(['alice', 'bob']);
      expect(info!.slackChannel).toBe('#auth-team');
    });

    it('returns undefined for unknown service', () => {
      expect(graph.whoOwns('unknown')).toBeUndefined();
    });
  });

  // ── whoKnows ────────────────────────────────────────────────────────────

  describe('whoKnows', () => {
    it('ranks experts by confidence then commit count', () => {
      graph.addExpertise({
        person: 'alice',
        areas: [
          {
            path: 'src/api/**',
            commitCount: 50,
            lastCommit: new Date('2025-05-01'),
            confidence: 0.9,
          },
        ],
        lastActive: new Date('2025-05-01'),
      });

      graph.addExpertise({
        person: 'bob',
        areas: [
          {
            path: 'src/api/**',
            commitCount: 100,
            lastCommit: new Date('2025-05-10'),
            confidence: 0.9,
          },
        ],
        lastActive: new Date('2025-05-10'),
      });

      graph.addExpertise({
        person: 'carol',
        areas: [
          {
            path: 'src/api/**',
            commitCount: 200,
            lastCommit: new Date('2025-04-01'),
            confidence: 0.7,
          },
        ],
        lastActive: new Date('2025-04-01'),
      });

      const ranked = graph.whoKnows('src/api/routes.ts');
      expect(ranked).toHaveLength(3);
      // bob and alice both have 0.9 confidence, bob has more commits
      expect(ranked[0].person).toBe('bob');
      expect(ranked[1].person).toBe('alice');
      expect(ranked[2].person).toBe('carol');
    });
  });

  // ── Service Context ─────────────────────────────────────────────────────

  describe('getServiceContext', () => {
    it('returns combined ownership, incidents, and ADRs for a service', () => {
      graph.addServiceOwnership({
        service: 'auth-service',
        team: 'platform',
        owners: ['alice'],
        updatedAt: new Date('2025-06-01'),
      });

      graph.addIncidentLearning({
        id: 'IL-001',
        incidentId: 'INC-001',
        title: 'Auth outage',
        rootCause: 'Connection pool exhaustion',
        impact: 'Users could not log in',
        resolution: 'Increased pool size',
        lessons: ['Monitor connection pools'],
        preventionMeasures: ['Add alerts'],
        affectedServices: ['auth-service'],
        date: new Date('2025-04-10'),
      });

      graph.addADR({
        id: 'ADR-001',
        title: 'Auth service uses JWT',
        status: 'accepted',
        context: 'The auth-service needs stateless authentication',
        decision: 'Use JWT tokens',
        consequences: 'Token revocation requires blocklist',
        date: new Date('2025-01-01'),
        authors: ['alice'],
        tags: ['auth-service'],
      });

      const ctx = graph.getServiceContext('auth-service');
      expect(ctx.ownership).toBeDefined();
      expect(ctx.ownership!.team).toBe('platform');
      expect(ctx.recentIncidents).toHaveLength(1);
      expect(ctx.relevantADRs).toHaveLength(1);
    });
  });

  // ── Onboarding Context ─────────────────────────────────────────────────

  describe('getOnboardingContext', () => {
    it('returns comprehensive onboarding info', () => {
      graph.addServiceOwnership({
        service: 'payments',
        team: 'billing',
        owners: ['carol'],
        slackChannel: '#billing-eng',
        updatedAt: new Date('2025-06-01'),
      });

      graph.addExpertise({
        person: 'carol',
        areas: [
          {
            path: 'payments/**',
            commitCount: 300,
            lastCommit: new Date('2025-05-28'),
            confidence: 0.99,
          },
        ],
        lastActive: new Date('2025-05-28'),
      });

      graph.addADR({
        id: 'ADR-010',
        title: 'Payments use Stripe',
        status: 'accepted',
        context: 'The payments service needs a payment processor',
        decision: 'Use Stripe API',
        consequences: 'Vendor lock-in to Stripe',
        date: new Date('2025-02-01'),
        authors: ['carol'],
        tags: ['payments'],
      });

      graph.addIncidentLearning({
        id: 'IL-010',
        incidentId: 'INC-010',
        title: 'Payment timeout',
        rootCause: 'Stripe API latency spike',
        impact: 'Payment confirmations delayed',
        resolution: 'Added circuit breaker',
        lessons: ['Add circuit breakers for external APIs'],
        preventionMeasures: ['Circuit breaker pattern', 'Timeout configuration'],
        affectedServices: ['payments'],
        date: new Date('2025-03-15'),
      });

      const ctx = graph.getOnboardingContext('payments');
      expect(ctx.ownership).toBeDefined();
      expect(ctx.ownership!.slackChannel).toBe('#billing-eng');
      expect(ctx.experts).toHaveLength(1);
      expect(ctx.experts[0].person).toBe('carol');
      expect(ctx.architecturalDecisions).toHaveLength(1);
      expect(ctx.incidentHistory).toHaveLength(1);
      expect(ctx.preventionMeasures).toContain('Circuit breaker pattern');
    });
  });
});
