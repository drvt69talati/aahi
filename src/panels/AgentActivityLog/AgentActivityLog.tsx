import React, { useState, useRef, useEffect } from 'react';

type ActionStatus = 'running' | 'completed' | 'failed';

interface AgentAction {
  id: string;
  timestamp: number;
  agentName: string;
  action: string;
  status: ActionStatus;
  duration?: number; // ms
  params?: Record<string, unknown>;
  result?: string;
  error?: string;
}

interface AgentActivityLogProps {
  actions: AgentAction[];
  agents: string[];
}

const statusColors: Record<ActionStatus, string> = {
  running: '#cca700',
  completed: '#4ec9b0',
  failed: '#f44747',
};

const statusIcons: Record<ActionStatus, string> = {
  running: '\u25CB', // circle
  completed: '\u2713', // checkmark
  failed: '\u2717', // x mark
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
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: '#858585',
    fontSize: 13,
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

export const AgentActivityLog: React.FC<AgentActivityLogProps> = ({ actions, agents }) => {
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
  }, [actions]);

  const filtered =
    filterAgent === 'all' ? actions : actions.filter((a) => a.agentName === filterAgent);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Agent Activity Log</span>
        <span style={{ fontSize: 11, color: '#858585' }}>
          {actions.filter((a) => a.status === 'running').length} running
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
        <div style={styles.emptyState}>No agent activity recorded</div>
      ) : (
        <div ref={listRef} style={styles.list}>
          {filtered.map((entry) => (
            <div
              key={entry.id}
              style={{
                ...styles.entry,
                backgroundColor: expandedId === entry.id ? '#2d2d2d' : 'transparent',
              }}
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            >
              <div style={styles.entryTop}>
                {entry.status === 'running' ? (
                  <div style={styles.spinner} />
                ) : (
                  <span
                    style={{
                      ...styles.statusIcon,
                      color: statusColors[entry.status],
                    }}
                  >
                    {statusIcons[entry.status]}
                  </span>
                )}
                <span style={styles.timestamp}>{formatTime(entry.timestamp)}</span>
                <span style={styles.agentBadge}>{entry.agentName}</span>
                <span style={styles.actionText}>{entry.action}</span>
                {entry.duration != null && (
                  <span style={styles.duration}>{formatDuration(entry.duration)}</span>
                )}
              </div>

              {expandedId === entry.id && (
                <div style={styles.expandedContent}>
                  {entry.params && (
                    <div style={styles.expandedSection}>
                      <div style={styles.expandedLabel}>Parameters</div>
                      <div style={styles.expandedValue}>
                        {JSON.stringify(entry.params, null, 2)}
                      </div>
                    </div>
                  )}
                  {entry.result && (
                    <div style={styles.expandedSection}>
                      <div style={styles.expandedLabel}>Result</div>
                      <div style={styles.expandedValue}>{entry.result}</div>
                    </div>
                  )}
                  {entry.error && (
                    <div style={styles.expandedSection}>
                      <div style={{ ...styles.expandedLabel, color: '#f44747' }}>Error</div>
                      <div style={{ ...styles.expandedValue, color: '#f44747' }}>
                        {entry.error}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
