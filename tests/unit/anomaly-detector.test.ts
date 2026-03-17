import { describe, it, expect, beforeEach } from 'vitest';
import { AnomalyDetector } from '../../runtime/intelligence/proactive/anomaly-detector.js';
import type { AnomalySignal } from '../../runtime/intelligence/proactive/anomaly-detector.js';

describe('AnomalyDetector', () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    detector = new AnomalyDetector();
  });

  describe('error rate spike detection', () => {
    it('detects a 2x spike in error rate', () => {
      // Baseline: error rate around 5
      for (let i = 0; i < 20; i++) {
        detector.addSample('error_rate_spike', 5 + Math.random());
      }
      // Spike: error rate jumps to 15
      for (let i = 0; i < 20; i++) {
        detector.addSample('error_rate_spike', 15 + Math.random());
      }

      const signals = detector.detect();
      const spike = signals.find((s) => s.type === 'error_rate_spike');
      expect(spike).toBeDefined();
      expect(spike!.severity).toBe('warning');
      expect(spike!.value).toBeGreaterThan(10);
    });

    it('does not alert when error rate is stable', () => {
      for (let i = 0; i < 40; i++) {
        detector.addSample('error_rate_spike', 5 + Math.random() * 2);
      }

      const signals = detector.detect();
      const spike = signals.find((s) => s.type === 'error_rate_spike');
      expect(spike).toBeUndefined();
    });

    it('detects spike from zero baseline', () => {
      for (let i = 0; i < 20; i++) {
        detector.addSample('error_rate_spike', 0);
      }
      for (let i = 0; i < 20; i++) {
        detector.addSample('error_rate_spike', 10);
      }

      const signals = detector.detect();
      const spike = signals.find((s) => s.type === 'error_rate_spike');
      expect(spike).toBeDefined();
      expect(spike!.severity).toBe('critical');
    });
  });

  describe('latency increase detection', () => {
    it('detects >50% latency increase', () => {
      // Baseline: ~100ms
      for (let i = 0; i < 20; i++) {
        detector.addSample('latency_increase', 90 + Math.random() * 20);
      }
      // Current: ~200ms
      for (let i = 0; i < 20; i++) {
        detector.addSample('latency_increase', 180 + Math.random() * 40);
      }

      const signals = detector.detect();
      const latency = signals.find((s) => s.type === 'latency_increase');
      expect(latency).toBeDefined();
      expect(latency!.description).toContain('P99 latency');
    });
  });

  describe('memory leak detection', () => {
    it('detects consistent upward trend', () => {
      // Steadily increasing memory
      for (let i = 0; i < 20; i++) {
        detector.addSample('memory_leak', 100 + i * 10);
      }

      const signals = detector.detect();
      const leak = signals.find((s) => s.type === 'memory_leak');
      expect(leak).toBeDefined();
      expect(leak!.description).toContain('upward trend');
    });

    it('does not alert on stable memory', () => {
      // Flat memory usage with small fluctuations
      for (let i = 0; i < 20; i++) {
        detector.addSample('memory_leak', 500 + (Math.random() - 0.5) * 10);
      }

      const signals = detector.detect();
      const leak = signals.find((s) => s.type === 'memory_leak');
      expect(leak).toBeUndefined();
    });

    it('does not alert with too few samples', () => {
      detector.addSample('memory_leak', 100);
      detector.addSample('memory_leak', 200);

      const signals = detector.detect();
      const leak = signals.find((s) => s.type === 'memory_leak');
      expect(leak).toBeUndefined();
    });
  });

  describe('pod restart detection', () => {
    it('detects excessive restarts in window', () => {
      const now = new Date();
      // 5 restarts in the last 5 minutes
      for (let i = 0; i < 5; i++) {
        detector.addSample('pod_restart', 1, new Date(now.getTime() - i * 60_000));
      }

      const signals = detector.detect();
      const restart = signals.find((s) => s.type === 'pod_restart');
      expect(restart).toBeDefined();
      expect(restart!.severity).toBe('critical');
    });
  });

  describe('cost spike detection', () => {
    it('detects cost spike above 3x average', () => {
      detector.addSample('cost_spike', 100);
      detector.addSample('cost_spike', 110);
      detector.addSample('cost_spike', 95);
      detector.addSample('cost_spike', 500); // Spike

      const signals = detector.detect();
      const cost = signals.find((s) => s.type === 'cost_spike');
      expect(cost).toBeDefined();
      expect(cost!.description).toContain('$500');
    });
  });

  describe('coverage drop detection', () => {
    it('detects test coverage decrease', () => {
      detector.addSample('coverage_drop', 85);
      detector.addSample('coverage_drop', 78);

      const signals = detector.detect();
      const coverage = signals.find((s) => s.type === 'coverage_drop');
      expect(coverage).toBeDefined();
      expect(coverage!.description).toContain('85');
      expect(coverage!.description).toContain('78');
    });

    it('does not alert when coverage increases', () => {
      detector.addSample('coverage_drop', 80);
      detector.addSample('coverage_drop', 85);

      const signals = detector.detect();
      const coverage = signals.find((s) => s.type === 'coverage_drop');
      expect(coverage).toBeUndefined();
    });
  });

  describe('certificate expiry detection', () => {
    it('detects critical when cert expires in <=7 days', () => {
      detector.addSample('cert_expiry', 5);

      const signals = detector.detect();
      const cert = signals.find((s) => s.type === 'cert_expiry');
      expect(cert).toBeDefined();
      expect(cert!.severity).toBe('critical');
    });

    it('detects warning when cert expires in <=30 days', () => {
      detector.addSample('cert_expiry', 20);

      const signals = detector.detect();
      const cert = signals.find((s) => s.type === 'cert_expiry');
      expect(cert).toBeDefined();
      expect(cert!.severity).toBe('warning');
    });

    it('does not alert when cert is far from expiry', () => {
      detector.addSample('cert_expiry', 90);

      const signals = detector.detect();
      const cert = signals.find((s) => s.type === 'cert_expiry');
      expect(cert).toBeUndefined();
    });
  });

  describe('acknowledgement', () => {
    it('acknowledges an anomaly and removes from active list', () => {
      for (let i = 0; i < 20; i++) detector.addSample('error_rate_spike', 0);
      for (let i = 0; i < 20; i++) detector.addSample('error_rate_spike', 50);

      const signals = detector.detect();
      expect(signals.length).toBeGreaterThan(0);

      const active = detector.getActiveAnomalies();
      expect(active.length).toBeGreaterThan(0);

      detector.acknowledge(active[0].id);
      expect(detector.getActiveAnomalies().length).toBe(0);
    });
  });

  describe('threshold alerts', () => {
    it('includes threshold value in the signal', () => {
      detector.addSample('cert_expiry', 3);

      const signals = detector.detect();
      const cert = signals.find((s) => s.type === 'cert_expiry');
      expect(cert).toBeDefined();
      expect(cert!.threshold).toBe(7);
      expect(cert!.value).toBe(3);
    });
  });
});
