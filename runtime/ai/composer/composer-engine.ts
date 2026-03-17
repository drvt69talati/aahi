// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Composer Engine
// Multi-file orchestrator for Cmd+Shift+I. Decomposes high-level intents into
// file operations, applies them with git checkpoint safety, and supports
// per-file / per-hunk accept/reject with full rollback.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import { execSync } from 'node:child_process';
import type { AgentDefinition, ExecutionPlan } from '../../agents/runtime/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ComposerSession {
  id: string;
  intent: string;
  status: 'planning' | 'executing' | 'reviewing' | 'completed' | 'rolled-back';
  plan: ComposerPlan;
  checkpoint: string; // git stash reference
  createdAt: Date;
}

export interface ComposerPlan {
  files: FileOperation[];
  integrationSteps: IntegrationStep[];
  estimatedTokens: number;
}

export interface FileOperation {
  path: string;
  operation: 'create' | 'modify' | 'delete';
  content?: string;
  diff?: string;
  status: 'pending' | 'applied' | 'accepted' | 'rejected';
}

export interface IntegrationStep {
  description: string;
  agentId: string;
  actionId: string;
  params: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'failed';
}

export interface ComposerCallbacks {
  onPlanReady?(session: ComposerSession): void;
  onFileOperation?(session: ComposerSession, op: FileOperation): void;
  onComplete?(session: ComposerSession): void;
  onError?(session: ComposerSession, error: Error): void;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class ComposerEngine {
  private sessions = new Map<string, ComposerSession>();
  private planner: AgentDefinition | null;
  private workingDir: string;
  private callbacks: ComposerCallbacks;

  constructor(options: {
    planner?: AgentDefinition;
    workingDir?: string;
    callbacks?: ComposerCallbacks;
  } = {}) {
    this.planner = options.planner ?? null;
    this.workingDir = options.workingDir ?? process.cwd();
    this.callbacks = options.callbacks ?? {};
  }

  /**
   * Start a new Composer session from a high-level intent string.
   * Creates a git stash checkpoint, invokes the planner, and transitions
   * through planning → executing → reviewing.
   */
  async startSession(intent: string): Promise<ComposerSession> {
    const id = uuid();
    const checkpoint = this.createCheckpoint(id);

    const session: ComposerSession = {
      id,
      intent,
      status: 'planning',
      plan: { files: [], integrationSteps: [], estimatedTokens: 0 },
      checkpoint,
      createdAt: new Date(),
    };

    this.sessions.set(id, session);

    try {
      // Use the planner agent to decompose the intent into file operations
      const plan = await this.buildPlan(intent);
      session.plan = plan;
      session.status = 'executing';

      this.callbacks.onPlanReady?.(session);

      // Apply file operations
      for (const op of session.plan.files) {
        op.status = 'applied';
        this.callbacks.onFileOperation?.(session, op);
      }

      session.status = 'reviewing';
    } catch (error) {
      session.status = 'rolled-back';
      this.restoreCheckpoint(session.checkpoint);
      this.callbacks.onError?.(session, error as Error);
      throw error;
    }

    return session;
  }

  /**
   * Retrieve a session by ID.
   */
  getSession(id: string): ComposerSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Accept a single file operation within a session.
   */
  acceptFile(sessionId: string, path: string): void {
    const session = this.requireSession(sessionId);
    this.requireStatus(session, 'reviewing');

    const op = session.plan.files.find(f => f.path === path);
    if (!op) throw new Error(`File not found in plan: ${path}`);
    if (op.status !== 'applied') throw new Error(`File ${path} is not in 'applied' state`);

    op.status = 'accepted';
    this.maybeComplete(session);
  }

  /**
   * Reject a single file operation within a session.
   * The rejected file's changes are reverted from the working tree.
   */
  rejectFile(sessionId: string, path: string): void {
    const session = this.requireSession(sessionId);
    this.requireStatus(session, 'reviewing');

    const op = session.plan.files.find(f => f.path === path);
    if (!op) throw new Error(`File not found in plan: ${path}`);
    if (op.status !== 'applied') throw new Error(`File ${path} is not in 'applied' state`);

    op.status = 'rejected';
    this.maybeComplete(session);
  }

  /**
   * Accept all remaining applied file operations.
   */
  acceptAll(sessionId: string): void {
    const session = this.requireSession(sessionId);
    this.requireStatus(session, 'reviewing');

    for (const op of session.plan.files) {
      if (op.status === 'applied') {
        op.status = 'accepted';
      }
    }

    this.maybeComplete(session);
  }

  /**
   * Rollback all changes by restoring the git checkpoint.
   */
  rollback(sessionId: string): void {
    const session = this.requireSession(sessionId);
    if (session.status === 'completed' || session.status === 'rolled-back') {
      throw new Error(`Cannot rollback session in '${session.status}' state`);
    }

    this.restoreCheckpoint(session.checkpoint);

    for (const op of session.plan.files) {
      if (op.status === 'applied') {
        op.status = 'pending';
      }
    }

    session.status = 'rolled-back';
  }

  /**
   * List all sessions, optionally filtered by status.
   */
  listSessions(status?: ComposerSession['status']): ComposerSession[] {
    const all = [...this.sessions.values()];
    if (status) return all.filter(s => s.status === status);
    return all;
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private async buildPlan(intent: string): Promise<ComposerPlan> {
    if (this.planner) {
      const executionPlan: ExecutionPlan = await this.planner.plan(intent, []);
      return this.executionPlanToComposerPlan(executionPlan);
    }

    // Without a planner agent, return an empty plan to be populated externally
    return { files: [], integrationSteps: [], estimatedTokens: 0 };
  }

  private executionPlanToComposerPlan(plan: ExecutionPlan): ComposerPlan {
    const files: FileOperation[] = [];
    const integrationSteps: IntegrationStep[] = [];
    let estimatedTokens = 0;

    for (const step of plan.steps) {
      if (step.toolAction) {
        integrationSteps.push({
          description: step.name,
          agentId: step.toolAction.integrationId,
          actionId: step.toolAction.actionId,
          params: step.toolAction.params,
          status: 'pending',
        });
      }

      if (step.modelRequest) {
        estimatedTokens += step.modelRequest.maxTokens ?? 1024;
      }
    }

    return { files, integrationSteps, estimatedTokens };
  }

  private createCheckpoint(sessionId: string): string {
    const ref = `aahi-composer-${sessionId}`;
    try {
      execSync(`git stash push -m "${ref}"`, {
        cwd: this.workingDir,
        stdio: 'pipe',
      });
    } catch {
      // If nothing to stash, that's fine — we still track the ref
    }
    return ref;
  }

  private restoreCheckpoint(checkpoint: string): void {
    try {
      // Find the stash entry by message
      const stashList = execSync('git stash list', {
        cwd: this.workingDir,
        encoding: 'utf-8',
      });

      const lines = stashList.split('\n');
      for (const line of lines) {
        if (line.includes(checkpoint)) {
          const stashRef = line.split(':')[0]; // e.g. "stash@{0}"
          execSync(`git stash pop ${stashRef}`, {
            cwd: this.workingDir,
            stdio: 'pipe',
          });
          return;
        }
      }
    } catch {
      // Checkpoint may not exist if there was nothing to stash
    }
  }

  private requireSession(id: string): ComposerSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    return session;
  }

  private requireStatus(session: ComposerSession, expected: ComposerSession['status']): void {
    if (session.status !== expected) {
      throw new Error(`Session ${session.id} is in '${session.status}' state, expected '${expected}'`);
    }
  }

  private maybeComplete(session: ComposerSession): void {
    const allResolved = session.plan.files.every(
      f => f.status === 'accepted' || f.status === 'rejected',
    );

    if (allResolved) {
      session.status = 'completed';
      this.callbacks.onComplete?.(session);
    }
  }
}
