import React, { useState, useCallback } from 'react';
import { useAppStore } from '../../store/app-store';
import { useRuntimeStore } from '../../store/runtime-store';

type AlertSeverity = 'critical' | 'warning' | 'info';

const severityColors: Record<AlertSeverity, string> = {
  critical: '#d32f2f',
  warning: '#cca700',
  info: '#007acc',
};

const severityIcons: Record<AlertSeverity, string> = {
  critical: '\u26A0',
  warning: '\u25B2',
  info: '\u24D8',
};

const severityLabels: Record<AlertSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

const severityOrder: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 600 as const,
    color: '#cccccc',
  },
  focusBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: '#007acc22',
    borderBottom: '1px solid #007acc44',
    fontSize: 12,
    color: '#569cd6',
  },
  focusBannerText: {
    fontWeight: 500 as const,
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  severityGroup: {
    marginBottom: 4,
  },
  severityGroupHeader: {
    padding: '4px 12px',
    fontSize: 10,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    color: '#858585',
  },
  alert: {
    padding: '10px 12px',
    borderBottom: '1px solid #2d2d2d',
    borderLeft: '3px solid transparent',
  },
  alertHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  alertIcon: {
    fontSize: 13,
    width: 18,
    textAlign: 'center' as const,
  },
  alertTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: 500 as const,
    color: '#cccccc',
  },
  alertTimestamp: {
    fontSize: 10,
    color: '#858585',
  },
  alertDescription: {
    fontSize: 12,
    color: '#858585',
    lineHeight: '1.5',
    marginLeft: 26,
    marginBottom: 8,
  },
  alertActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginLeft: 26,
  },
  suggestedBtn: {
    padding: '3px 10px',
    backgroundColor: '#007acc22',
    color: '#007acc',
    border: '1px solid #007acc44',
    borderRadius: 3,
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  dismissBtn: {
    padding: '3px 10px',
    backgroundColor: 'transparent',
    color: '#858585',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: '#858585',
    fontSize: 13,
    gap: 8,
  },
};

function formatRelativeTime(ts: string | number): string {
  const tsNum = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const diff = Date.now() - tsNum;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const ProactiveFeed: React.FC = () => {
  const focusMode = useAppStore((s) => s.focusMode);
  const proactiveAlerts = useRuntimeStore((s) => s.proactiveAlerts);
  const runAgent = useRuntimeStore((s) => s.runAgent);

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const alerts = proactiveAlerts || [];
  const visibleAlerts = alerts.filter((a) => !dismissedIds.has(a.id));
  const suppressedCount = focusMode
    ? visibleAlerts.filter((a) => a.severity !== 'critical').length
    : 0;
  const displayAlerts = focusMode
    ? visibleAlerts.filter((a) => a.severity === 'critical')
    : visibleAlerts;

  // Group by severity
  const grouped = displayAlerts.reduce(
    (acc, alert) => {
      const sev = alert.severity as AlertSeverity;
      acc[sev] = acc[sev] || [];
      acc[sev].push(alert);
      return acc;
    },
    {} as Record<AlertSeverity, typeof displayAlerts>
  );

  const sortedSeverities = (Object.keys(grouped) as AlertSeverity[]).sort(
    (a, b) => severityOrder[a] - severityOrder[b]
  );

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => new Set([...prev, id]));
  }, []);

  const handleInvestigate = useCallback(
    (alert: { id: string; suggestedAction?: string; title?: string }) => {
      // Run the appropriate agent based on alert context
      const agentId = alert.suggestedAction?.toLowerCase().includes('debug')
        ? 'debug'
        : alert.suggestedAction?.toLowerCase().includes('deploy')
          ? 'deploy'
          : 'investigate';
      runAgent(agentId, alert.title || alert.id);
    },
    [runAgent]
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Proactive Alerts</span>
        <span style={{ fontSize: 11, color: '#858585' }}>{displayAlerts.length} active</span>
      </div>

      {focusMode && (
        <div style={styles.focusBanner}>
          <span style={styles.focusBannerText}>Focus Mode Active</span>
          <span style={{ fontSize: 11 }}>{suppressedCount} alerts suppressed</span>
        </div>
      )}

      {displayAlerts.length === 0 ? (
        <div style={styles.emptyState}>
          <span style={{ fontSize: 24, color: '#4ec9b0' }}>{'\u2713'}</span>
          <span>No active alerts</span>
        </div>
      ) : (
        <div style={styles.list}>
          {sortedSeverities.map((severity) => (
            <div key={severity} style={styles.severityGroup}>
              <div
                style={{
                  ...styles.severityGroupHeader,
                  color: severityColors[severity],
                }}
              >
                {severityLabels[severity]}
              </div>
              {grouped[severity].map((alert) => (
                <div
                  key={alert.id}
                  style={{
                    ...styles.alert,
                    borderLeftColor: severityColors[alert.severity as AlertSeverity] || '#858585',
                  }}
                >
                  <div style={styles.alertHeader}>
                    <span
                      style={{
                        ...styles.alertIcon,
                        color: severityColors[alert.severity as AlertSeverity] || '#858585',
                      }}
                    >
                      {severityIcons[alert.severity as AlertSeverity] || '\u2022'}
                    </span>
                    <span style={styles.alertTitle}>{alert.title}</span>
                    <span style={styles.alertTimestamp}>
                      {formatRelativeTime(alert.timestamp)}
                    </span>
                  </div>
                  <div style={styles.alertDescription}>{alert.description}</div>
                  <div style={styles.alertActions}>
                    <button
                      style={styles.suggestedBtn}
                      onClick={() => handleInvestigate(alert)}
                    >
                      {alert.suggestedAction || 'Investigate'}
                    </button>
                    <button
                      style={styles.dismissBtn}
                      onClick={() => handleDismiss(alert.id)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
