// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Token Budget Manager
// Tracks and allocates tokens across context sources within model limits.
// ─────────────────────────────────────────────────────────────────────────────

export interface BudgetAllocation {
  sourceId: string;
  allocatedTokens: number;
  usedTokens: number;
  priority: number;
}

export interface BudgetUsageStats {
  totalBudget: number;
  reserved: number;
  allocatable: number;
  allocated: number;
  used: number;
  remaining: number;
  allocations: BudgetAllocation[];
}

// ─── Defaults ───────────────────────────────────────────────────────────────

/** Minimum tokens reserved for system prompt + user message */
const DEFAULT_RESERVED_TOKENS = 2048;

// ─── Manager ────────────────────────────────────────────────────────────────

export class TokenBudgetManager {
  private totalBudget: number;
  private reservedTokens: number;
  private allocations = new Map<string, BudgetAllocation>();

  constructor(totalBudget: number, reservedTokens: number = DEFAULT_RESERVED_TOKENS) {
    if (totalBudget <= reservedTokens) {
      throw new Error(
        `Total budget (${totalBudget}) must exceed reserved tokens (${reservedTokens})`,
      );
    }
    this.totalBudget = totalBudget;
    this.reservedTokens = reservedTokens;
  }

  /** The total number of tokens available for context sources (after reservation). */
  get allocatable(): number {
    return this.totalBudget - this.reservedTokens;
  }

  /** Total tokens currently allocated across all sources. */
  get allocated(): number {
    let total = 0;
    for (const a of this.allocations.values()) {
      total += a.allocatedTokens;
    }
    return total;
  }

  /** Total tokens actually used across all sources. */
  get used(): number {
    let total = 0;
    for (const a of this.allocations.values()) {
      total += a.usedTokens;
    }
    return total;
  }

  /** Remaining allocatable tokens. */
  get remaining(): number {
    return this.allocatable - this.allocated;
  }

  /**
   * Register a source with a priority. Allocation happens on `reallocate()`.
   */
  addSource(sourceId: string, priority: number): void {
    if (this.allocations.has(sourceId)) return;
    this.allocations.set(sourceId, {
      sourceId,
      allocatedTokens: 0,
      usedTokens: 0,
      priority,
    });
    this.reallocate();
  }

  /**
   * Remove a source and redistribute its tokens.
   */
  removeSource(sourceId: string): void {
    this.allocations.delete(sourceId);
    this.reallocate();
  }

  /**
   * Record actual token usage for a source.
   */
  recordUsage(sourceId: string, tokens: number): void {
    const alloc = this.allocations.get(sourceId);
    if (!alloc) return;
    alloc.usedTokens = Math.min(tokens, alloc.allocatedTokens);
  }

  /**
   * Get the allocation for a specific source.
   */
  getAllocation(sourceId: string): BudgetAllocation | undefined {
    return this.allocations.get(sourceId);
  }

  /**
   * Reallocate tokens proportionally by priority.
   * Higher priority sources get a larger share of the budget.
   */
  reallocate(): void {
    const entries = [...this.allocations.values()];
    if (entries.length === 0) return;

    const totalPriority = entries.reduce((sum, a) => sum + a.priority, 0);
    if (totalPriority === 0) {
      // Equal distribution when all priorities are 0
      const equal = Math.floor(this.allocatable / entries.length);
      for (const a of entries) {
        a.allocatedTokens = equal;
      }
      return;
    }

    for (const a of entries) {
      a.allocatedTokens = Math.floor((a.priority / totalPriority) * this.allocatable);
    }
  }

  /**
   * Update the total budget (e.g., when switching models).
   */
  updateBudget(newTotal: number): void {
    this.totalBudget = newTotal;
    this.reallocate();
  }

  /**
   * Get full usage statistics for the Context Inspector panel.
   */
  getStats(): BudgetUsageStats {
    return {
      totalBudget: this.totalBudget,
      reserved: this.reservedTokens,
      allocatable: this.allocatable,
      allocated: this.allocated,
      used: this.used,
      remaining: this.remaining,
      allocations: [...this.allocations.values()],
    };
  }
}
