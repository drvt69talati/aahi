// ─────────────────────────────────────────────────────────────────────────────
// Aahi — LSP Client
// Universal Language Server Protocol client. Connects to any LSP-compliant
// language server. Replaces the need for VSCode extension compatibility.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LSPServerConfig {
  languageId: string;
  command: string;
  args?: string[];
  rootUri: string;
  env?: Record<string, string>;
}

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Diagnostic {
  range: Range;
  severity: 1 | 2 | 3 | 4; // Error, Warning, Info, Hint
  message: string;
  source?: string;
  code?: string | number;
}

export interface CompletionItem {
  label: string;
  kind: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  textEdit?: TextEdit;
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface HoverResult {
  contents: string;
  range?: Range;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: Diagnostic[];
  edit?: WorkspaceEdit;
  command?: { title: string; command: string; arguments?: unknown[] };
}

export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  method: string;
}

interface OpenDocument {
  uri: string;
  languageId: string;
  version: number;
  content: string;
}

// ─── LSP Client ─────────────────────────────────────────────────────────────

export class LSPClient {
  readonly config: LSPServerConfig;

  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private emitter = new EventEmitter();
  private buffer = '';
  private contentLength = -1;
  private initialized = false;
  private openDocuments = new Map<string, OpenDocument>();

  constructor(config: LSPServerConfig) {
    this.config = config;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.process = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.config.env },
    });

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.handleData(chunk.toString('utf-8'));
    });

    this.process.stderr!.on('data', (chunk: Buffer) => {
      this.emitter.emit('log', chunk.toString('utf-8'));
    });

    this.process.on('exit', (code) => {
      this.emitter.emit('exit', code);
      this.rejectAllPending(new Error(`LSP server exited with code ${code}`));
    });

    // Initialize handshake
    const initResult = await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: this.config.rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: true,
          },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          hover: {
            contentFormat: ['markdown', 'plaintext'],
          },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          formatting: { dynamicRegistration: false },
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  'quickfix',
                  'refactor',
                  'refactor.extract',
                  'refactor.inline',
                  'refactor.rewrite',
                  'source',
                  'source.organizeImports',
                ],
              },
            },
          },
          publishDiagnostics: {
            relatedInformation: true,
          },
        },
        workspace: {
          workspaceFolders: true,
        },
      },
      workspaceFolders: [
        {
          uri: this.config.rootUri,
          name: this.config.rootUri.split('/').pop() ?? 'workspace',
        },
      ],
    });

    // Send initialized notification
    this.sendNotification('initialized', {});
    this.initialized = true;

    return initResult as unknown as void;
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    try {
      await this.sendRequest('shutdown', null);
      this.sendNotification('exit', undefined);
    } catch {
      // Server may already be gone
    }

    this.process.kill();
    this.process = null;
    this.initialized = false;
    this.openDocuments.clear();
    this.rejectAllPending(new Error('LSP client stopped'));
  }

  get isRunning(): boolean {
    return this.initialized && this.process !== null;
  }

  // ── Document Sync ─────────────────────────────────────────────────────

  openDocument(uri: string, languageId: string, content: string): void {
    this.assertRunning();

    const doc: OpenDocument = { uri, languageId, version: 1, content };
    this.openDocuments.set(uri, doc);

    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: doc.version,
        text: content,
      },
    });
  }

  changeDocument(uri: string, changes: TextEdit[]): void {
    this.assertRunning();

    const doc = this.openDocuments.get(uri);
    if (!doc) throw new Error(`Document not open: ${uri}`);

    doc.version++;

    // Apply changes to our tracked content
    for (const change of changes) {
      doc.content = applyTextEdit(doc.content, change);
    }

    this.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: doc.version },
      contentChanges: changes.map((c) => ({
        range: c.range,
        text: c.newText,
      })),
    });
  }

  closeDocument(uri: string): void {
    this.assertRunning();

    this.openDocuments.delete(uri);

    this.sendNotification('textDocument/didClose', {
      textDocument: { uri },
    });
  }

  // ── LSP Feature Requests ──────────────────────────────────────────────

  async getCompletions(uri: string, position: Position): Promise<CompletionItem[]> {
    this.assertRunning();

    const result = await this.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position,
    });

    if (!result) return [];

    // Response can be CompletionItem[] or CompletionList
    const items = Array.isArray(result) ? result : (result as any).items ?? [];
    return items.map(normalizeCompletionItem);
  }

  async getHover(uri: string, position: Position): Promise<HoverResult | null> {
    this.assertRunning();

    const result = await this.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position,
    });

    if (!result) return null;

    const hover = result as any;
    const contents = normalizeHoverContents(hover.contents);
    return { contents, range: hover.range };
  }

  async getDefinition(uri: string, position: Position): Promise<Location[]> {
    this.assertRunning();

    const result = await this.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position,
    });

    if (!result) return [];
    return normalizeLocations(result);
  }

  async getReferences(uri: string, position: Position): Promise<Location[]> {
    this.assertRunning();

    const result = await this.sendRequest('textDocument/references', {
      textDocument: { uri },
      position,
      context: { includeDeclaration: true },
    });

    if (!result) return [];
    return normalizeLocations(result);
  }

  async formatDocument(uri: string): Promise<TextEdit[]> {
    this.assertRunning();

    const result = await this.sendRequest('textDocument/formatting', {
      textDocument: { uri },
      options: {
        tabSize: 2,
        insertSpaces: true,
      },
    });

    if (!result) return [];
    return result as TextEdit[];
  }

  async getCodeActions(
    uri: string,
    range: Range,
    diagnostics: Diagnostic[],
  ): Promise<CodeAction[]> {
    this.assertRunning();

    const result = await this.sendRequest('textDocument/codeAction', {
      textDocument: { uri },
      range,
      context: { diagnostics },
    });

    if (!result) return [];
    return result as CodeAction[];
  }

  // ── Events ────────────────────────────────────────────────────────────

  /**
   * Register a handler for diagnostics published by the server.
   * Returns an unsubscribe function.
   */
  onDiagnostics(handler: (uri: string, diagnostics: Diagnostic[]) => void): () => void {
    const listener = (uri: string, diagnostics: Diagnostic[]) => handler(uri, diagnostics);
    this.emitter.on('diagnostics', listener);
    return () => this.emitter.off('diagnostics', listener);
  }

  /**
   * Register a handler for server log output (stderr).
   */
  onLog(handler: (message: string) => void): () => void {
    this.emitter.on('log', handler);
    return () => this.emitter.off('log', handler);
  }

  /**
   * Register a handler for server exit.
   */
  onExit(handler: (code: number | null) => void): () => void {
    this.emitter.on('exit', handler);
    return () => this.emitter.off('exit', handler);
  }

  // ── JSON-RPC Transport ────────────────────────────────────────────────

  /** Exposed for testing — returns the current request ID counter. */
  get currentRequestId(): number {
    return this.nextId;
  }

  sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params: params ?? undefined,
      };

      this.pending.set(id, { resolve, reject, method });
      this.writeMessage(request);
    });
  }

  sendNotification(method: string, params: unknown): void {
    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params: params ?? undefined,
    };
    this.writeMessage(notification);
  }

  private writeMessage(message: JSONRPCRequest | JSONRPCNotification): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('LSP server stdin is not writable');
    }

    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`;
    this.process.stdin.write(header + body);
  }

  /**
   * Parse incoming data from the language server stdout.
   * Implements the LSP base protocol (Content-Length header framing).
   */
  handleData(data: string): void {
    this.buffer += data;

    while (true) {
      if (this.contentLength === -1) {
        // Look for the Content-Length header
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const header = this.buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          // Malformed header — skip past it
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }

        this.contentLength = parseInt(match[1], 10);
        this.buffer = this.buffer.slice(headerEnd + 4);
      }

      // We have a content-length, wait for the full body
      if (Buffer.byteLength(this.buffer, 'utf-8') < this.contentLength) break;

      const body = this.buffer.slice(0, this.contentLength);
      this.buffer = this.buffer.slice(this.contentLength);
      this.contentLength = -1;

      try {
        const message = JSON.parse(body);
        this.handleMessage(message);
      } catch {
        // Malformed JSON — drop it
      }
    }
  }

  private handleMessage(message: any): void {
    // Response to a request we sent
    if ('id' in message && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(`LSP error (${pending.method}): ${message.error.message} [${message.error.code}]`),
          );
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // Server notification
    if ('method' in message && !('id' in message)) {
      this.handleNotification(message.method, message.params);
      return;
    }

    // Server request (we respond with capabilities)
    if ('method' in message && 'id' in message) {
      this.handleServerRequest(message.id, message.method, message.params);
    }
  }

  private handleNotification(method: string, params: any): void {
    switch (method) {
      case 'textDocument/publishDiagnostics':
        this.emitter.emit('diagnostics', params.uri, params.diagnostics ?? []);
        break;
      case 'window/logMessage':
        this.emitter.emit('log', params.message ?? '');
        break;
      default:
        this.emitter.emit('notification', method, params);
        break;
    }
  }

  private handleServerRequest(id: number, method: string, _params: any): void {
    // Respond to server-initiated requests with empty responses
    // (e.g. workspace/configuration, window/workDoneProgress/create)
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      result: null,
    };
    const body = JSON.stringify(response);
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`;
    this.process?.stdin?.write(header + body);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private assertRunning(): void {
    if (!this.process) {
      throw new Error('LSP client is not running — call start() first');
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeCompletionItem(raw: any): CompletionItem {
  return {
    label: raw.label,
    kind: raw.kind ?? 1,
    detail: raw.detail,
    documentation:
      typeof raw.documentation === 'string'
        ? raw.documentation
        : raw.documentation?.value,
    insertText: raw.insertText ?? raw.label,
    textEdit: raw.textEdit,
  };
}

function normalizeHoverContents(contents: any): string {
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === 'string' ? c : c.value ?? ''))
      .join('\n\n');
  }
  if (contents?.value) return contents.value;
  if (contents?.kind) return contents.value ?? '';
  return String(contents ?? '');
}

function normalizeLocations(raw: any): Location[] {
  if (Array.isArray(raw)) {
    return raw.map((loc: any) => ({
      uri: loc.uri ?? loc.targetUri,
      range: loc.range ?? loc.targetSelectionRange ?? loc.targetRange,
    }));
  }
  // Single location
  if (raw.uri) return [{ uri: raw.uri, range: raw.range }];
  if (raw.targetUri) {
    return [{ uri: raw.targetUri, range: raw.targetSelectionRange ?? raw.targetRange }];
  }
  return [];
}

function applyTextEdit(content: string, edit: TextEdit): string {
  const lines = content.split('\n');
  const { start, end } = edit.range;

  const beforeEdit = lines.slice(0, start.line);
  const startLine = lines[start.line] ?? '';
  const endLine = lines[end.line] ?? '';

  const prefix = startLine.slice(0, start.character);
  const suffix = endLine.slice(end.character);
  const afterEdit = lines.slice(end.line + 1);

  const newLines = (prefix + edit.newText + suffix).split('\n');
  return [...beforeEdit, ...newLines, ...afterEdit].join('\n');
}
