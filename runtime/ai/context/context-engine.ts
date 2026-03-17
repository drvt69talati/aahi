// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Context Engine
// Assembles context for LLM calls: priority-ranked, budget-aware, redacted.
// All data flows through the RedactionPipeline before assembly.
// ─────────────────────────────────────────────────────────────────────────────

import type { ContextChunk } from '../../integrations/registry/types.js';
import { RedactionPipeline, type RedactionResult } from '../redaction/redaction-pipeline.js';
import { MentionParser, type Mention, type MentionType } from './mention-parser.js';
import { TokenBudgetManager, type BudgetUsageStats } from './token-budget.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ContextBudget {
  maxTokens: number;
  used: number;
  remaining: number;
}

export interface ContextSource {
  id: string;
  type: 'file' | 'logs' | 'traces' | 'metrics' | 'events' | 'integration' | 'rag';
  priority: number; // 0-100, higher = more important
  chunks: ContextChunk[];
}

export interface ContextAssembly {
  sources: ContextSource[];
  totalTokens: number;
  budget: ContextBudget;
  redacted: boolean;
  redactionMapId?: string;
}

export interface SourceUsageStat {
  sourceId: string;
  type: ContextSource['type'];
  chunkCount: number;
  tokenEstimate: number;
  priority: number;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export class ContextEngine {
  private sources = new Map<string, ContextSource>();
  private budgetManager: TokenBudgetManager;
  private redactionPipeline: RedactionPipeline;
  private mentionParser: MentionParser;
  private lastRedactionMapId: string | undefined;

  constructor(
    maxContextTokens: number,
    redactionPipeline?: RedactionPipeline,
    reservedTokens?: number,
  ) {
    this.budgetManager = new TokenBudgetManager(maxContextTokens, reservedTokens);
    this.redactionPipeline = redactionPipeline ?? new RedactionPipeline();
    this.mentionParser = new MentionParser();
  }

  // ─── Source Management ──────────────────────────────────────────────────

  /**
   * Register a context source. Sources are re-ranked on every add/remove.
   */
  addSource(source: ContextSource): void {
    this.sources.set(source.id, source);
    this.budgetManager.addSource(source.id, source.priority);
  }

  /**
   * Remove a context source.
   */
  removeSource(sourceId: string): void {
    this.sources.delete(sourceId);
    this.budgetManager.removeSource(sourceId);
  }

  /**
   * Get a source by ID.
   */
  getSource(sourceId: string): ContextSource | undefined {
    return this.sources.get(sourceId);
  }

  // ─── Mention Parsing ───────────────────────────────────────────────────

  /**
   * Parse @mentions from a user chat message.
   */
  parseMentions(message: string): Mention[] {
    return this.mentionParser.parse(message);
  }

  // ─── Assembly ─────────────────────────────────────────────────────────

  /**
   * Assemble context from all registered sources, fitting within the token
   * budget. Sources are ordered by priority (highest first). Each source's
   * chunks are redacted and trimmed to fit its allocated budget.
   */
  assemble(): ContextAssembly {
    // Sort sources by priority descending
    const sortedSources = [...this.sources.values()].sort(
      (a, b) => b.priority - a.priority,
    );

    const assembled: ContextSource[] = [];
    let totalTokens = 0;

    for (const source of sortedSources) {
      const allocation = this.budgetManager.getAllocation(source.id);
      if (!allocation || allocation.allocatedTokens <= 0) continue;

      const { fittedChunks, tokensUsed } = this.fitChunks(
        source.chunks,
        allocation.allocatedTokens,
      );

      if (fittedChunks.length === 0) continue;

      assembled.push({
        ...source,
        chunks: fittedChunks,
      });

      totalTokens += tokensUsed;
      this.budgetManager.recordUsage(source.id, tokensUsed);
    }

    // Redact all assembled content
    const { redactedSources, redactionMapId } = this.redactSources(assembled);

    this.lastRedactionMapId = redactionMapId;

    return {
      sources: redactedSources,
      totalTokens,
      budget: {
        maxTokens: this.budgetManager.getStats().totalBudget,
        used: totalTokens,
        remaining: this.budgetManager.remaining,
      },
      redacted: true,
      redactionMapId,
    };
  }

  // ─── Stats ────────────────────────────────────────────────────────────

  /**
   * Get per-source usage statistics for the Context Inspector panel.
   */
  getUsageStats(): SourceUsageStat[] {
    const stats: SourceUsageStat[] = [];
    for (const source of this.sources.values()) {
      const tokenEstimate = source.chunks.reduce(
        (sum, c) => sum + (c.tokenEstimate ?? this.estimateTokens(c.content)),
        0,
      );
      stats.push({
        sourceId: source.id,
        type: source.type,
        chunkCount: source.chunks.length,
        tokenEstimate,
        priority: source.priority,
      });
    }
    return stats.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get the budget manager's stats (for panels / debugging).
   */
  getBudgetStats(): BudgetUsageStats {
    return this.budgetManager.getStats();
  }

  // ─── Internals ────────────────────────────────────────────────────────

  /**
   * Fit as many chunks as possible into the allocated token budget.
   */
  private fitChunks(
    chunks: ContextChunk[],
    maxTokens: number,
  ): { fittedChunks: ContextChunk[]; tokensUsed: number } {
    const fitted: ContextChunk[] = [];
    let tokensUsed = 0;

    for (const chunk of chunks) {
      const estimate = chunk.tokenEstimate ?? this.estimateTokens(chunk.content);
      if (tokensUsed + estimate > maxTokens) break;
      fitted.push(chunk);
      tokensUsed += estimate;
    }

    return { fittedChunks: fitted, tokensUsed };
  }

  /**
   * Run all assembled sources through the redaction pipeline.
   */
  private redactSources(
    sources: ContextSource[],
  ): { redactedSources: ContextSource[]; redactionMapId: string } {
    // Concatenate all content for a single redaction pass to ensure
    // consistent replacement tokens across sources
    const allContent = sources
      .flatMap((s) => s.chunks.map((c) => c.content))
      .join('\n---CHUNK_BOUNDARY---\n');

    const result: RedactionResult = this.redactionPipeline.redact(allContent);
    const sanitizedParts = result.sanitized.split('\n---CHUNK_BOUNDARY---\n');

    // Map sanitized content back to chunks
    let partIndex = 0;
    const redactedSources: ContextSource[] = sources.map((source) => ({
      ...source,
      chunks: source.chunks.map((chunk) => ({
        ...chunk,
        content: sanitizedParts[partIndex++] ?? chunk.content,
      })),
    }));

    return { redactedSources, redactionMapId: result.redactionMapId };
  }

  /**
   * Rough token estimate: ~4 chars per token (conservative).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
