import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComposerEngine } from '../../runtime/ai/composer/composer-engine.js';
import type { ComposerSession, FileOperation } from '../../runtime/ai/composer/composer-engine.js';
import type { AgentDefinition, ExecutionPlan } from '../../runtime/agents/runtime/types.js';
import type { ContextChunk } from '../../runtime/integrations/registry/types.js';

// ─── Mock child_process to avoid real git calls ─────────────────────────────

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => ''),
}));

// ─── Mock Planner Agent ─────────────────────────────────────────────────────

function createMockPlanner(fileOps?: FileOperation[]): AgentDefinition {
  return {
    id: 'planner',
    name: 'MockPlanner',
    description: 'Mock planner for tests',
    triggers: ['*'],
    requiredIntegrations: [],
    capabilities: ['plan.*'],
    defaultModel: 'agent-planning',

    async plan(intent: string, _context: ContextChunk[]): Promise<ExecutionPlan> {
      return {
        id: 'plan-1',
        intent,
        steps: [],
        createdAt: new Date(),
        status: 'pending',
        agentId: 'planner',
      };
    },
  };
}

// ─── Helper: create engine with pre-populated file operations ───────────────

async function createReviewingSession(
  engine: ComposerEngine,
  intent: string,
  files: FileOperation[],
): Promise<ComposerSession> {
  const session = await engine.startSession(intent);
  // Manually inject file operations and set status to reviewing
  session.plan.files = files;
  for (const f of files) f.status = 'applied';
  session.status = 'reviewing';
  return session;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ComposerEngine', () => {
  let engine: ComposerEngine;

  beforeEach(() => {
    engine = new ComposerEngine({
      planner: createMockPlanner(),
      workingDir: '/tmp/aahi-test',
    });
  });

  // ── Session creation ──────────────────────────────────────────────

  it('creates a session with the given intent', async () => {
    const session = await engine.startSession('Add auth middleware to all API routes');

    expect(session.id).toBeDefined();
    expect(session.intent).toBe('Add auth middleware to all API routes');
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.checkpoint).toContain('aahi-composer-');
  });

  it('transitions session through planning to reviewing', async () => {
    const session = await engine.startSession('Refactor user service');

    // With mock planner (no file ops), goes straight to reviewing
    expect(session.status).toBe('reviewing');
  });

  // ── Session retrieval ─────────────────────────────────────────────

  it('retrieves a session by ID', async () => {
    const session = await engine.startSession('Add logging');
    const retrieved = engine.getSession(session.id);

    expect(retrieved).toBe(session);
  });

  it('returns undefined for unknown session ID', () => {
    expect(engine.getSession('nonexistent')).toBeUndefined();
  });

  // ── File operation planning ───────────────────────────────────────

  it('plan contains file operations and integration steps', async () => {
    const session = await engine.startSession('Create user registration flow');

    expect(session.plan).toBeDefined();
    expect(session.plan.files).toBeInstanceOf(Array);
    expect(session.plan.integrationSteps).toBeInstanceOf(Array);
    expect(typeof session.plan.estimatedTokens).toBe('number');
  });

  // ── Per-file accept/reject ────────────────────────────────────────

  it('accepts a single file operation', async () => {
    const files: FileOperation[] = [
      { path: 'src/auth.ts', operation: 'create', content: 'export class Auth {}', status: 'pending' },
      { path: 'src/routes.ts', operation: 'modify', diff: '+import { Auth }', status: 'pending' },
    ];
    const session = await createReviewingSession(engine, 'Add auth', files);

    engine.acceptFile(session.id, 'src/auth.ts');

    expect(session.plan.files[0].status).toBe('accepted');
    expect(session.plan.files[1].status).toBe('applied'); // unchanged
    expect(session.status).toBe('reviewing'); // not complete yet
  });

  it('rejects a single file operation', async () => {
    const files: FileOperation[] = [
      { path: 'src/auth.ts', operation: 'create', content: 'export class Auth {}', status: 'pending' },
      { path: 'src/test.ts', operation: 'create', content: 'test()', status: 'pending' },
    ];
    const session = await createReviewingSession(engine, 'Add auth', files);

    engine.rejectFile(session.id, 'src/test.ts');

    expect(session.plan.files[1].status).toBe('rejected');
    expect(session.status).toBe('reviewing');
  });

  it('completes the session when all files are resolved', async () => {
    const files: FileOperation[] = [
      { path: 'src/auth.ts', operation: 'create', content: '', status: 'pending' },
      { path: 'src/routes.ts', operation: 'modify', diff: '', status: 'pending' },
    ];
    const session = await createReviewingSession(engine, 'Add auth', files);

    engine.acceptFile(session.id, 'src/auth.ts');
    engine.rejectFile(session.id, 'src/routes.ts');

    expect(session.status).toBe('completed');
  });

  it('acceptAll accepts all remaining applied files', async () => {
    const files: FileOperation[] = [
      { path: 'src/a.ts', operation: 'create', content: '', status: 'pending' },
      { path: 'src/b.ts', operation: 'create', content: '', status: 'pending' },
      { path: 'src/c.ts', operation: 'create', content: '', status: 'pending' },
    ];
    const session = await createReviewingSession(engine, 'Create files', files);

    engine.acceptAll(session.id);

    expect(session.plan.files.every(f => f.status === 'accepted')).toBe(true);
    expect(session.status).toBe('completed');
  });

  it('throws when accepting a file in a non-reviewing session', async () => {
    const session = await engine.startSession('Something');
    session.status = 'completed';

    expect(() => engine.acceptFile(session.id, 'src/a.ts')).toThrow("expected 'reviewing'");
  });

  it('throws when file path is not in the plan', async () => {
    const files: FileOperation[] = [
      { path: 'src/auth.ts', operation: 'create', content: '', status: 'pending' },
    ];
    const session = await createReviewingSession(engine, 'Add auth', files);

    expect(() => engine.acceptFile(session.id, 'src/nonexistent.ts')).toThrow('File not found');
  });

  // ── Rollback ──────────────────────────────────────────────────────

  it('rolls back a session to its checkpoint', async () => {
    const files: FileOperation[] = [
      { path: 'src/auth.ts', operation: 'create', content: '', status: 'pending' },
    ];
    const session = await createReviewingSession(engine, 'Add auth', files);

    engine.rollback(session.id);

    expect(session.status).toBe('rolled-back');
  });

  it('resets applied file operations on rollback', async () => {
    const files: FileOperation[] = [
      { path: 'src/a.ts', operation: 'create', content: '', status: 'pending' },
    ];
    const session = await createReviewingSession(engine, 'Create', files);

    engine.rollback(session.id);

    expect(session.plan.files[0].status).toBe('pending');
  });

  it('throws when rolling back a completed session', async () => {
    const files: FileOperation[] = [
      { path: 'src/a.ts', operation: 'create', content: '', status: 'pending' },
    ];
    const session = await createReviewingSession(engine, 'Create', files);
    engine.acceptAll(session.id);

    expect(() => engine.rollback(session.id)).toThrow("Cannot rollback session in 'completed'");
  });

  // ── Session listing ───────────────────────────────────────────────

  it('lists all sessions', async () => {
    await engine.startSession('Task 1');
    await engine.startSession('Task 2');
    await engine.startSession('Task 3');

    const sessions = engine.listSessions();
    expect(sessions).toHaveLength(3);
  });

  it('filters sessions by status', async () => {
    const s1 = await engine.startSession('Task 1');
    await engine.startSession('Task 2');

    s1.status = 'completed';

    const reviewing = engine.listSessions('reviewing');
    const completed = engine.listSessions('completed');

    expect(reviewing).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(completed[0].intent).toBe('Task 1');
  });

  it('throws for unknown session on accept/reject/rollback', () => {
    expect(() => engine.acceptFile('bad-id', 'f.ts')).toThrow('Session not found');
    expect(() => engine.rejectFile('bad-id', 'f.ts')).toThrow('Session not found');
    expect(() => engine.rollback('bad-id')).toThrow('Session not found');
  });
});
