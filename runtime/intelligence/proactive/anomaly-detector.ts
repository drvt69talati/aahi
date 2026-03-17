// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Anomaly Detector
// Implements anomaly detection algorithms for multiple signal types:
// error rate spikes, latency increases, memory leaks, pod restarts,
// cost spikes, coverage drops, cert expiry, stale PRs, deploy health.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';

export type AnomalyType =
  | 'error_rate_spike'
  | 'latency_increase'
  | 'memory_leak'
  | 'pod_restart'
  | 'cost_spike'
  | 'coverage_drop'
  | 'cert_expiry'
  | 'stale_pr'
  | 'deploy_health';

export type AnomalySeverity = 'info' | 'warning' | 'critical';

export interface AnomalySignal {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  source: string;
  value: number;
  threshold: number;
  description: string;
  detectedAt: Date;
  relatedEvents: string[];
}

interface TimeSample {
  value: number;
  timestamp: Date;
}

interface AnomalyConfig {
  /** Error rate: multiplier for spike detection (default 2x) */
  errorRateSpikeMultiplier: number;
  /** Latency: percentage increase to trigger alert (default 0.5 = 50%) */
  latencyIncreasePercent: number;
  /** Memory: minimum samples for trend detection */
  memoryLeakMinSamples: number;
  /** Pod restart: max restarts in window before alert */
  podRestartThreshold: number;
  /** Pod restart: window in ms (default 10 min) */
  podRestartWindowMs: number;
  /** Cost: multiplier for spike detection (default 2x = 200% increase) */
  costSpikeMultiplier: number;
  /** Window size for rolling calculations */
  windowSize: number;
}

const DEFAULT_CONFIG: AnomalyConfig = {
  errorRateSpikeMultiplier: 2,
  latencyIncreasePercent: 0.5,
  memoryLeakMinSamples: 5,
  podRestartThreshold: 3,
  podRestartWindowMs: 10 * 60 * 1000,
  costSpikeMultiplier: 3,
  windowSize: 20,
};

// ─── Anomaly Detector ───────────────────────────────────────────────────────

export class AnomalyDetector {
  private samples = new Map<AnomalyType, TimeSample[]>();
  private activeAnomalies = new Map<string, AnomalySignal>();
  private acknowledgedIds = new Set<string>();
  private config: AnomalyConfig;

  constructor(config?: Partial<AnomalyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a sample data point for a specific signal type.
   */
  addSample(type: AnomalyType, value: number, timestamp?: Date): void {
    if (!this.samples.has(type)) {
      this.samples.set(type, []);
    }
    this.samples.get(type)!.push({
      value,
      timestamp: timestamp ?? new Date(),
    });
  }

  /**
   * Run all detection algorithms and return any newly detected anomalies.
   */
  detect(): AnomalySignal[] {
    const signals: AnomalySignal[] = [];

    for (const [type, samples] of this.samples) {
      const signal = this.detectForType(type, samples);
      if (signal) {
        this.activeAnomalies.set(signal.id, signal);
        signals.push(signal);
      }
    }

    return signals;
  }

  /**
   * Get all currently active (unacknowledged) anomalies.
   */
  getActiveAnomalies(): AnomalySignal[] {
    return [...this.activeAnomalies.values()].filter(
      (a) => !this.acknowledgedIds.has(a.id),
    );
  }

  /**
   * Acknowledge an anomaly (marks it as seen, removes from active).
   */
  acknowledge(id: string): boolean {
    if (this.activeAnomalies.has(id)) {
      this.acknowledgedIds.add(id);
      return true;
    }
    return false;
  }

  /**
   * Get all samples for a specific type (for inspection/debugging).
   */
  getSamples(type: AnomalyType): TimeSample[] {
    return this.samples.get(type) ?? [];
  }

  /**
   * Clear all samples and anomalies.
   */
  reset(): void {
    this.samples.clear();
    this.activeAnomalies.clear();
    this.acknowledgedIds.clear();
  }

  // ─── Detection Algorithms ──────────────────────────────────────────────

  private detectForType(type: AnomalyType, samples: TimeSample[]): AnomalySignal | null {
    if (samples.length === 0) return null;
    // Most detectors need >=2 samples; cert_expiry/stale_pr/deploy_health work with 1
    if (samples.length < 2 && !['cert_expiry', 'stale_pr', 'deploy_health'].includes(type)) return null;

    switch (type) {
      case 'error_rate_spike':
        return this.detectErrorRateSpike(samples);
      case 'latency_increase':
        return this.detectLatencyIncrease(samples);
      case 'memory_leak':
        return this.detectMemoryLeak(samples);
      case 'pod_restart':
        return this.detectPodRestarts(samples);
      case 'cost_spike':
        return this.detectCostSpike(samples);
      case 'coverage_drop':
        return this.detectCoverageDrop(samples);
      case 'cert_expiry':
        return this.detectCertExpiry(samples);
      case 'stale_pr':
        return this.detectStalePR(samples);
      case 'deploy_health':
        return this.detectDeployHealth(samples);
      default:
        return null;
    }
  }

  /**
   * Error rate spike: alerts when current window error rate is >2x the baseline.
   */
  private detectErrorRateSpike(samples: TimeSample[]): AnomalySignal | null {
    const windowSize = Math.min(this.config.windowSize, Math.floor(samples.length / 2));
    if (windowSize < 1) return null;

    const baseline = samples.slice(0, -windowSize);
    const current = samples.slice(-windowSize);

    if (baseline.length === 0) return null;

    const baselineAvg = baseline.reduce((s, v) => s + v.value, 0) / baseline.length;
    const currentAvg = current.reduce((s, v) => s + v.value, 0) / current.length;

    if (baselineAvg === 0 && currentAvg > 0) {
      return this.createSignal('error_rate_spike', 'critical', currentAvg, 0,
        `Error rate spiked from 0 to ${currentAvg.toFixed(2)}`);
    }

    if (baselineAvg > 0 && currentAvg > baselineAvg * this.config.errorRateSpikeMultiplier) {
      return this.createSignal('error_rate_spike', 'warning', currentAvg, baselineAvg * this.config.errorRateSpikeMultiplier,
        `Error rate spiked to ${currentAvg.toFixed(2)} (baseline: ${baselineAvg.toFixed(2)}, threshold: ${(baselineAvg * this.config.errorRateSpikeMultiplier).toFixed(2)})`);
    }

    return null;
  }

  /**
   * Latency increase: alerts when p99 latency increases by >50%.
   */
  private detectLatencyIncrease(samples: TimeSample[]): AnomalySignal | null {
    const windowSize = Math.min(this.config.windowSize, Math.floor(samples.length / 2));
    if (windowSize < 1) return null;

    const baseline = samples.slice(0, -windowSize);
    const current = samples.slice(-windowSize);

    if (baseline.length === 0) return null;

    const baselineP99 = this.percentile(baseline.map((s) => s.value), 99);
    const currentP99 = this.percentile(current.map((s) => s.value), 99);

    if (baselineP99 > 0 && currentP99 > baselineP99 * (1 + this.config.latencyIncreasePercent)) {
      const threshold = baselineP99 * (1 + this.config.latencyIncreasePercent);
      return this.createSignal('latency_increase', 'warning', currentP99, threshold,
        `P99 latency increased to ${currentP99.toFixed(0)}ms (baseline: ${baselineP99.toFixed(0)}ms)`);
    }

    return null;
  }

  /**
   * Memory leak: detects consistent upward trend using linear regression.
   */
  private detectMemoryLeak(samples: TimeSample[]): AnomalySignal | null {
    if (samples.length < this.config.memoryLeakMinSamples) return null;

    const recentSamples = samples.slice(-Math.max(this.config.memoryLeakMinSamples, 10));
    const { slope, rSquared } = this.linearRegression(recentSamples.map((s) => s.value));

    // Strong upward trend: positive slope with high R-squared
    if (slope > 0 && rSquared > 0.8) {
      const currentValue = recentSamples[recentSamples.length - 1].value;
      return this.createSignal('memory_leak', 'warning', currentValue, 0,
        `Memory showing consistent upward trend (slope: ${slope.toFixed(2)}, R²: ${rSquared.toFixed(2)})`);
    }

    return null;
  }

  /**
   * Pod restart: alerts on >3 restarts in 10 minutes.
   */
  private detectPodRestarts(samples: TimeSample[]): AnomalySignal | null {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.config.podRestartWindowMs);

    const recentRestarts = samples.filter((s) => s.timestamp >= windowStart);
    const totalRestarts = recentRestarts.reduce((s, v) => s + v.value, 0);

    if (totalRestarts > this.config.podRestartThreshold) {
      return this.createSignal('pod_restart', 'critical', totalRestarts, this.config.podRestartThreshold,
        `${totalRestarts} pod restarts in the last ${this.config.podRestartWindowMs / 60000} minutes`);
    }

    return null;
  }

  /**
   * Cost spike: alerts on >200% increase in daily cost.
   */
  private detectCostSpike(samples: TimeSample[]): AnomalySignal | null {
    if (samples.length < 2) return null;

    const previous = samples.slice(0, -1);
    const current = samples[samples.length - 1];

    const avgPrevious = previous.reduce((s, v) => s + v.value, 0) / previous.length;
    if (avgPrevious > 0 && current.value > avgPrevious * this.config.costSpikeMultiplier) {
      return this.createSignal('cost_spike', 'warning', current.value, avgPrevious * this.config.costSpikeMultiplier,
        `Cost spiked to $${current.value.toFixed(2)} (average: $${avgPrevious.toFixed(2)})`);
    }

    return null;
  }

  /**
   * Coverage drop: compares latest coverage with previous.
   */
  private detectCoverageDrop(samples: TimeSample[]): AnomalySignal | null {
    if (samples.length < 2) return null;

    const previous = samples[samples.length - 2].value;
    const current = samples[samples.length - 1].value;

    if (current < previous) {
      const drop = previous - current;
      const severity: AnomalySeverity = drop > 5 ? 'warning' : 'info';
      return this.createSignal('coverage_drop', severity, current, previous,
        `Test coverage dropped from ${previous.toFixed(1)}% to ${current.toFixed(1)}%`);
    }

    return null;
  }

  /**
   * Certificate expiry: value represents days until expiry.
   */
  private detectCertExpiry(samples: TimeSample[]): AnomalySignal | null {
    if (samples.length === 0) return null;

    const latest = samples[samples.length - 1];
    if (latest.value <= 7) {
      return this.createSignal('cert_expiry', 'critical', latest.value, 7,
        `Certificate expires in ${latest.value} days`);
    }
    if (latest.value <= 30) {
      return this.createSignal('cert_expiry', 'warning', latest.value, 30,
        `Certificate expires in ${latest.value} days`);
    }

    return null;
  }

  /**
   * Stale PR: value represents days since last activity.
   */
  private detectStalePR(samples: TimeSample[]): AnomalySignal | null {
    if (samples.length === 0) return null;

    const latest = samples[samples.length - 1];
    if (latest.value > 7) {
      return this.createSignal('stale_pr', 'info', latest.value, 7,
        `PR has been inactive for ${latest.value} days`);
    }

    return null;
  }

  /**
   * Deploy health: checks error rate after a deploy.
   * Value represents post-deploy error rate.
   */
  private detectDeployHealth(samples: TimeSample[]): AnomalySignal | null {
    if (samples.length < 2) return null;

    const preDeploy = samples.slice(0, -1);
    const postDeploy = samples[samples.length - 1];

    const preAvg = preDeploy.reduce((s, v) => s + v.value, 0) / preDeploy.length;
    if (preAvg > 0 && postDeploy.value > preAvg * 2) {
      return this.createSignal('deploy_health', 'critical', postDeploy.value, preAvg * 2,
        `Post-deploy error rate ${postDeploy.value.toFixed(2)} is ${(postDeploy.value / preAvg).toFixed(1)}x pre-deploy average`);
    }

    return null;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private createSignal(
    type: AnomalyType,
    severity: AnomalySeverity,
    value: number,
    threshold: number,
    description: string,
  ): AnomalySignal {
    return {
      id: uuid(),
      type,
      severity,
      source: type,
      value,
      threshold,
      description,
      detectedAt: new Date(),
      relatedEvents: [],
    };
  }

  private percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  /**
   * Simple linear regression returning slope and R-squared.
   */
  private linearRegression(values: number[]): { slope: number; rSquared: number } {
    const n = values.length;
    if (n < 2) return { slope: 0, rSquared: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
      sumY2 += values[i] * values[i];
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // R-squared
    let ssRes = 0, ssTot = 0;
    const meanY = sumY / n;
    for (let i = 0; i < n; i++) {
      const predicted = slope * i + intercept;
      ssRes += (values[i] - predicted) ** 2;
      ssTot += (values[i] - meanY) ** 2;
    }

    const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
    return { slope, rSquared };
  }
}
