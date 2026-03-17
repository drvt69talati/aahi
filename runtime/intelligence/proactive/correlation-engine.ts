// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Correlation Engine
// Given an anomaly, finds the most likely cause from recent timeline events
// using temporal proximity and category matching.
// ─────────────────────────────────────────────────────────────────────────────

import type { TimelineStore, TimelineEvent, EventCategory } from '../timeline/timeline-store.js';
import type { AnomalySignal, AnomalyType } from './anomaly-detector.js';

export interface CorrelationCandidate {
  event: TimelineEvent;
  confidence: number;
  reason: string;
}

export interface CorrelationResult {
  anomaly: AnomalySignal;
  candidates: CorrelationCandidate[];
  topCandidate: CorrelationCandidate | null;
}

interface CorrelationHistoryEntry {
  anomalyId: string;
  anomalyType: AnomalyType;
  result: CorrelationResult;
  timestamp: Date;
}

// ─── Anomaly-to-Category Mapping ────────────────────────────────────────────

const ANOMALY_LIKELY_CAUSES: Record<AnomalyType, EventCategory[]> = {
  error_rate_spike: ['deploy', 'code', 'config'],
  latency_increase: ['deploy', 'infra', 'config'],
  memory_leak: ['deploy', 'code'],
  pod_restart: ['deploy', 'infra', 'config'],
  cost_spike: ['infra', 'deploy', 'config'],
  coverage_drop: ['code'],
  cert_expiry: ['security', 'config'],
  stale_pr: ['code'],
  deploy_health: ['deploy', 'code', 'config'],
};

// ─── Scoring Weights ────────────────────────────────────────────────────────

const CATEGORY_MATCH_BONUS = 0.3;
const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 0.15,
  error: 0.12,
  warning: 0.08,
  info: 0.03,
};
const MAX_TEMPORAL_SCORE = 0.5;
const SERVICE_MATCH_BONUS = 0.2;

// ─── Correlation Engine ─────────────────────────────────────────────────────

export class CorrelationEngine {
  private history: CorrelationHistoryEntry[] = [];
  private lookbackWindowMs: number;

  constructor(options?: { lookbackWindowMs?: number }) {
    this.lookbackWindowMs = options?.lookbackWindowMs ?? 3_600_000; // 1 hour default
  }

  /**
   * Find the most likely cause of an anomaly from recent timeline events.
   * Returns ranked candidates with confidence scores.
   */
  correlate(anomaly: AnomalySignal, timelineStore: TimelineStore): CorrelationResult {
    const likelyCategories = ANOMALY_LIKELY_CAUSES[anomaly.type] ?? [];

    // Get events within the lookback window BEFORE the anomaly
    const windowStart = new Date(anomaly.detectedAt.getTime() - this.lookbackWindowMs);
    const events = timelineStore.query({
      timeRange: { start: windowStart, end: anomaly.detectedAt },
    });

    const candidates: CorrelationCandidate[] = [];

    for (const event of events) {
      // Only consider events BEFORE the anomaly
      if (event.timestamp >= anomaly.detectedAt) continue;

      let confidence = 0;
      const reasons: string[] = [];

      // 1. Temporal proximity score (closer in time = higher score)
      const timeDeltaMs = anomaly.detectedAt.getTime() - event.timestamp.getTime();
      const temporalScore = MAX_TEMPORAL_SCORE * (1 - timeDeltaMs / this.lookbackWindowMs);
      confidence += Math.max(0, temporalScore);
      reasons.push(`temporal proximity: ${(timeDeltaMs / 60000).toFixed(1)} min before anomaly`);

      // 2. Category match bonus
      if (likelyCategories.includes(event.category)) {
        confidence += CATEGORY_MATCH_BONUS;
        reasons.push(`category match: ${event.category} is a likely cause of ${anomaly.type}`);
      }

      // 3. Severity weight
      const sevWeight = SEVERITY_WEIGHTS[event.severity] ?? 0;
      confidence += sevWeight;

      // 4. Service match bonus (if anomaly source matches event service)
      if (event.service && anomaly.source && event.service === anomaly.source) {
        confidence += SERVICE_MATCH_BONUS;
        reasons.push(`service match: ${event.service}`);
      }

      // 5. Related event bonus
      if (anomaly.relatedEvents.includes(event.id)) {
        confidence += 0.2;
        reasons.push('directly related event');
      }

      // Cap confidence at 1.0
      confidence = Math.min(1, confidence);

      candidates.push({
        event,
        confidence,
        reason: reasons.join('; '),
      });
    }

    // Sort by confidence descending
    candidates.sort((a, b) => b.confidence - a.confidence);

    const result: CorrelationResult = {
      anomaly,
      candidates,
      topCandidate: candidates.length > 0 ? candidates[0] : null,
    };

    // Record in history
    this.history.push({
      anomalyId: anomaly.id,
      anomalyType: anomaly.type,
      result,
      timestamp: new Date(),
    });

    return result;
  }

  /**
   * Get the correlation history for review.
   */
  getCorrelationHistory(): CorrelationHistoryEntry[] {
    return [...this.history];
  }

  /**
   * Clear correlation history.
   */
  clearHistory(): void {
    this.history = [];
  }
}
