// ─────────────────────────────────────────────────────────────────────────────
// Aahi — ProactiveAgent (AAHI EXCLUSIVE)
// Continuously watches connected systems. Detects anomalies. Correlates with
// recent work. Surfaces insights BEFORE you ask.
// Runs every 60s per watched signal (configurable per workspace).
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type { IntegrationRegistry } from '../integrations/registry/integration-registry.js';
import type { SystemEvent } from '../integrations/registry/types.js';
import type { TimelineStore } from '../intelligence/timeline/timeline-store.js';
import type { AahiModelAdapter } from '../ai/models/types.js';

export type ProactiveAlertSeverity = 'info' | 'warning' | 'critical';

export interface ProactiveAlert {
  id: string;
  timestamp: Date;
  severity: ProactiveAlertSeverity;
  title: string;
  description: string;
  source: string;
  detector: string;
  suggestedAction?: string;
  relatedEventIds: string[];
  dismissed: boolean;
}

export interface AnomalyDetector {
  id: string;
  name: string;
  description: string;
  /** How often this detector runs (ms) */
  intervalMs: number;
  /** The detection function */
  detect(): Promise<ProactiveAlert | null>;
}

export type AlertHandler = (alert: ProactiveAlert) => void;

export class ProactiveAgent {
  private detectors: AnomalyDetector[] = [];
  private alerts: ProactiveAlert[] = [];
  private alertHandlers: AlertHandler[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private running = false;

  constructor(
    private integrationRegistry: IntegrationRegistry,
    private timelineStore: TimelineStore,
    private modelAdapter?: AahiModelAdapter,
  ) {}

  /**
   * Register an anomaly detector.
   */
  registerDetector(detector: AnomalyDetector): void {
    this.detectors.push(detector);
    if (this.running) {
      this.startDetector(detector);
    }
  }

  /**
   * Subscribe to proactive alerts.
   */
  onAlert(handler: AlertHandler): () => void {
    this.alertHandlers.push(handler);
    return () => {
      const idx = this.alertHandlers.indexOf(handler);
      if (idx >= 0) this.alertHandlers.splice(idx, 1);
    };
  }

  /**
   * Start all detectors. Does not interrupt focus mode.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Register built-in detectors
    this.registerBuiltinDetectors();

    // Start all detectors on their intervals
    for (const detector of this.detectors) {
      this.startDetector(detector);
    }

    // Also listen to integration events for real-time detection
    this.integrationRegistry.onEvent((event) => {
      this.handleIntegrationEvent(event);
    });
  }

  /**
   * Stop all detectors.
   */
  stop(): void {
    this.running = false;
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
  }

  /**
   * Get all alerts (optionally filtered).
   */
  getAlerts(filter?: {
    severity?: ProactiveAlertSeverity;
    dismissed?: boolean;
    since?: Date;
  }): ProactiveAlert[] {
    let results = [...this.alerts];

    if (filter?.severity) {
      results = results.filter(a => a.severity === filter.severity);
    }
    if (filter?.dismissed !== undefined) {
      results = results.filter(a => a.dismissed === filter.dismissed);
    }
    if (filter?.since) {
      results = results.filter(a => a.timestamp >= filter.since!);
    }

    return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Dismiss an alert.
   */
  dismissAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) alert.dismissed = true;
  }

  /**
   * Get count of active (non-dismissed) alerts by severity.
   */
  getAlertCounts(): Record<ProactiveAlertSeverity, number> {
    const counts: Record<ProactiveAlertSeverity, number> = { info: 0, warning: 0, critical: 0 };
    for (const alert of this.alerts) {
      if (!alert.dismissed) {
        counts[alert.severity]++;
      }
    }
    return counts;
  }

  private startDetector(detector: AnomalyDetector): void {
    // Run immediately, then on interval
    this.runDetector(detector);

    const interval = setInterval(() => {
      this.runDetector(detector);
    }, detector.intervalMs);

    this.intervals.push(interval);
  }

  private async runDetector(detector: AnomalyDetector): Promise<void> {
    try {
      const alert = await detector.detect();
      if (alert) {
        this.emitAlert(alert);
      }
    } catch {
      // Detectors should not crash the agent
    }
  }

  private emitAlert(alert: ProactiveAlert): void {
    this.alerts.push(alert);

    // Also record in timeline
    this.timelineStore.append({
      timestamp: alert.timestamp,
      source: 'proactive-agent' as any,
      category: 'alert',
      severity: alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'info',
      title: alert.title,
      description: alert.description,
      data: { detector: alert.detector, suggestedAction: alert.suggestedAction },
      relatedEventIds: alert.relatedEventIds,
      tags: ['proactive', alert.detector],
      service: alert.source,
    });

    // Notify handlers
    for (const handler of this.alertHandlers) {
      try {
        handler(alert);
      } catch {
        // Don't let one handler crash others
      }
    }
  }

  private handleIntegrationEvent(event: SystemEvent): void {
    // Real-time event-driven detection

    // CrashLoopBackOff detection
    if (event.type === 'pod.status' && event.data.reason === 'CrashLoopBackOff') {
      this.emitAlert({
        id: uuid(),
        timestamp: new Date(),
        severity: 'critical',
        title: `CrashLoopBackOff: ${event.data.podName}`,
        description: `Pod ${event.data.podName} in namespace ${event.data.namespace} is in CrashLoopBackOff. This may match a recent commit.`,
        source: String(event.data.podName),
        detector: 'crashloop-detector',
        suggestedAction: 'Check recent deployments and commits. Consider rollback.',
        relatedEventIds: [event.id],
        dismissed: false,
      });
    }

    // Error rate spike detection
    if (event.type === 'metric.threshold' && event.data.metric === 'error_rate') {
      this.emitAlert({
        id: uuid(),
        timestamp: new Date(),
        severity: 'warning',
        title: `Error rate spike: ${event.data.service}`,
        description: `Error rate for ${event.data.service} exceeded threshold: ${event.data.value}% (threshold: ${event.data.threshold}%)`,
        source: String(event.data.service),
        detector: 'error-rate-detector',
        suggestedAction: 'Investigate recent deployments and code changes.',
        relatedEventIds: [event.id],
        dismissed: false,
      });
    }
  }

  private registerBuiltinDetectors(): void {
    // Detector 1: Stale PR detector
    this.registerDetector({
      id: 'stale-pr',
      name: 'Stale PR Detector',
      description: 'Detects PRs open for more than 7 days without activity',
      intervalMs: 300_000, // Every 5 minutes
      detect: async () => {
        // Would query GitHub integration for stale PRs
        return null;
      },
    });

    // Detector 2: Memory trend detector
    this.registerDetector({
      id: 'memory-trend',
      name: 'Memory Leak Detector',
      description: 'Detects steadily increasing memory usage patterns',
      intervalMs: 60_000,
      detect: async () => {
        // Would query metrics integration for memory trends
        return null;
      },
    });

    // Detector 3: Certificate expiry detector
    this.registerDetector({
      id: 'cert-expiry',
      name: 'Certificate Expiry Detector',
      description: 'Warns about certificates expiring within 30 days',
      intervalMs: 3_600_000, // Hourly
      detect: async () => {
        // Would check certificate stores
        return null;
      },
    });

    // Detector 4: Cost anomaly detector
    this.registerDetector({
      id: 'cost-anomaly',
      name: 'Cost Anomaly Detector',
      description: 'Detects unexpected spikes in cloud spending',
      intervalMs: 3_600_000,
      detect: async () => {
        // Would query cloud cost APIs
        return null;
      },
    });

    // Detector 5: Deployment health detector
    this.registerDetector({
      id: 'deploy-health',
      name: 'Post-Deploy Health Detector',
      description: 'Monitors system health for 30 minutes after each deployment',
      intervalMs: 60_000,
      detect: async () => {
        // Would check for error rate / latency changes post-deploy
        return null;
      },
    });
  }
}
