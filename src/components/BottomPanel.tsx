import React from 'react';
import { useAppStore, BottomPanel as BottomPanelType } from '../store/app-store';
import { Terminal } from '../panels/Terminal/Terminal';
import { DiffPanel } from '../panels/DiffPanel/DiffPanel';
import { CodeActionsPanel } from '../panels/CodeActionsPanel/CodeActionsPanel';

const bottomTabs: { id: BottomPanelType; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'logs', label: 'Logs' },
  { id: 'traces', label: 'Traces' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'diff', label: 'Diff' },
  { id: 'code-actions', label: 'Code Actions' },
];

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
    borderTop: '1px solid #3e3e42',
  },
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    height: 35,
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
    paddingLeft: 8,
    gap: 0,
  },
  tab: {
    padding: '0 12px',
    height: 35,
    display: 'flex',
    alignItems: 'center',
    fontSize: 12,
    color: '#858585',
    cursor: 'pointer',
    border: 'none',
    backgroundColor: 'transparent',
    borderBottom: '2px solid transparent',
    fontFamily: 'inherit',
  },
  tabActive: {
    color: '#cccccc',
    borderBottom: '2px solid #007acc',
  },
  collapseBtn: {
    marginLeft: 'auto',
    padding: '0 10px',
    height: 35,
    display: 'flex',
    alignItems: 'center',
    fontSize: 12,
    color: '#858585',
    cursor: 'pointer',
    border: 'none',
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: 12,
    fontSize: 12,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    color: '#cccccc',
  },
  logLine: {
    padding: '2px 0',
    display: 'flex',
    gap: 8,
  },
  timestamp: {
    color: '#858585',
    minWidth: 80,
  },
};

const TimelineContent: React.FC = () => (
  <div style={styles.content}>
    <div style={{ color: '#858585', marginBottom: 8 }}>
      System Timeline — correlated events across code, deploys, and infrastructure
    </div>
    <div style={styles.logLine}>
      <span style={styles.timestamp}>14:32:05</span>
      <span style={{ color: '#4ec9b0' }}>DEPLOY</span>
      <span>v2.1.3 deployed to staging</span>
    </div>
    <div style={styles.logLine}>
      <span style={styles.timestamp}>14:31:42</span>
      <span style={{ color: '#569cd6' }}>GIT</span>
      <span>Merged PR #142 — fix: handle null response in auth flow</span>
    </div>
    <div style={styles.logLine}>
      <span style={styles.timestamp}>14:28:10</span>
      <span style={{ color: '#dcdcaa' }}>METRIC</span>
      <span>p99 latency dropped to 120ms (was 340ms)</span>
    </div>
  </div>
);

const LogsContent: React.FC = () => (
  <div style={styles.content}>
    <div style={styles.logLine}>
      <span style={styles.timestamp}>14:32:10</span>
      <span style={{ color: '#569cd6' }}>INFO</span>
      <span>Server started on port 8080</span>
    </div>
    <div style={styles.logLine}>
      <span style={styles.timestamp}>14:32:08</span>
      <span style={{ color: '#dcdcaa' }}>WARN</span>
      <span>Deprecation warning: use crypto.randomUUID() instead</span>
    </div>
    <div style={styles.logLine}>
      <span style={styles.timestamp}>14:31:55</span>
      <span style={{ color: '#569cd6' }}>INFO</span>
      <span>Database connection pool initialized (5 connections)</span>
    </div>
  </div>
);

const TracesContent: React.FC = () => (
  <div style={styles.content}>
    <div style={{ color: '#858585', marginBottom: 8 }}>
      Distributed Traces — click a trace to expand
    </div>
    <div style={{ padding: '4px 0', color: '#cccccc' }}>
      <span style={{ color: '#4ec9b0' }}>GET</span> /api/users — 42ms — 200
    </div>
    <div style={{ padding: '4px 0', color: '#cccccc' }}>
      <span style={{ color: '#4ec9b0' }}>POST</span> /api/auth/login — 128ms — 200
    </div>
    <div style={{ padding: '4px 0', color: '#f44747' }}>
      <span style={{ color: '#f44747' }}>GET</span> /api/orders/bulk — 2340ms — 504
    </div>
  </div>
);

const MetricsContent: React.FC = () => (
  <div style={styles.content}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      <div>
        <div style={{ color: '#858585', fontSize: 11, marginBottom: 4 }}>CPU Usage</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: '#4ec9b0' }}>23%</div>
      </div>
      <div>
        <div style={{ color: '#858585', fontSize: 11, marginBottom: 4 }}>Memory</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: '#569cd6' }}>1.2 GB</div>
      </div>
      <div>
        <div style={{ color: '#858585', fontSize: 11, marginBottom: 4 }}>p99 Latency</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: '#dcdcaa' }}>120ms</div>
      </div>
      <div>
        <div style={{ color: '#858585', fontSize: 11, marginBottom: 4 }}>Req/sec</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: '#cccccc' }}>842</div>
      </div>
      <div>
        <div style={{ color: '#858585', fontSize: 11, marginBottom: 4 }}>Error Rate</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: '#4ec9b0' }}>0.02%</div>
      </div>
      <div>
        <div style={{ color: '#858585', fontSize: 11, marginBottom: 4 }}>Uptime</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: '#4ec9b0' }}>99.98%</div>
      </div>
    </div>
  </div>
);

const TerminalContent: React.FC = () => <Terminal />;

const DiffContent: React.FC = () => <DiffPanel />;
const CodeActionsContent: React.FC = () => <CodeActionsPanel />;

const panelComponents: Record<BottomPanelType, React.FC> = {
  timeline: TimelineContent,
  logs: LogsContent,
  traces: TracesContent,
  metrics: MetricsContent,
  terminal: TerminalContent,
  diff: DiffContent,
  'code-actions': CodeActionsContent,
};

export const BottomPanel: React.FC = () => {
  const { activeBottomPanel, setBottomPanel, toggleBottomPanel } = useAppStore();
  const ActiveContent = panelComponents[activeBottomPanel];

  return (
    <div style={styles.container}>
      <div style={styles.tabBar}>
        {bottomTabs.map((tab) => (
          <button
            key={tab.id}
            style={{
              ...styles.tab,
              ...(activeBottomPanel === tab.id ? styles.tabActive : {}),
            }}
            onClick={() => setBottomPanel(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <button style={styles.collapseBtn} onClick={toggleBottomPanel} title="Toggle panel">
          ▾
        </button>
      </div>
      <ActiveContent />
    </div>
  );
};
