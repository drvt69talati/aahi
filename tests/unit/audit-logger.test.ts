import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogger } from '../../runtime/telemetry/audit-logger.js';
import type { AuditEntry } from '../../runtime/telemetry/audit-logger.js';

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  it('logs entries with auto-generated id and timestamp', () => {
    const entry = logger.log({
      actor: 'agent',
      actorId: 'deploy-agent',
      action: 'kubectl.apply',
      resource: 'deployment/api-server',
      params: { namespace: 'production', replicas: 3 },
      result: 'success',
      redactedFields: [],
      durationMs: 1200,
    });

    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(entry.actor).toBe('agent');
    expect(entry.action).toBe('kubectl.apply');
    expect(logger.size).toBe(1);
  });

  it('freezes entries so they cannot be mutated', () => {
    const entry = logger.log({
      actor: 'user',
      actorId: 'user-1',
      action: 'chat.send',
      resource: 'chat/session-1',
      params: { message: 'hello' },
      result: 'success',
      redactedFields: [],
      durationMs: 50,
    });

    // Attempting to modify a frozen entry should throw in strict mode
    expect(() => {
      (entry as any).action = 'modified';
    }).toThrow();

    expect(entry.action).toBe('chat.send');
  });

  it('freezes params and redactedFields', () => {
    const entry = logger.log({
      actor: 'system',
      actorId: 'system',
      action: 'model.call',
      resource: 'openai/gpt-4',
      params: { tokens: 1000 },
      result: 'success',
      redactedFields: ['apiKey'],
      durationMs: 300,
    });

    expect(() => {
      (entry.params as any).injected = true;
    }).toThrow();

    expect(() => {
      (entry.redactedFields as any).push('extra');
    }).toThrow();
  });

  it('queries by actor', () => {
    logger.log({ actor: 'user', actorId: 'u1', action: 'a', resource: 'r', params: {}, result: 'success', redactedFields: [], durationMs: 1 });
    logger.log({ actor: 'agent', actorId: 'a1', action: 'b', resource: 'r', params: {}, result: 'success', redactedFields: [], durationMs: 2 });
    logger.log({ actor: 'user', actorId: 'u2', action: 'c', resource: 'r', params: {}, result: 'failure', redactedFields: [], durationMs: 3 });

    const userEntries = logger.query({ actor: 'user' });
    expect(userEntries.length).toBe(2);
    expect(userEntries.every((e) => e.actor === 'user')).toBe(true);
  });

  it('queries by result', () => {
    logger.log({ actor: 'agent', actorId: 'a1', action: 'deploy', resource: 'r', params: {}, result: 'success', redactedFields: [], durationMs: 100 });
    logger.log({ actor: 'agent', actorId: 'a1', action: 'deploy', resource: 'r', params: {}, result: 'failure', redactedFields: [], durationMs: 200 });
    logger.log({ actor: 'agent', actorId: 'a1', action: 'deploy', resource: 'r', params: {}, result: 'denied', redactedFields: [], durationMs: 50 });

    expect(logger.query({ result: 'failure' }).length).toBe(1);
    expect(logger.query({ result: 'denied' }).length).toBe(1);
  });

  it('queries by time range', () => {
    logger.log({ actor: 'user', actorId: 'u1', action: 'a', resource: 'r', params: {}, result: 'success', redactedFields: [], durationMs: 1, timestamp: new Date('2025-01-01T08:00:00Z') });
    logger.log({ actor: 'user', actorId: 'u1', action: 'b', resource: 'r', params: {}, result: 'success', redactedFields: [], durationMs: 1, timestamp: new Date('2025-01-01T12:00:00Z') });
    logger.log({ actor: 'user', actorId: 'u1', action: 'c', resource: 'r', params: {}, result: 'success', redactedFields: [], durationMs: 1, timestamp: new Date('2025-01-01T18:00:00Z') });

    const results = logger.query({
      timeRange: {
        start: new Date('2025-01-01T10:00:00Z'),
        end: new Date('2025-01-01T14:00:00Z'),
      },
    });
    expect(results.length).toBe(1);
    expect(results[0].action).toBe('b');
  });

  it('exports as JSON', () => {
    logger.log({ actor: 'user', actorId: 'u1', action: 'test', resource: 'r', params: {}, result: 'success', redactedFields: [], durationMs: 1 });

    const json = logger.export('json');
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
  });

  it('exports as CSV', () => {
    logger.log({ actor: 'agent', actorId: 'a1', action: 'deploy', resource: 'prod', params: {}, result: 'success', redactedFields: ['secret'], durationMs: 500 });

    const csv = logger.export('csv');
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id,timestamp,actor');
    expect(lines[1]).toContain('agent');
    expect(lines[1]).toContain('secret');
  });

  it('exports as JSONL', () => {
    logger.log({ actor: 'user', actorId: 'u1', action: 'a', resource: 'r', params: {}, result: 'success', redactedFields: [], durationMs: 1 });
    logger.log({ actor: 'user', actorId: 'u2', action: 'b', resource: 'r', params: {}, result: 'failure', redactedFields: [], durationMs: 2 });

    const jsonl = logger.export('jsonl');
    const lines = jsonl.split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).action).toBe('a');
    expect(JSON.parse(lines[1]).action).toBe('b');
  });

  it('computes stats', () => {
    logger.log({ actor: 'user', actorId: 'u1', action: 'chat', resource: 'r', params: {}, result: 'success', redactedFields: [], durationMs: 10 });
    logger.log({ actor: 'agent', actorId: 'a1', action: 'deploy', resource: 'r', params: {}, result: 'failure', redactedFields: [], durationMs: 20 });
    logger.log({ actor: 'agent', actorId: 'a2', action: 'deploy', resource: 'r', params: {}, result: 'success', redactedFields: [], durationMs: 30 });

    const stats = logger.getStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.byActor['user']).toBe(1);
    expect(stats.byActor['agent']).toBe(2);
    expect(stats.byResult['success']).toBe(2);
    expect(stats.byAction['deploy']).toBe(2);
  });

  it('supports limit and offset in queries', () => {
    for (let i = 0; i < 10; i++) {
      logger.log({ actor: 'user', actorId: 'u1', action: `action-${i}`, resource: 'r', params: {}, result: 'success', redactedFields: [], durationMs: i });
    }

    const page = logger.query({ limit: 3, offset: 2 });
    expect(page.length).toBe(3);
  });
});
