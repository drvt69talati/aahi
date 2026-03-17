// ─────────────────────────────────────────────────────────────────────────────
// Aahi — FIM (Fill-In-Middle) Completion Engine
// Drives inline autocomplete by extracting prefix/suffix around the cursor,
// redacting sensitive data, and streaming completions from the fastest model.
// ─────────────────────────────────────────────────────────────────────────────

import type { ModelRouter } from '../models/model-router.js';
import type { ModelChunk } from '../models/types.js';
import type { RedactionPipeline } from '../redaction/redaction-pipeline.js';
import { CompletionCache } from './completion-cache.js';

// ─── Public Types ────────────────────────────────────────────────────────────

export interface FIMRequest {
  uri: string;
  languageId: string;
  prefix: string;
  suffix: string;
  cursorLine: number;
  cursorColumn: number;
  maxTokens?: number;
}

export interface FIMCompletion {
  id: string;
  text: string;
  range: { startLine: number; startCol: number; endLine: number; endCol: number };
  confidence: number;
}

export interface FIMEngineConfig {
  debounceMs: number;
  maxPrefixLines: number;
  maxSuffixLines: number;
  maxCompletionTokens: number;
  enabled: boolean;
}

export interface FIMStats {
  totalRequests: number;
  totalCompletions: number;
  acceptedCompletions: number;
  rejectedCompletions: number;
  cacheHitRate: number;
  cancelledRequests: number;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: FIMEngineConfig = {
  debounceMs: 150,
  maxPrefixLines: 100,
  maxSuffixLines: 50,
  maxCompletionTokens: 256,
  enabled: true,
};

// ─── Engine ──────────────────────────────────────────────────────────────────

export class FIMEngine {
  private config: FIMEngineConfig;
  private router: ModelRouter;
  private redaction: RedactionPipeline;
  private cache: CompletionCache;

  // Debounce / cancellation
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private pendingResolve: ((value: FIMCompletion | null) => void) | null = null;

  // Metrics
  private stats: FIMStats = {
    totalRequests: 0,
    totalCompletions: 0,
    acceptedCompletions: 0,
    rejectedCompletions: 0,
    cacheHitRate: 0,
    cancelledRequests: 0,
  };
  private completionOutcomes = new Map<string, 'pending' | 'accepted' | 'rejected'>();
  private nextId = 0;

  constructor(
    router: ModelRouter,
    redaction: RedactionPipeline,
    config?: Partial<FIMEngineConfig>,
  ) {
    this.router = router;
    this.redaction = redaction;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new CompletionCache();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Request a FIM completion. Debounces rapid calls and cancels any
   * in-flight request before issuing a new one.
   */
  async requestCompletion(req: FIMRequest): Promise<FIMCompletion | null> {
    if (!this.config.enabled) return null;

    this.stats.totalRequests++;

    // Cancel any pending debounce / in-flight request
    this.cancelPending();

    return new Promise<FIMCompletion | null>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.debounceTimer = setTimeout(async () => {
        this.pendingResolve = null;
        try {
          const result = await this.executeRequest(req);
          resolve(result);
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') {
            resolve(null);
          } else {
            reject(err);
          }
        }
      }, this.config.debounceMs);
    });
  }

  /**
   * Cancel all pending debounce timers and in-flight requests.
   */
  cancelPending(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingResolve) {
      this.pendingResolve(null);
      this.pendingResolve = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.stats.cancelledRequests++;
    }
  }

  /**
   * Signal that the user accepted a completion.
   */
  acceptCompletion(id: string): void {
    if (this.completionOutcomes.has(id)) {
      this.completionOutcomes.set(id, 'accepted');
      this.stats.acceptedCompletions++;
    }
  }

  /**
   * Signal that the user rejected (dismissed) a completion.
   */
  rejectCompletion(id: string): void {
    if (this.completionOutcomes.has(id)) {
      this.completionOutcomes.set(id, 'rejected');
      this.stats.rejectedCompletions++;
    }
  }

  /**
   * Update engine configuration at runtime.
   */
  setConfig(config: Partial<FIMEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Return current engine statistics.
   */
  getStats(): FIMStats {
    return {
      ...this.stats,
      cacheHitRate: this.cache.getHitRate(),
    };
  }

  /**
   * Get the current config (useful for tests / inspection).
   */
  getConfig(): Readonly<FIMEngineConfig> {
    return { ...this.config };
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private async executeRequest(req: FIMRequest): Promise<FIMCompletion | null> {
    // Trim prefix/suffix to configured line limits
    const prefix = this.trimLines(req.prefix, this.config.maxPrefixLines, 'prefix');
    const suffix = this.trimLines(req.suffix, this.config.maxSuffixLines, 'suffix');

    // Check cache first
    const cacheKey = CompletionCache.buildKey(prefix, suffix, req.languageId);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Redact before sending to LLM
    const prefixRedacted = this.redaction.redact(prefix);
    const suffixRedacted = this.redaction.redact(suffix);

    // Get fastest model for FIM
    const adapter = this.router.getAdapter('fim-autocomplete');

    // Set up abort controller
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Stream completion from model
    const modelRequest = {
      messages: [],
      prefix: prefixRedacted.sanitized,
      suffix: suffixRedacted.sanitized,
      maxTokens: req.maxTokens ?? this.config.maxCompletionTokens,
      stop: ['\n\n', '\r\n\r\n'],
    };

    let completionText = '';

    const stream = adapter.streamCall(modelRequest);
    for await (const chunk of stream) {
      // Check for abort
      if (signal.aborted) {
        throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      }
      if (chunk.type === 'text' && chunk.text) {
        completionText += chunk.text;
      }
      if (chunk.type === 'done') break;
    }

    if (!completionText) return null;

    // De-redact the completion so it fits the user's actual code
    completionText = this.redaction.deRedact(completionText, prefixRedacted.redactionMapId);

    const completionId = this.generateId();
    const completion: FIMCompletion = {
      id: completionId,
      text: completionText,
      range: this.computeRange(req.cursorLine, req.cursorColumn, completionText),
      confidence: 0.8,
    };

    this.completionOutcomes.set(completionId, 'pending');
    this.stats.totalCompletions++;

    // Store in cache
    this.cache.set(cacheKey, completion);

    // Clean up abort controller
    this.abortController = null;

    return completion;
  }

  private trimLines(text: string, maxLines: number, side: 'prefix' | 'suffix'): string {
    const lines = text.split('\n');
    if (lines.length <= maxLines) return text;

    if (side === 'prefix') {
      // Keep the last N lines (closest to cursor)
      return lines.slice(-maxLines).join('\n');
    } else {
      // Keep the first N lines (closest to cursor)
      return lines.slice(0, maxLines).join('\n');
    }
  }

  private computeRange(
    cursorLine: number,
    cursorCol: number,
    text: string,
  ): FIMCompletion['range'] {
    const lines = text.split('\n');
    const endLine = cursorLine + lines.length - 1;
    const endCol = lines.length === 1
      ? cursorCol + text.length
      : lines[lines.length - 1].length;

    return {
      startLine: cursorLine,
      startCol: cursorCol,
      endLine,
      endCol,
    };
  }

  private generateId(): string {
    return `fim-${Date.now()}-${this.nextId++}`;
  }
}
