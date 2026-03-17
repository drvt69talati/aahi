import React, { useState, useRef, useEffect } from 'react';
import { useRuntimeStore } from '../../store/runtime-store';

type ActionStatus = 'running' | 'completed' | 'failed';

const statusColors: Record<ActionStatus, string> = {
  running: '#cca700',
  completed: '#4ec9b0',
  failed: '#f44747',
};

const statusIcons: Record<ActionStatus, string> = {
  running: '\u25CB',
  completed: '\u2713',
  failed: '\u2717',
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
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderBottom: '1px solid #3e3e42',
    backgroundColor: '#252526',
  },
  filterLabel: {
    fontSize: 11,
    color: '#858585',
  },
  filterSelect: {
    padding: '3px 8px',
    backgroundColor: '#2d2d2d',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    color: '#cccccc',
    fontSize: 11,
    fontFamily: 'inherit',
    outline: 'none',
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  entry: {
    padding: '8px 12px',
    borderBottom: '1px solid #2d2d2d',
    cursor: 'pointer',
    fontSize: 12,
  },
  entryTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  statusIcon: {
    fontSize: 12,
    fontWeight: 700 as const,
    width: 16,
    textAlign: 'center' as const,
  },
  timestamp: {
    fontSize: 10,
    color: '#858585',
    minWidth: 70,
  },
  agentBadge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 3,
    backgroundColor: '#007acc22',
    color: '#569cd6',
    border: '1px solid #007acc44',
  },
  actionText: {
    flex: 1,
    color: '#cccccc',
    fontSize: 12,
  },
  duration: {
    fontSize: 10,
    color: '#858585',
  },
  expandedContent: {
    marginTop: 6,
    marginLeft: 24,
    padding: 8,
    backgroundColor: '#2d2d2d',
    borderRadius: 4,
    border: '1px solid #3e3e42',
  },
  expandedSection: {
    marginBottom: 6,
  },
  expandedLabel: {
    fontSize: 10,
    color: '#858585',
    fontWeight: 600 as const,
    marginBottom: 2,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  expandedValue: {
    fontSize: 11,
    color: '#cccccc',
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    whiteSpace: 'pre-wrap' as const,
    maxHeight: 100,
    overflowY: 'auto' as const,
  },
  spinner: {
    display: 'inline-block',
    width: 10,
    height: 10,
    border: '2px solid #cca70044',
    borderTopColor: '#cca700',
    borderRadius: '50%',
    animation: 'aahi-spin 0.8s linear infinite',
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
  stepList: {
    marginTop: 6,
    marginLeft: 24,
  },
  stepItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 0',
    fontSize: 11,
  },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const AgentActivityLog: React.FC = () => {
  const agentExecutions = useRuntimeStore((s) => s.agentExecutions);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const listRef = useRef<HTMLDivElement>(null);

  // Inject spin animation
  useEffect(() => {
    const styleId = 'aahi-agent-log-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes aahi-spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Auto-scroll to latest
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [agentExecutions]);

  const executions = agentExecutions || [];

  // Derive unique agent names
  const agents = Array.from(new Set(executions.map((e) => e.agentId)));

  const filtered =
    filterAgent === 'all'
      ? executions
      : executions.filter((e) => e.agentId === filterAgent);

  const runningCount = executions.filter((e) => e.status === 'running').length;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Agent Activity Log</span>
        <span style={{ fontSize: 11, color: '#858585' }}>
          {runningCount} running
        </span>
      </div>

      <div style={styles.filterBar}>
        <span style={styles.filterLabel}>Agent:</span>
        <select
          style={styles.filterSelect}
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
        >
          <option value="all">All Agents</option>
          {agents.map((agent) => (
            <option key={agent} value={agent}>
              {agent}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={styles.emptyState}>
          <span style={{ fontSize: 20, color: '#569cd6' }}>{'\u2699'}</span>
          <span>No agent activity recorded</span>
        </div>
      ) : (
        <div ref={listRef} style={styles.list}>
          {filtered.map((exec) => {
            // Compute duration from steps if available
            const totalDuration = exec.steps?.reduce(
              (sum, s) => sum + (s.durationMs || 0),
              0
            );
            const lastStep = exec.steps?.[exec.steps.length - 1];
            const execError = exec.steps?.find((s) => s.error)?.error;

            return (
              <div
                key={exec.planId}
                style={{
                  ...styles.entry,
                  backgroundColor: expandedId === exec.planId ? '#2d2d2d' : 'transparent',
                }}
                onClick={() => setExpandedId(expandedId === exec.planId ? null : exec.planId)}
              >
                <div style={styles.entryTop}>
                  {exec.status === 'running' ? (
                    <div style={styles.spinner} />
                  ) : (
                    <span
                      style={{
                        ...styles.statusIcon,
                        color: statusColors[exec.status as ActionStatus] || '#858585',
                      }}
                    >
                      {statusIcons[exec.status as ActionStatus] || '\u2022'}
                    </span>
                  )}
                  <span style={styles.agentBadge}>{exec.agentId}</span>
                  <span style={styles.actionText}>{exec.intent || 'Execution'}</span>
                  {totalDuration != null && totalDuration > 0 && (
                    <span style={styles.duration}>{formatDuration(totalDuration)}</span>
                  )}
                </div>

                {/* Step progress */}
                {exec.steps && exec.steps.length > 0 && (
                  <div style={styles.stepList}>
                    {exec.steps.map((step, idx) => (
                      <div key={step.id || idx} style={styles.stepItem}>
                        {step.status === 'running' ? (
                          <div style={{ ...styles.spinner, width: 8, height: 8 }} />
                        ) : (
                          <span
                            style={{
                              ...styles.statusIcon,
                              fontSize: 10,
                              width: 12,
                              color: statusColors[step.status as ActionStatus] || '#858585',
                            }}
                          >
                            {statusIcons[step.status as ActionStatus] || '\u2022'}
                          </span>
                        )}
                        <span style={{ color: '#cccccc' }}>{step.name}</span>
                        {step.durationMs != null && (
                          <span style={styles.duration}>{formatDuration(step.durationMs)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Expanded details */}
                {expandedId === exec.planId && (
                  <div style={styles.expandedContent}>
                    {lastStep?.result && (
                      <div style={styles.expandedSection}>
                        <div style={styles.expandedLabel}>Result</div>
                        <div style={styles.expandedValue}>
                          {typeof lastStep.result === 'string'
                            ? lastStep.result
                            : JSON.stringify(lastStep.result, null, 2)}
                        </div>
                      </div>
                    )}
                    {execError && (
                      <div style={styles.expandedSection}>
                        <div style={{ ...styles.expandedLabel, color: '#f44747' }}>Error</div>
                        <div style={{ ...styles.expandedValue, color: '#f44747' }}>
                          {execError}
                        </div>
                      </div>
                    )}
                    {!lastStep?.result && !execError && (
                      <div style={{ fontSize: 11, color: '#858585' }}>
                        {exec.status === 'running' ? 'Execution in progress...' : 'No details available'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
