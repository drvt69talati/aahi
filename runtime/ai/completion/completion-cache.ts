// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Completion Cache
// LRU cache with TTL expiry for FIM completions. Avoids redundant LLM calls
// when the user revisits similar cursor positions.
// ─────────────────────────────────────────────────────────────────────────────

import type { FIMCompletion } from './fim-engine.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  completion: FIMCompletion;
  createdAt: number;
}

export interface CompletionCacheConfig {
  maxSize: number;
  ttlMs: number;
  /** Number of chars from prefix/suffix used to build the cache key */
  keyChars: number;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CACHE_CONFIG: CompletionCacheConfig = {
  maxSize: 100,
  ttlMs: 60_000,
  keyChars: 256,
};

// ─── Cache ───────────────────────────────────────────────────────────────────

export class CompletionCache {
  private entries = new Map<string, CacheEntry>();
  private config: CompletionCacheConfig;
  private hits = 0;
  private misses = 0;

  constructor(config?: Partial<CompletionCacheConfig>) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Build a cache key from the prefix tail, suffix head, and language ID.
   * Uses a simple hash so keys stay compact.
   */
  static buildKey(prefix: string, suffix: string, languageId: string): string {
    const prefixTail = prefix.slice(-256);
    const suffixHead = suffix.slice(0, 256);
    return CompletionCache.hash(`${languageId}:${prefixTail}:${suffixHead}`);
  }

  /**
   * Look up a completion in the cache.
   * Returns null on miss or if the entry has expired.
   */
  get(key: string): FIMCompletion | null {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // TTL check
    if (Date.now() - entry.createdAt > this.config.ttlMs) {
      this.entries.delete(key);
      this.misses++;
      return null;
    }

    // Move to end (most-recently-used)
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry.completion;
  }

  /**
   * Store a completion in the cache, evicting the oldest entry if full.
   */
  set(key: string, completion: FIMCompletion): void {
    // If key already exists, delete so re-insert goes to end
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    // Evict LRU if at capacity
    if (this.entries.size >= this.config.maxSize) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, {
      completion,
      createdAt: Date.now(),
    });
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Return the cache hit rate as a number between 0 and 1.
   */
  getHitRate(): number {
    const total = this.hits + this.misses;
    if (total === 0) return 0;
    return this.hits / total;
  }

  /**
   * Current number of entries in the cache.
   */
  get size(): number {
    return this.entries.size;
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Simple djb2-style string hash. Not cryptographic — used only for
   * compact cache keys.
   */
  private static hash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) {
      h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
  }
}
