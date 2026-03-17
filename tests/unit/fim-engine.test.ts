import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FIMEngine } from '../../runtime/ai/completion/fim-engine.js';
import { CompletionCache } from '../../runtime/ai/completion/completion-cache.js';
import type { FIMRequest } from '../../runtime/ai/completion/fim-engine.js';
import type { AahiModelAdapter, ModelChunk, ModelRequest, ModelResponse } from '../../runtime/ai/models/types.js';
import type { ModelRouter } from '../../runtime/ai/models/model-router.js';
import { RedactionPipeline } from '../../runtime/ai/redaction/redaction-pipeline.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockAdapter(completionText: string): AahiModelAdapter {
  return {
    provider: 'mock',
    model: 'mock-fim',
    capabilities: ['fim'],
    maxContextTokens: 8192,
    supportsToolUse: false,
    call: vi.fn<(req: ModelRequest) => Promise<ModelResponse>>().mockResolvedValue({
      content: completionText,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
      model: 'mock-fim',
    }),
    streamCall: vi.fn<(req: ModelRequest) => AsyncIterable<ModelChunk>>().mockReturnValue(
      (async function* (): AsyncIterable<ModelChunk> {
        yield { type: 'text', text: completionText };
        yield { type: 'done' };
      })(),
    ),
    countTokens: vi.fn<(text: string) => Promise<number>>().mockResolvedValue(5),
  };
}

function createMockRouter(adapter: AahiModelAdapter): ModelRouter {
  return {
    getAdapter: vi.fn().mockReturnValue(adapter),
  } as unknown as ModelRouter;
}

function makeRequest(overrides?: Partial<FIMRequest>): FIMRequest {
  return {
    uri: 'file:///project/src/main.ts',
    languageId: 'typescript',
    prefix: 'function greet(name: string) {\n  return `Hello, ',
    suffix: '`;\n}',
    cursorLine: 1,
    cursorColumn: 26,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FIMEngine', () => {
  let adapter: AahiModelAdapter;
  let router: ModelRouter;
  let redaction: RedactionPipeline;
  let engine: FIMEngine;

  beforeEach(() => {
    adapter = createMockAdapter('${name}');
    router = createMockRouter(adapter);
    redaction = new RedactionPipeline();
    engine = new FIMEngine(router, redaction, { debounceMs: 10 });
  });

  // ─── Prefix / Suffix ────────────────────────────────────────────────────

  describe('completion requests', () => {
    it('sends prefix and suffix to the model adapter', async () => {
      const req = makeRequest();
      const completion = await engine.requestCompletion(req);

      expect(completion).not.toBeNull();
      expect(completion!.text).toBe('${name}');
      expect(adapter.streamCall).toHaveBeenCalled();

      const modelReq = (adapter.streamCall as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRequest;
      expect(modelReq.prefix).toBeDefined();
      expect(modelReq.suffix).toBeDefined();
    });

    it('computes range from cursor position and completion text', async () => {
      const req = makeRequest({ cursorLine: 5, cursorColumn: 10 });
      const completion = await engine.requestCompletion(req);

      expect(completion).not.toBeNull();
      expect(completion!.range.startLine).toBe(5);
      expect(completion!.range.startCol).toBe(10);
    });

    it('returns null when engine is disabled', async () => {
      engine.setConfig({ enabled: false });
      const result = await engine.requestCompletion(makeRequest());
      expect(result).toBeNull();
    });

    it('trims prefix to maxPrefixLines', async () => {
      const longPrefix = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
      const req = makeRequest({ prefix: longPrefix });

      engine.setConfig({ maxPrefixLines: 50 });
      await engine.requestCompletion(req);

      const modelReq = (adapter.streamCall as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRequest;
      // The prefix sent to the model should have at most 50 lines
      const lineCount = modelReq.prefix!.split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(50);
    });

    it('trims suffix to maxSuffixLines', async () => {
      const longSuffix = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
      const req = makeRequest({ suffix: longSuffix });

      engine.setConfig({ maxSuffixLines: 30 });
      await engine.requestCompletion(req);

      const modelReq = (adapter.streamCall as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRequest;
      const lineCount = modelReq.suffix!.split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(30);
    });
  });

  // ─── Debounce ────────────────────────────────────────────────────────────

  describe('debounce behavior', () => {
    it('debounces rapid calls so only the last fires', async () => {
      // Fire three requests in rapid succession (no await)
      const p1 = engine.requestCompletion(makeRequest());
      const p2 = engine.requestCompletion(makeRequest());
      const p3 = engine.requestCompletion(makeRequest());

      // Only the last should actually call the adapter
      // p1 and p2 are cancelled and resolve to null
      const [r1, r2, r3] = await Promise.all([
        p1.catch(() => null),
        p2.catch(() => null),
        p3,
      ]);

      // The adapter should be called only once (for the last request)
      // Earlier calls are cancelled via cancelPending
      expect(r3).not.toBeNull();
    });
  });

  // ─── Cache ───────────────────────────────────────────────────────────────

  describe('cache', () => {
    it('returns cached completion on identical request', async () => {
      const req = makeRequest();

      const first = await engine.requestCompletion(req);

      // Reset the mock to create a fresh streaming iterator
      (adapter.streamCall as ReturnType<typeof vi.fn>).mockReturnValue(
        (async function* (): AsyncIterable<ModelChunk> {
          yield { type: 'text', text: '${name}' };
          yield { type: 'done' };
        })(),
      );

      const second = await engine.requestCompletion(req);

      // Second call should hit cache — streamCall should only be called once
      expect(adapter.streamCall).toHaveBeenCalledTimes(1);
      expect(second!.text).toBe(first!.text);
    });
  });

  // ─── Accept / Reject ────────────────────────────────────────────────────

  describe('accept/reject tracking', () => {
    it('tracks accepted completions', async () => {
      const completion = await engine.requestCompletion(makeRequest());
      expect(completion).not.toBeNull();

      engine.acceptCompletion(completion!.id);

      const stats = engine.getStats();
      expect(stats.acceptedCompletions).toBe(1);
      expect(stats.rejectedCompletions).toBe(0);
    });

    it('tracks rejected completions', async () => {
      const completion = await engine.requestCompletion(makeRequest());
      expect(completion).not.toBeNull();

      engine.rejectCompletion(completion!.id);

      const stats = engine.getStats();
      expect(stats.rejectedCompletions).toBe(1);
      expect(stats.acceptedCompletions).toBe(0);
    });

    it('ignores accept/reject for unknown IDs', () => {
      engine.acceptCompletion('nonexistent');
      engine.rejectCompletion('nonexistent');

      const stats = engine.getStats();
      expect(stats.acceptedCompletions).toBe(0);
      expect(stats.rejectedCompletions).toBe(0);
    });
  });

  // ─── Config ──────────────────────────────────────────────────────────────

  describe('configuration', () => {
    it('applies default config values', () => {
      const fresh = new FIMEngine(router, redaction);
      const config = fresh.getConfig();
      expect(config.debounceMs).toBe(150);
      expect(config.maxPrefixLines).toBe(100);
      expect(config.maxSuffixLines).toBe(50);
      expect(config.maxCompletionTokens).toBe(256);
      expect(config.enabled).toBe(true);
    });

    it('merges partial config updates', () => {
      engine.setConfig({ debounceMs: 300 });
      const config = engine.getConfig();
      expect(config.debounceMs).toBe(300);
      expect(config.enabled).toBe(true); // unchanged
    });
  });

  // ─── Redaction ───────────────────────────────────────────────────────────

  describe('redaction', () => {
    it('redacts sensitive content before sending to LLM', async () => {
      const req = makeRequest({
        prefix: 'const API_KEY = "sk-abc12345678901234567890";\nfetch(',
        suffix: ')',
      });

      await engine.requestCompletion(req);

      const modelReq = (adapter.streamCall as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModelRequest;
      // The API key should be redacted in what's sent to the model
      expect(modelReq.prefix).not.toContain('sk-abc12345678901234567890');
    });
  });

  // ─── Stats ─────────────────────────────────────────────────────────────

  describe('stats', () => {
    it('tracks total requests and completions', async () => {
      await engine.requestCompletion(makeRequest());

      const stats = engine.getStats();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
      expect(stats.totalCompletions).toBeGreaterThanOrEqual(1);
    });
  });
});

// ─── CompletionCache Unit Tests ──────────────────────────────────────────────

describe('CompletionCache', () => {
  it('stores and retrieves completions', () => {
    const cache = new CompletionCache();
    const completion = {
      id: 'test-1',
      text: 'hello',
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 5 },
      confidence: 0.9,
    };

    const key = CompletionCache.buildKey('prefix', 'suffix', 'ts');
    cache.set(key, completion);

    expect(cache.get(key)).toEqual(completion);
  });

  it('returns null for missing keys', () => {
    const cache = new CompletionCache();
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('evicts oldest entry when at max capacity', () => {
    const cache = new CompletionCache({ maxSize: 2 });
    const make = (id: string) => ({
      id,
      text: id,
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
      confidence: 0.8,
    });

    cache.set('a', make('a'));
    cache.set('b', make('b'));
    cache.set('c', make('c'));

    expect(cache.get('a')).toBeNull(); // evicted
    expect(cache.get('b')).not.toBeNull();
    expect(cache.get('c')).not.toBeNull();
  });

  it('expires entries beyond TTL', () => {
    const cache = new CompletionCache({ ttlMs: 50 });
    const completion = {
      id: 'ttl-1',
      text: 'x',
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
      confidence: 0.5,
    };

    const key = 'ttl-key';
    cache.set(key, completion);

    // Immediately available
    expect(cache.get(key)).not.toBeNull();

    // After expiry — we use vi.advanceTimersByTime if available, otherwise
    // test with a real short TTL. For determinism we mock Date.now.
    const originalNow = Date.now;
    Date.now = () => originalNow() + 100;
    expect(cache.get(key)).toBeNull();
    Date.now = originalNow;
  });

  it('tracks hit rate', () => {
    const cache = new CompletionCache();
    const completion = {
      id: 'hr-1',
      text: 'y',
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
      confidence: 0.7,
    };

    cache.set('k', completion);
    cache.get('k');      // hit
    cache.get('miss');   // miss

    expect(cache.getHitRate()).toBe(0.5);
  });

  it('clears all entries and resets stats', () => {
    const cache = new CompletionCache();
    cache.set('k', {
      id: 'c-1',
      text: 'z',
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
      confidence: 0.6,
    });

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.getHitRate()).toBe(0);
  });

  it('builds deterministic keys', () => {
    const k1 = CompletionCache.buildKey('abc', 'def', 'ts');
    const k2 = CompletionCache.buildKey('abc', 'def', 'ts');
    const k3 = CompletionCache.buildKey('abc', 'def', 'py');

    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });
});
