import React from 'react';
import { useAppStore, SidebarPanel } from '../store/app-store';
import { FileExplorer } from '../editor/FileExplorer';
import { SearchPanel } from '../panels/SearchPanel/SearchPanel';
import { GitPanel } from '../panels/GitPanel/GitPanel';
import { WorkspacePanel } from '../panels/WorkspacePanel/WorkspacePanel';
import { KnowledgeGraph } from '../panels/KnowledgeGraph/KnowledgeGraph';

const sidebarTabs: { id: SidebarPanel; icon: string; label: string }[] = [
  { id: 'explorer', icon: '📁', label: 'Explorer' },
  { id: 'search', icon: '🔍', label: 'Search' },
  { id: 'git', icon: '🔀', label: 'Source Control' },
  { id: 'integrations', icon: '🔌', label: 'Integration Hub' },
  { id: 'agent-log', icon: '🤖', label: 'Agent Activity' },
  { id: 'proactive', icon: '💡', label: 'Proactive Feed' },
  { id: 'knowledge-graph', icon: '🧠', label: 'Knowledge Graph' },
  { id: 'workspace', icon: '💼', label: 'Workspace' },
];

const styles = {
  container: {
    display: 'flex',
    height: '100%',
    backgroundColor: '#252526',
    borderRight: '1px solid #3e3e42',
  },
  iconBar: {
    display: 'flex',
    flexDirection: 'column' as const,
    width: 48,
    backgroundColor: '#333333',
    borderRight: '1px solid #3e3e42',
    paddingTop: 4,
  },
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: 18,
    position: 'relative' as const,
  },
  iconActive: {
    borderLeft: '2px solid #007acc',
  },
  contentArea: {
    width: 220,
    overflow: 'hidden',
  },
  panelHeader: {
    padding: '10px 12px',
    fontSize: 11,
    fontWeight: 600,
    color: '#858585',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    borderBottom: '1px solid #3e3e42',
  },
  panelContent: {
    padding: 12,
    fontSize: 13,
    color: '#cccccc',
    overflowY: 'auto' as const,
    height: 'calc(100% - 36px)',
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 4px',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 13,
    color: '#cccccc',
  },
  folderItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 4px',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 13,
    color: '#cccccc',
    fontWeight: 500,
  },
  integrationItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 4px',
    borderBottom: '1px solid #3e3e4233',
    fontSize: 13,
    color: '#cccccc',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
  },
  agentItem: {
    padding: '8px 4px',
    borderBottom: '1px solid #3e3e4233',
    fontSize: 12,
  },
  feedItem: {
    padding: '8px 4px',
    borderBottom: '1px solid #3e3e4233',
    fontSize: 12,
    color: '#cccccc',
  },
};

const ExplorerPanel: React.FC = () => <FileExplorer />;

const IntegrationsPanel: React.FC = () => (
  <>
    <div style={styles.panelHeader}>Integration Hub</div>
    <div style={styles.panelContent}>
      <div style={styles.integrationItem}>
        <div style={{ ...styles.statusDot, backgroundColor: '#4ec9b0' }} />
        <span>GitHub</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#4ec9b0' }}>Connected</span>
      </div>
      <div style={styles.integrationItem}>
        <div style={{ ...styles.statusDot, backgroundColor: '#4ec9b0' }} />
        <span>Kubernetes</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#4ec9b0' }}>Connected</span>
      </div>
      <div style={styles.integrationItem}>
        <div style={{ ...styles.statusDot, backgroundColor: '#858585' }} />
        <span>Datadog</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#858585' }}>Not configured</span>
      </div>
      <div style={styles.integrationItem}>
        <div style={{ ...styles.statusDot, backgroundColor: '#858585' }} />
        <span>PagerDuty</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#858585' }}>Not configured</span>
      </div>
      <div style={{ padding: '12px 4px', fontSize: 12, color: '#858585' }}>
        + Add Integration...
      </div>
    </div>
  </>
);

const AgentLogPanel: React.FC = () => (
  <>
    <div style={styles.panelHeader}>Agent Activity</div>
    <div style={styles.panelContent}>
      <div style={styles.agentItem}>
        <div style={{ color: '#4ec9b0', fontWeight: 500 }}>Proactive Agent</div>
        <div style={{ color: '#858585', marginTop: 2 }}>Idle — monitoring 3 repos</div>
      </div>
      <div style={styles.agentItem}>
        <div style={{ color: '#569cd6', fontWeight: 500 }}>Debug Agent</div>
        <div style={{ color: '#858585', marginTop: 2 }}>Ready</div>
      </div>
      <div style={styles.agentItem}>
        <div style={{ color: '#dcdcaa', fontWeight: 500 }}>Temporal Agent</div>
        <div style={{ color: '#858585', marginTop: 2 }}>Last run: 5m ago</div>
      </div>
      <div style={{ padding: '12px 4px', fontSize: 11, color: '#858585' }}>
        No recent agent actions.
      </div>
    </div>
  </>
);

const ProactiveFeedPanel: React.FC = () => {
  const focusMode = useAppStore((s) => s.focusMode);

  return (
    <>
      <div style={styles.panelHeader}>Proactive Feed</div>
      <div style={styles.panelContent}>
        {focusMode ? (
          <div style={{ color: '#858585', fontSize: 12, padding: '12px 0' }}>
            Focus mode enabled. Proactive alerts are suppressed.
          </div>
        ) : (
          <>
            <div style={styles.feedItem}>
              <div style={{ color: '#dcdcaa', fontWeight: 500, marginBottom: 2 }}>
                Suggestion
              </div>
              <div>Consider adding error boundary to App component</div>
              <div style={{ color: '#858585', marginTop: 4, fontSize: 11 }}>2m ago</div>
            </div>
            <div style={styles.feedItem}>
              <div style={{ color: '#4ec9b0', fontWeight: 500, marginBottom: 2 }}>
                Optimization
              </div>
              <div>Bundle size can be reduced by code-splitting the editor</div>
              <div style={{ color: '#858585', marginTop: 4, fontSize: 11 }}>15m ago</div>
            </div>
          </>
        )}
      </div>
    </>
  );
};

const KnowledgeGraphPanel: React.FC = () => <KnowledgeGraph />;

const panelComponents: Record<SidebarPanel, React.FC> = {
  explorer: ExplorerPanel,
  search: SearchPanel,
  git: GitPanel,
  integrations: IntegrationsPanel,
  'agent-log': AgentLogPanel,
  proactive: ProactiveFeedPanel,
  'knowledge-graph': KnowledgeGraphPanel,
  workspace: WorkspacePanel,
};

export const Sidebar: React.FC = () => {
  const { leftSidebarOpen, activeSidebarPanel, setSidebarPanel, toggleLeftSidebar } =
    useAppStore();

  const ActivePanel = panelComponents[activeSidebarPanel];

  return (
    <div style={styles.container}>
      <div style={styles.iconBar}>
        {sidebarTabs.map((tab) => (
          <button
            key={tab.id}
            style={{
              ...styles.iconBtn,
              ...(activeSidebarPanel === tab.id && leftSidebarOpen
                ? styles.iconActive
                : {}),
              opacity: activeSidebarPanel === tab.id && leftSidebarOpen ? 1 : 0.6,
            }}
            title={tab.label}
            onClick={() => {
              if (activeSidebarPanel === tab.id && leftSidebarOpen) {
                toggleLeftSidebar();
              } else {
                setSidebarPanel(tab.id);
              }
            }}
          >
            {tab.icon}
          </button>
        ))}
      </div>
      {leftSidebarOpen && (
        <div style={styles.contentArea}>
          <ActivePanel />
        </div>
      )}
    </div>
  );
};
