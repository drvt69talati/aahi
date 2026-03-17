// ─────────────────────────────────────────────────────────────────────────────
// Aahi — PTY Manager
// Manages terminal sessions with real shell integration.
// Spawns child processes and streams stdout/stderr to registered handlers.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TerminalSession {
  id: string;
  shell: string;
  cwd: string;
  process: ChildProcess;
  alive: boolean;
}

export interface TerminalSessionInfo {
  id: string;
  shell: string;
  cwd: string;
  alive: boolean;
}

// ─── Manager ────────────────────────────────────────────────────────────────

export class PTYManager {
  private sessions = new Map<string, TerminalSession>();
  private outputHandlers = new Map<string, (data: string) => void>();

  /**
   * Create a new terminal session. Returns the session ID.
   */
  createSession(cwd?: string): string {
    const id = randomUUID();
    const shell =
      process.platform === 'win32'
        ? 'cmd.exe'
        : process.env.SHELL || '/bin/zsh';

    const child = spawn(shell, [], {
      cwd: cwd || process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session: TerminalSession = {
      id,
      shell,
      cwd: cwd || process.cwd(),
      process: child,
      alive: true,
    };

    this.sessions.set(id, session);

    child.stdout?.on('data', (data: Buffer) => {
      this.outputHandlers.get(id)?.(data.toString());
    });

    child.stderr?.on('data', (data: Buffer) => {
      this.outputHandlers.get(id)?.(data.toString());
    });

    child.on('close', () => {
      session.alive = false;
    });

    return id;
  }

  /**
   * Write data (keystrokes, commands) to a terminal session's stdin.
   */
  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.alive) {
      session.process.stdin?.write(data);
    }
  }

  /**
   * Register an output handler for a terminal session.
   * Called whenever stdout or stderr produces data.
   */
  onOutput(sessionId: string, handler: (data: string) => void): void {
    this.outputHandlers.set(sessionId, handler);
  }

  /**
   * Resize a terminal session.
   * Note: Full PTY resize requires node-pty; this is a no-op placeholder
   * for child_process-based sessions.
   */
  resize(_sessionId: string, _cols: number, _rows: number): void {
    // PTY resize — would need node-pty for proper support
  }

  /**
   * Kill a terminal session and clean up.
   */
  killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.process.kill();
      this.sessions.delete(sessionId);
      this.outputHandlers.delete(sessionId);
    }
  }

  /**
   * List all terminal sessions with their current status.
   */
  listSessions(): TerminalSessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      shell: s.shell,
      cwd: s.cwd,
      alive: s.alive,
    }));
  }

  /**
   * Kill all active terminal sessions.
   */
  killAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.killSession(id);
    }
  }
}
