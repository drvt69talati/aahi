import { describe, it, expect, beforeEach } from 'vitest';
import { ContextEngine, type ContextSource } from '../../src/ai/context/context-engine.js';
import { RedactionPipeline } from '../../src/ai/redaction/redaction-pipeline.js';

function makeSource(
  id: string,
  type: ContextSource['type'],
  priority: number,
  content: string,
  tokenEstimate?: number,
): ContextSource {
  return {
    id,
    type,
    priority,
    chunks: [
      {
        source: id,
        type: type === 'rag' || type === 'integration' ? 'code' : (type as any),
        content,
        timestamp: new Date(),
        tokenEstimate: tokenEstimate ?? Math.ceil(content.length / 4),
      },
    ],
  };
}

describe('ContextEngine', () => {
  let engine: ContextEngine;
  let redaction: RedactionPipeline;

  beforeEach(() => {
    redaction = new RedactionPipeline();
    engine = new ContextEngine(8192, redaction);
  });

  // ─── Source Management ──────────────────────────────────────────────

  it('adds and retrieves sources', () => {
    const source = makeSource('logs-1', 'logs', 80, 'Error in auth service');
    engine.addSource(source);
    expect(engine.getSource('logs-1')).toBeDefined();
    expect(engine.getSource('logs-1')!.priority).toBe(80);
  });

  it('removes sources', () => {
    engine.addSource(makeSource('s1', 'file', 50, 'content'));
    engine.removeSource('s1');
    expect(engine.getSource('s1')).toBeUndefined();
  });

  // ─── Priority Ranking ──────────────────────────────────────────────

  it('assembles sources ordered by priority (highest first)', () => {
    engine.addSource(makeSource('low', 'logs', 10, 'low priority data'));
    engine.addSource(makeSource('high', 'file', 90, 'high priority data'));
    engine.addSource(makeSource('mid', 'metrics', 50, 'mid priority data'));

    const assembly = engine.assemble();
    const ids = assembly.sources.map((s) => s.id);

    expect(ids[0]).toBe('high');
    expect(ids[1]).toBe('mid');
    expect(ids[2]).toBe('low');
  });

  // ─── Budget Management ─────────────────────────────────────────────

  it('respects token budget and does not exceed maxTokens', () => {
    // Each source has ~100 token estimate
    engine.addSource(makeSource('s1', 'file', 50, 'A'.repeat(400), 100));
    engine.addSource(makeSource('s2', 'logs', 50, 'B'.repeat(400), 100));

    const assembly = engine.assemble();
    expect(assembly.totalTokens).toBeLessThanOrEqual(8192);
    expect(assembly.budget.maxTokens).toBe(8192);
  });

  it('drops chunks that exceed allocated budget for a source', () => {
    // Create a source with a huge chunk that can't possibly fit
    const bigContent = 'X'.repeat(100_000);
    engine.addSource(makeSource('big', 'file', 50, bigContent, 50_000));
    engine.addSource(makeSource('small', 'logs', 50, 'small data', 10));

    const assembly = engine.assemble();
    // The big source should be excluded because its single chunk exceeds allocation
    const bigSource = assembly.sources.find((s) => s.id === 'big');
    expect(bigSource).toBeUndefined();
    // The small source should still be present
    const smallSource = assembly.sources.find((s) => s.id === 'small');
    expect(smallSource).toBeDefined();
  });

  // ─── Redaction ─────────────────────────────────────────────────────

  it('redacts sensitive data in assembled context', () => {
    engine.addSource(
      makeSource('secrets', 'file', 80, 'API key: sk-abc123def456ghijklmnopqrstuvwx'),
    );

    const assembly = engine.assemble();
    expect(assembly.redacted).toBe(true);
    expect(assembly.redactionMapId).toBeDefined();

    const content = assembly.sources[0].chunks[0].content;
    expect(content).not.toContain('sk-abc123def456ghijklmnopqrstuvwx');
    expect(content).toContain('<API_KEY_');
  });

  // ─── Usage Stats ──────────────────────────────────────────────────

  it('reports usage stats per source', () => {
    engine.addSource(makeSource('s1', 'file', 80, 'file content'));
    engine.addSource(makeSource('s2', 'logs', 40, 'log content'));

    const stats = engine.getUsageStats();
    expect(stats).toHaveLength(2);
    expect(stats[0].sourceId).toBe('s1'); // higher priority first
    expect(stats[0].priority).toBe(80);
    expect(stats[1].sourceId).toBe('s2');
  });

  it('reports budget stats', () => {
    engine.addSource(makeSource('s1', 'file', 50, 'content'));
    const budgetStats = engine.getBudgetStats();
    expect(budgetStats.totalBudget).toBe(8192);
    expect(budgetStats.allocatable).toBeLessThan(8192); // reserved tokens subtracted
  });

  // ─── Mention Parsing ──────────────────────────────────────────────

  it('parses mentions from messages', () => {
    const mentions = engine.parseMentions('Check @file:src/auth.ts and @logs:api-service');
    expect(mentions).toHaveLength(2);
    expect(mentions[0].type).toBe('file');
    expect(mentions[0].value).toBe('src/auth.ts');
    expect(mentions[1].type).toBe('logs');
    expect(mentions[1].value).toBe('api-service');
  });

  // ─── Assembly with no sources ─────────────────────────────────────

  it('returns empty assembly when no sources are registered', () => {
    const assembly = engine.assemble();
    expect(assembly.sources).toHaveLength(0);
    expect(assembly.totalTokens).toBe(0);
    expect(assembly.redacted).toBe(true);
  });
});
