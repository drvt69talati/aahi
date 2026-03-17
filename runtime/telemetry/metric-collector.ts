// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Local Metrics Collector
// Counters, gauges, histograms. Exports in Prometheus exposition format.
// Tracks agent execution times, model latencies, token usage, cache hit rates.
// ─────────────────────────────────────────────────────────────────────────────

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricSample {
  name: string;
  value: number;
  timestamp: Date;
  labels: Record<string, string>;
  type: MetricType;
}

export interface HistogramBuckets {
  boundaries: number[];
  counts: number[];
  sum: number;
  count: number;
}

interface MetricEntry {
  name: string;
  type: MetricType;
  help: string;
  /** label key string → value */
  values: Map<string, number>;
  /** label key string → histogram buckets */
  histograms: Map<string, HistogramBuckets>;
  samples: MetricSample[];
}

const DEFAULT_HISTOGRAM_BOUNDARIES = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function labelsKey(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}="${labels[k]}"`).join(',');
}

function labelsToPromString(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return '{' + keys.map((k) => `${k}="${labels[k]}"`).join(',') + '}';
}

// ─── Metric Collector ───────────────────────────────────────────────────────

export class MetricCollector {
  private metrics = new Map<string, MetricEntry>();
  private histogramBoundaries: number[];

  constructor(options?: { histogramBoundaries?: number[] }) {
    this.histogramBoundaries = options?.histogramBoundaries ?? DEFAULT_HISTOGRAM_BOUNDARIES;
  }

  /**
   * Increment a counter metric.
   */
  increment(name: string, labels: Record<string, string> = {}, delta: number = 1): void {
    const entry = this.ensureMetric(name, 'counter');
    const key = labelsKey(labels);
    const current = entry.values.get(key) ?? 0;
    entry.values.set(key, current + delta);

    entry.samples.push({
      name,
      value: current + delta,
      timestamp: new Date(),
      labels,
      type: 'counter',
    });
  }

  /**
   * Set a gauge metric to a specific value.
   */
  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const entry = this.ensureMetric(name, 'gauge');
    const key = labelsKey(labels);
    entry.values.set(key, value);

    entry.samples.push({
      name,
      value,
      timestamp: new Date(),
      labels,
      type: 'gauge',
    });
  }

  /**
   * Record a histogram observation.
   */
  histogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const entry = this.ensureMetric(name, 'histogram');
    const key = labelsKey(labels);

    if (!entry.histograms.has(key)) {
      entry.histograms.set(key, {
        boundaries: [...this.histogramBoundaries],
        counts: new Array(this.histogramBoundaries.length + 1).fill(0),
        sum: 0,
        count: 0,
      });
    }

    const h = entry.histograms.get(key)!;
    h.sum += value;
    h.count += 1;

    // Increment the appropriate bucket
    let placed = false;
    for (let i = 0; i < h.boundaries.length; i++) {
      if (value <= h.boundaries[i]) {
        h.counts[i]++;
        placed = true;
        break;
      }
    }
    if (!placed) {
      h.counts[h.counts.length - 1]++;
    }

    entry.samples.push({
      name,
      value,
      timestamp: new Date(),
      labels,
      type: 'histogram',
    });
  }

  /**
   * Get a specific metric by name.
   */
  getMetric(name: string): MetricEntry | undefined {
    return this.metrics.get(name);
  }

  /**
   * Get the current value of a counter or gauge.
   */
  getValue(name: string, labels: Record<string, string> = {}): number | undefined {
    const entry = this.metrics.get(name);
    if (!entry) return undefined;
    return entry.values.get(labelsKey(labels));
  }

  /**
   * Get histogram data.
   */
  getHistogram(name: string, labels: Record<string, string> = {}): HistogramBuckets | undefined {
    const entry = this.metrics.get(name);
    if (!entry) return undefined;
    return entry.histograms.get(labelsKey(labels));
  }

  /**
   * Get all recent samples for a metric.
   */
  getSamples(name: string, limit?: number): MetricSample[] {
    const entry = this.metrics.get(name);
    if (!entry) return [];
    const samples = [...entry.samples];
    if (limit) return samples.slice(-limit);
    return samples;
  }

  /**
   * Export all metrics in Prometheus exposition format.
   */
  export(): string {
    const lines: string[] = [];

    for (const [name, entry] of this.metrics) {
      lines.push(`# HELP ${name} ${entry.help}`);
      lines.push(`# TYPE ${name} ${entry.type}`);

      if (entry.type === 'histogram') {
        for (const [key, h] of entry.histograms) {
          const labels = key ? `{${key}}` : '';
          let cumulative = 0;
          for (let i = 0; i < h.boundaries.length; i++) {
            cumulative += h.counts[i];
            const le = h.boundaries[i];
            const bucketLabels = key ? `{${key},le="${le}"}` : `{le="${le}"}`;
            lines.push(`${name}_bucket${bucketLabels} ${cumulative}`);
          }
          cumulative += h.counts[h.counts.length - 1];
          const infLabels = key ? `{${key},le="+Inf"}` : `{le="+Inf"}`;
          lines.push(`${name}_bucket${infLabels} ${cumulative}`);
          lines.push(`${name}_sum${labels} ${h.sum}`);
          lines.push(`${name}_count${labels} ${h.count}`);
        }
      } else {
        for (const [key, value] of entry.values) {
          const labels = key ? `{${key}}` : '';
          lines.push(`${name}${labels} ${value}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.metrics.clear();
  }

  /**
   * Get names of all registered metrics.
   */
  getMetricNames(): string[] {
    return [...this.metrics.keys()];
  }

  private ensureMetric(name: string, type: MetricType): MetricEntry {
    let entry = this.metrics.get(name);
    if (!entry) {
      entry = {
        name,
        type,
        help: name,
        values: new Map(),
        histograms: new Map(),
        samples: [],
      };
      this.metrics.set(name, entry);
    }
    return entry;
  }
}
