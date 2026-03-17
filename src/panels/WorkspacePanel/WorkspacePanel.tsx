// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Workspace management panel.  Shows current workspace, recent sessions,
// and controls for saving / restoring / clearing session state.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../../store/app-store';
import { useRuntimeStore } from '../../store/runtime-store';
import { getSessionManager } from '../../store/session-manager';

interface SessionEntry {
  name: string;
  savedAt: string;
  rootPath: string;
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#252526',
    color: '#cccccc',
  },
  header: {
    padding: '10px 12px',
    fontSize: 11,
    fontWeight: 600,
    color: '#858585',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    borderBottom: '1px solid #3e3e42',
  },
  content: {
    padding: 12,
    fontSize: 13,
    overflowY: 'auto' as const,
    flex: 1,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: '#858585',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  currentWorkspace: {
    padding: '8px 10px',
    backgroundColor: '#2d2d30',
    borderRadius: 4,
    border: '1px solid #3e3e42',
    marginBottom: 4,
  },
  workspaceName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#e0e0e0',
    marginBottom: 2,
  },
  workspacePath: {
    fontSize: 11,
    color: '#858585',
    wordBreak: 'break-all' as const,
  },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 10px',
    fontSize: 12,
    border: '1px solid #3e3e42',
    borderRadius: 3,
    backgroundColor: '#333333',
    color: '#cccccc',
    cursor: 'pointer',
    marginRight: 6,
    marginBottom: 4,
  },
  btnPrimary: {
    backgroundColor: '#007acc',
    border: '1px solid #007acc',
    color: '#ffffff',
  },
  btnDanger: {
    backgroundColor: '#5a1d1d',
    border: '1px solid #6e2b2b',
    color: '#f48771',
  },
  sessionItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 8px',
    borderRadius: 3,
    cursor: 'pointer',
    marginBottom: 2,
    border: '1px solid transparent',
  },
  sessionItemHover: {
    backgroundColor: '#2a2d2e',
    border: '1px solid #3e3e42',
  },
  sessionInfo: {
    flex: 1,
    minWidth: 0,
  },
  sessionName: {
    fontSize: 13,
    color: '#e0e0e0',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  sessionMeta: {
    fontSize: 10,
    color: '#858585',
    marginTop: 1,
  },
  deleteBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    border: 'none',
    backgroundColor: 'transparent',
    color: '#858585',
    cursor: 'pointer',
    fontSize: 14,
    borderRadius: 3,
    flexShrink: 0,
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 0',
    fontSize: 12,
    color: '#858585',
  },
  toggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    fontSize: 12,
    color: '#cccccc',
  },
  toggleTrack: {
    width: 28,
    height: 14,
    borderRadius: 7,
    position: 'relative' as const,
    cursor: 'pointer',
  },
  toggleThumb: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    position: 'absolute' as const,
    top: 2,
    transition: 'left 0.15s ease',
  },
  emptyState: {
    padding: '12px 0',
    fontSize: 12,
    color: '#858585',
    fontStyle: 'italic' as const,
  },
  inputRow: {
    display: 'flex',
    gap: 4,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    padding: '4px 8px',
    fontSize: 12,
    backgroundColor: '#3c3c3c',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    color: '#cccccc',
    outline: 'none',
  },
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
  } catch {
    return 'Unknown';
  }
}

export const WorkspacePanel: React.FC = () => {
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const workspaceRoot = useRuntimeStore((s) => s.workspaceRoot);

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [folderInput, setFolderInput] = useState('');

  const sm = getSessionManager();

  const refreshSessions = useCallback(async () => {
    const list = await sm.listSessions();
    setSessions(list);
    if (list.length > 0) {
      setLastSaved(list[0].savedAt);
    }
  }, [sm]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const handleSaveNow = useCallback(async () => {
    await sm.saveSession();
    await refreshSessions();
  }, [sm, refreshSessions]);

  const handleClearSession = useCallback(async () => {
    await sm.deleteSession(currentWorkspace);
    await refreshSessions();
  }, [sm, currentWorkspace, refreshSessions]);

  const handleOpenSession = useCallback(
    async (name: string) => {
      await sm.loadSession(name);
      await refreshSessions();
    },
    [sm, refreshSessions],
  );

  const handleDeleteSession = useCallback(
    async (name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      await sm.deleteSession(name);
      await refreshSessions();
    },
    [sm, refreshSessions],
  );

  const handleOpenFolder = useCallback(async () => {
    const path = folderInput.trim();
    if (!path) return;
    const rt = useRuntimeStore.getState();
    const app = useAppStore.getState();
    await rt.loadFileTree(path);
    // Derive workspace name from folder
    const name = path.split('/').filter(Boolean).pop() || 'workspace';
    app.setWorkspace(name);
    setFolderInput('');
    await refreshSessions();
  }, [folderInput, refreshSessions]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>Workspace</div>
      <div style={styles.content}>
        {/* Current Workspace */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Current Workspace</div>
          <div style={styles.currentWorkspace}>
            <div style={styles.workspaceName}>{currentWorkspace || 'No workspace'}</div>
            <div style={styles.workspacePath}>{workspaceRoot || 'No folder open'}</div>
          </div>
        </div>

        {/* Open Workspace */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Open Workspace</div>
          <div style={styles.inputRow}>
            <input
              style={styles.input}
              type="text"
              placeholder="Enter folder path..."
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleOpenFolder();
              }}
            />
            <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={handleOpenFolder}>
              Open
            </button>
          </div>
        </div>

        {/* Recent Workspaces */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Recent Workspaces</div>
          {sessions.length === 0 ? (
            <div style={styles.emptyState}>No saved sessions yet.</div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.name}
                style={{
                  ...styles.sessionItem,
                  ...(hoveredSession === s.name ? styles.sessionItemHover : {}),
                }}
                onMouseEnter={() => setHoveredSession(s.name)}
                onMouseLeave={() => setHoveredSession(null)}
                onClick={() => handleOpenSession(s.name)}
              >
                <div style={styles.sessionInfo}>
                  <div style={styles.sessionName}>{s.name}</div>
                  <div style={styles.sessionMeta}>
                    {s.rootPath} &middot; {formatDate(s.savedAt)}
                  </div>
                </div>
                <button
                  style={{
                    ...styles.deleteBtn,
                    opacity: hoveredSession === s.name ? 1 : 0,
                  }}
                  title="Delete session"
                  onClick={(e) => handleDeleteSession(s.name, e)}
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>

        {/* Session Info */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Session</div>

          <div style={styles.statusRow}>
            <span>Auto-save</span>
            <label style={styles.toggle}>
              <div
                style={{
                  ...styles.toggleTrack,
                  backgroundColor: autoSaveEnabled ? '#007acc' : '#555555',
                }}
                onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
              >
                <div
                  style={{
                    ...styles.toggleThumb,
                    left: autoSaveEnabled ? 16 : 2,
                  }}
                />
              </div>
            </label>
          </div>

          {lastSaved && (
            <div style={styles.statusRow}>
              <span>Last saved</span>
              <span>{formatDate(lastSaved)}</span>
            </div>
          )}

          <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
            <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={handleSaveNow}>
              Save Now
            </button>
            <button style={{ ...styles.btn, ...styles.btnDanger }} onClick={handleClearSession}>
              Clear Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
