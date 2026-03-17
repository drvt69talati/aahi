import { describe, it, expect, beforeEach } from 'vitest';
import { ImpactEngine } from '../../runtime/intelligence/impact/impact-engine.js';
import { KnowledgeGraph } from '../../runtime/intelligence/teambrain/knowledge-graph.js';
import { TimelineStore } from '../../runtime/intelligence/timeline/timeline-store.js';
import type { ImpactWarning } from '../../runtime/intelligence/impact/impact-engine.js';

describe('ImpactEngine', () => {
  let engine: ImpactEngine;
  let graph: KnowledgeGraph;
  let timeline: TimelineStore;

  beforeEach(() => {
    graph = new KnowledgeGraph();
    timeline = new TimelineStore();
    engine = new ImpactEngine(graph, timeline);

    // Seed knowledge graph with services
    graph.addServiceOwnership({
      service: 'auth-service',
      team: 'platform',
      owners: ['alice'],
      slackChannel: '#auth-team',
      updatedAt: new Date('2025-06-01'),
    });

    graph.addServiceOwnership({
      service: 'payments',
      team: 'billing',
      owners: ['bob'],
      updatedAt: new Date('2025-06-01'),
    });

    graph.addServiceOwnership({
      service: 'notifications',
      team: 'comms',
      owners: ['carol'],
      updatedAt: new Date('2025-06-01'),
    });

    // Seed an incident linking payments and notifications
    graph.addIncidentLearning({
      id: 'IL-001',
      incidentId: 'INC-001',
      title: 'Payment notification failure',
      rootCause: 'Payments emitted malformed events',
      impact: 'Users not notified of payment status',
      resolution: 'Fixed event schema',
      lessons: ['Validate event schemas'],
      preventionMeasures: ['Schema validation in CI'],
      affectedServices: ['payments', 'notifications'],
      date: new Date('2025-04-10'),
    });
  });

  // ── Impact Analysis ─────────────────────────────────────────────────────

  describe('analyze', () => {
    it('produces a complete impact report', async () => {
      const report = await engine.analyze(['src/auth-service/login.ts']);

      expect(report.id).toBeDefined();
      expect(report.timestamp).toBeInstanceOf(Date);
      expect(report.changedFiles).toEqual(['src/auth-service/login.ts']);
      expect(report.affectedServices).toContain('auth-service');
      expect(report.riskLevel).toBeDefined();
      expect(report.testCoverage).toHaveProperty('percentage');
      expect(report.warnings).toBeInstanceOf(Array);
      expect(report.recommendation).toBeTruthy();
    });

    it('identifies affected services from file paths', async () => {
      const report = await engine.analyze([
        'src/payments/processor.ts',
        'src/payments/stripe-client.ts',
      ]);

      expect(report.affectedServices).toContain('payments');
    });

    it('assigns higher risk when multiple services affected', async () => {
      const singleService = await engine.analyze(['src/auth-service/login.ts']);
      const multiService = await engine.analyze([
        'src/auth-service/login.ts',
        'src/payments/checkout.ts',
        'src/notifications/email.ts',
      ]);

      const riskLevels = ['low', 'medium', 'high', 'critical'];
      const singleRisk = riskLevels.indexOf(singleService.riskLevel);
      const multiRisk = riskLevels.indexOf(multiService.riskLevel);
      expect(multiRisk).toBeGreaterThanOrEqual(singleRisk);
    });
  });

  // ── Blast Radius ────────────────────────────────────────────────────────

  describe('estimateBlastRadius', () => {
    it('returns downstream services via incident correlation', () => {
      const downstream = engine.estimateBlastRadius('payments');
      // The incident links payments to notifications
      expect(downstream).toContain('notifications');
    });

    it('returns empty for isolated service', () => {
      const downstream = engine.estimateBlastRadius('auth-service');
      // auth-service has no incidents linking to other services
      expect(downstream).toHaveLength(0);
    });
  });

  // ── Test Coverage ───────────────────────────────────────────────────────

  describe('checkTestCoverage', () => {
    it('reports coverage statistics', () => {
      const coverage = engine.checkTestCoverage([
        'src/auth/login.ts',
        'src/auth/login.test.ts',
        'src/auth/register.ts',
      ]);

      expect(coverage.total).toBe(3);
      expect(coverage).toHaveProperty('covered');
      expect(coverage).toHaveProperty('percentage');
      expect(coverage.percentage).toBeGreaterThanOrEqual(0);
      expect(coverage.percentage).toBeLessThanOrEqual(100);
    });

    it('handles empty file list', () => {
      const coverage = engine.checkTestCoverage([]);
      expect(coverage.total).toBe(0);
      expect(coverage.percentage).toBe(100);
    });
  });

  // ── Historical Changes ──────────────────────────────────────────────────

  describe('findHistoricalSimilarChanges', () => {
    it('finds past changes to the same files', () => {
      // Seed a code event in the timeline
      timeline.append({
        timestamp: new Date('2025-05-01T10:00:00Z'),
        source: 'github',
        category: 'code',
        severity: 'info',
        title: 'feat: add login rate limiting',
        description: 'Added rate limiting to login endpoint',
        data: { sha: 'abc123', files: ['src/auth/login.ts'] },
        relatedEventIds: [],
        tags: ['commit'],
        service: 'auth-service',
        actor: 'alice',
      });

      const changes = engine.findHistoricalSimilarChanges(['src/auth/login.ts']);
      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0].author).toBe('alice');
    });

    it('returns empty when no historical overlap', () => {
      const changes = engine.findHistoricalSimilarChanges([
        'src/brand-new-module/handler.ts',
      ]);
      expect(changes).toHaveLength(0);
    });
  });

  // ── Warning Generation ──────────────────────────────────────────────────

  describe('generateWarnings', () => {
    it('warns about missing tests for source files', () => {
      const warnings = engine.generateWarnings(['src/auth/login.ts']);
      const testWarnings = warnings.filter(w => w.type === 'missing_tests');
      expect(testWarnings.length).toBeGreaterThan(0);
      expect(testWarnings[0].file).toBe('src/auth/login.ts');
    });

    it('warns about auth for API files', () => {
      const warnings = engine.generateWarnings(['src/api/users.ts']);
      const authWarnings = warnings.filter(w => w.type === 'missing_auth');
      expect(authWarnings.length).toBeGreaterThan(0);
    });

    it('warns about rate limiting for API files', () => {
      const warnings = engine.generateWarnings(['src/api/users.ts']);
      const rlWarnings = warnings.filter(w => w.type === 'missing_rate_limit');
      expect(rlWarnings.length).toBeGreaterThan(0);
    });

    it('warns about high blast radius', () => {
      // Add incidents linking auth-service to api-gateway and payments
      graph.addIncidentLearning({
        id: 'IL-blast',
        incidentId: 'INC-blast',
        title: 'Cascading failure',
        rootCause: 'Auth went down',
        impact: 'Everything broke',
        resolution: 'Fixed auth',
        lessons: ['Monitor'],
        preventionMeasures: ['Alerts'],
        affectedServices: ['auth-service', 'payments', 'notifications', 'billing', 'user-service'],
        date: new Date('2025-04-15'),
      });

      const warnings = engine.generateWarnings([
        'src/auth-service/core.ts',
      ]);
      const blastWarnings = warnings.filter(w => w.type === 'high_blast_radius');
      expect(blastWarnings.length).toBeGreaterThan(0);
      expect(blastWarnings[0].severity).toBe('critical');
    });

    it('does not warn about tests for test files', () => {
      const warnings = engine.generateWarnings(['src/auth/login.test.ts']);
      const testWarnings = warnings.filter(w => w.type === 'missing_tests');
      expect(testWarnings).toHaveLength(0);
    });

    it('detects breaking changes from diff content', () => {
      const warnings = engine.generateWarnings(
        ['src/lib/types.ts'],
        '-export interface OldApi {\n+export interface NewApi {',
      );
      const breakingWarnings = warnings.filter(w => w.type === 'breaking_change');
      expect(breakingWarnings.length).toBeGreaterThan(0);
      expect(breakingWarnings[0].severity).toBe('critical');
    });

    it('detects removed error handling from diff', () => {
      const warnings = engine.generateWarnings(
        ['src/handler.ts'],
        '-  try {\n-    await doStuff();\n-  catch (err) {',
      );
      const errorWarnings = warnings.filter(
        w => w.type === 'missing_error_handling',
      );
      expect(errorWarnings.length).toBeGreaterThan(0);
    });
  });
});
