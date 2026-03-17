import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LSPClient } from '../../runtime/integrations/lsp/lsp-client.js';
import type {
  LSPServerConfig,
  Diagnostic,
  TextEdit,
} from '../../runtime/integrations/lsp/lsp-client.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<LSPServerConfig>): LSPServerConfig {
  return {
    languageId: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    rootUri: 'file:///workspace',
    ...overrides,
  };
}

/**
 * Simulate a JSON-RPC response arriving on the client's data handler.
 * Encodes a proper LSP base protocol message (Content-Length header + body).
 */
function simulateResponse(client: LSPClient, message: Record<string, unknown>): void {
  const body = JSON.stringify(message);
  const frame = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`;
  // Use the public handleData method
  (client as any).handleData(frame);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('LSPClient', () => {
  let client: LSPClient;

  beforeEach(() => {
    client = new LSPClient(makeConfig());
  });

  // ── Initialization Handshake ────────────────────────────────────────────

  describe('initialization handshake', () => {
    it('sends an initialize request with correct JSON-RPC structure', () => {
      // We test the message format by capturing what the client would write.
      // Since start() tries to spawn a process, we test the message construction
      // indirectly by verifying the request builder.

      const written: string[] = [];
      const fakeStdin = {
        writable: true,
        write: (data: string) => written.push(data),
      };

      // Inject a mock process
      (client as any).process = {
        stdin: fakeStdin,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };

      // Send a request manually
      (client as any).sendRequest('initialize', {
        processId: 1234,
        rootUri: 'file:///workspace',
        capabilities: {},
      });

      expect(written.length).toBe(1);

      // Parse the written LSP message
      const rawMessage = written[0];
      const headerEnd = rawMessage.indexOf('\r\n\r\n');
      expect(headerEnd).toBeGreaterThan(0);

      const header = rawMessage.slice(0, headerEnd);
      expect(header).toMatch(/^Content-Length: \d+$/);

      const body = JSON.parse(rawMessage.slice(headerEnd + 4));
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(1);
      expect(body.method).toBe('initialize');
      expect(body.params.processId).toBe(1234);
      expect(body.params.rootUri).toBe('file:///workspace');
      expect(body.params.capabilities).toEqual({});
    });

    it('sends initialized notification after receiving initialize response', async () => {
      const written: string[] = [];
      const fakeStdin = {
        writable: true,
        write: (data: string) => written.push(data),
      };
      const onHandlers: Record<string, Function> = {};

      (client as any).process = {
        stdin: fakeStdin,
        stdout: { on: (event: string, handler: Function) => { onHandlers[`stdout.${event}`] = handler; } },
        stderr: { on: (event: string, handler: Function) => { onHandlers[`stderr.${event}`] = handler; } },
        on: (event: string, handler: Function) => { onHandlers[event] = handler; },
        kill: vi.fn(),
        pid: 1234,
      };

      // Manually trigger what start() does internally
      const initPromise = (client as any).sendRequest('initialize', {
        processId: process.pid,
        rootUri: 'file:///workspace',
        capabilities: {},
      });

      // Simulate the server responding to the initialize request
      simulateResponse(client, {
        jsonrpc: '2.0',
        id: 1,
        result: {
          capabilities: {
            textDocumentSync: 1,
            completionProvider: {},
          },
        },
      });

      await initPromise;

      // Now send initialized notification (as start() would)
      (client as any).sendNotification('initialized', {});

      // The second message should be the initialized notification
      expect(written.length).toBe(2);
      const notifBody = JSON.parse(written[1].slice(written[1].indexOf('\r\n\r\n') + 4));
      expect(notifBody.method).toBe('initialized');
      expect(notifBody).not.toHaveProperty('id'); // Notifications have no id
    });
  });

  // ── Document Sync ─────────────────────────────────────────────────────

  describe('document sync', () => {
    let written: string[];

    beforeEach(() => {
      written = [];
      const fakeStdin = {
        writable: true,
        write: (data: string) => written.push(data),
      };
      (client as any).process = {
        stdin: fakeStdin,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };
      (client as any).initialized = true;
    });

    it('sends textDocument/didOpen with correct params', () => {
      client.openDocument('file:///test.ts', 'typescript', 'const x = 1;');

      const body = JSON.parse(written[0].slice(written[0].indexOf('\r\n\r\n') + 4));
      expect(body.method).toBe('textDocument/didOpen');
      expect(body.params.textDocument.uri).toBe('file:///test.ts');
      expect(body.params.textDocument.languageId).toBe('typescript');
      expect(body.params.textDocument.version).toBe(1);
      expect(body.params.textDocument.text).toBe('const x = 1;');
    });

    it('sends textDocument/didChange with incremented version', () => {
      client.openDocument('file:///test.ts', 'typescript', 'const x = 1;');
      written.length = 0; // Clear open message

      const edit: TextEdit = {
        range: { start: { line: 0, character: 10 }, end: { line: 0, character: 11 } },
        newText: '2',
      };
      client.changeDocument('file:///test.ts', [edit]);

      const body = JSON.parse(written[0].slice(written[0].indexOf('\r\n\r\n') + 4));
      expect(body.method).toBe('textDocument/didChange');
      expect(body.params.textDocument.uri).toBe('file:///test.ts');
      expect(body.params.textDocument.version).toBe(2);
      expect(body.params.contentChanges[0].range).toEqual(edit.range);
      expect(body.params.contentChanges[0].text).toBe('2');
    });

    it('sends textDocument/didClose', () => {
      client.openDocument('file:///test.ts', 'typescript', 'const x = 1;');
      written.length = 0;

      client.closeDocument('file:///test.ts');

      const body = JSON.parse(written[0].slice(written[0].indexOf('\r\n\r\n') + 4));
      expect(body.method).toBe('textDocument/didClose');
      expect(body.params.textDocument.uri).toBe('file:///test.ts');
    });

    it('throws when changing a document that is not open', () => {
      const edit: TextEdit = {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        newText: 'x',
      };
      expect(() => client.changeDocument('file:///nonexistent.ts', [edit])).toThrow(
        'Document not open',
      );
    });
  });

  // ── Request ID Generation ─────────────────────────────────────────────

  describe('request ID generation', () => {
    let written: string[];

    beforeEach(() => {
      written = [];
      const fakeStdin = {
        writable: true,
        write: (data: string) => written.push(data),
      };
      (client as any).process = {
        stdin: fakeStdin,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };
    });

    it('generates sequential integer IDs starting at 1', () => {
      expect(client.currentRequestId).toBe(1);

      (client as any).sendRequest('test/method1', {});
      expect(client.currentRequestId).toBe(2);

      (client as any).sendRequest('test/method2', {});
      expect(client.currentRequestId).toBe(3);

      // Verify the IDs in the written messages
      const body1 = JSON.parse(written[0].slice(written[0].indexOf('\r\n\r\n') + 4));
      const body2 = JSON.parse(written[1].slice(written[1].indexOf('\r\n\r\n') + 4));
      expect(body1.id).toBe(1);
      expect(body2.id).toBe(2);
    });

    it('notifications do not have an id field', () => {
      (client as any).sendNotification('test/notification', { key: 'value' });

      const body = JSON.parse(written[0].slice(written[0].indexOf('\r\n\r\n') + 4));
      expect(body).not.toHaveProperty('id');
      expect(body.method).toBe('test/notification');
    });
  });

  // ── Diagnostic Handler ────────────────────────────────────────────────

  describe('diagnostic handler registration', () => {
    it('emits diagnostics when server publishes them', () => {
      const received: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];

      client.onDiagnostics((uri, diagnostics) => {
        received.push({ uri, diagnostics });
      });

      const diagnostics: Diagnostic[] = [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          severity: 1,
          message: 'Type error: number is not assignable to string',
          source: 'typescript',
        },
      ];

      // Simulate a publishDiagnostics notification
      simulateResponse(client, {
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'file:///test.ts',
          diagnostics,
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0].uri).toBe('file:///test.ts');
      expect(received[0].diagnostics).toHaveLength(1);
      expect(received[0].diagnostics[0].severity).toBe(1);
      expect(received[0].diagnostics[0].message).toContain('Type error');
    });

    it('supports multiple diagnostic handlers', () => {
      let count1 = 0;
      let count2 = 0;

      client.onDiagnostics(() => { count1++; });
      client.onDiagnostics(() => { count2++; });

      simulateResponse(client, {
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: 'file:///a.ts', diagnostics: [] },
      });

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });

    it('returns an unsubscribe function that removes the handler', () => {
      let callCount = 0;
      const unsub = client.onDiagnostics(() => { callCount++; });

      simulateResponse(client, {
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: 'file:///a.ts', diagnostics: [] },
      });
      expect(callCount).toBe(1);

      unsub(); // Unsubscribe

      simulateResponse(client, {
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: 'file:///b.ts', diagnostics: [] },
      });
      expect(callCount).toBe(1); // Should NOT have incremented
    });
  });

  // ── Data Parsing ──────────────────────────────────────────────────────

  describe('LSP base protocol parsing', () => {
    it('handles chunked data across multiple calls', () => {
      const received: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];
      client.onDiagnostics((uri, diagnostics) => {
        received.push({ uri, diagnostics });
      });

      const message = {
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: 'file:///chunked.ts', diagnostics: [] },
      };
      const body = JSON.stringify(message);
      const frame = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`;

      // Split the frame in the middle and send in two chunks
      const mid = Math.floor(frame.length / 2);
      (client as any).handleData(frame.slice(0, mid));
      expect(received).toHaveLength(0); // Not yet complete

      (client as any).handleData(frame.slice(mid));
      expect(received).toHaveLength(1);
      expect(received[0].uri).toBe('file:///chunked.ts');
    });

    it('resolves pending requests when response arrives', async () => {
      const fakeStdin = {
        writable: true,
        write: vi.fn(),
      };
      (client as any).process = {
        stdin: fakeStdin,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };

      const promise = (client as any).sendRequest('textDocument/hover', {
        textDocument: { uri: 'file:///test.ts' },
        position: { line: 5, character: 10 },
      });

      // Simulate the response
      simulateResponse(client, {
        jsonrpc: '2.0',
        id: 1,
        result: {
          contents: { kind: 'markdown', value: '```ts\nconst x: number\n```' },
        },
      });

      const result = await promise;
      expect(result).toEqual({
        contents: { kind: 'markdown', value: '```ts\nconst x: number\n```' },
      });
    });
  });
});
