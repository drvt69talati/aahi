// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Bottom status bar (VS Code style).  Shows branch, workspace root,
// cursor position, language, encoding, line endings, model, and connection.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { useAppStore } from '../store/app-store';
import { useRuntimeStore } from '../store/runtime-store';

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    height: 22,
    backgroundColor: '#007acc',
    color: '#ffffff',
    fontSize: 12,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    paddingLeft: 8,
    paddingRight: 8,
    boxSizing: 'border-box' as const,
    flexShrink: 0,
    userSelect: 'none' as const,
    overflow: 'hidden',
    whiteSpace: 'nowrap' as const,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    overflow: 'hidden',
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    overflow: 'hidden',
  },
  item: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    cursor: 'default',
    opacity: 0.9,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    display: 'inline-block',
  },
};

export const StatusBar: React.FC = () => {
  const currentModel = useAppStore((s) => s.currentModel);
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const workspaceRoot = useRuntimeStore((s) => s.workspaceRoot);
  const connected = useRuntimeStore((s) => s.connected);
  const activeFilePath = useRuntimeStore((s) => s.activeFilePath);
  const openFiles = useRuntimeStore((s) => s.openFiles);

  // Derive language from active file
  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;
  const language = activeFile?.language || 'Plain Text';

  // Display-friendly language
  const langDisplay =
    language.charAt(0).toUpperCase() + language.slice(1).replace('react', 'React');

  // Workspace root display — show last two segments
  const rootDisplay =
    workspaceRoot && workspaceRoot !== '.'
      ? workspaceRoot.split('/').filter(Boolean).slice(-2).join('/')
      : currentWorkspace || 'No folder';

  return (
    <div style={styles.bar}>
      {/* Left: branch + workspace */}
      <div style={styles.left}>
        <span style={styles.item} title="Git branch">
          <span style={{ fontSize: 13 }}>&#9739;</span> main
        </span>
        <span style={styles.item} title={workspaceRoot || 'Workspace'}>
          {rootDisplay}
        </span>
      </div>

      {/* Center: cursor position */}
      <div style={styles.center}>
        <span style={styles.item}>Ln 1, Col 1</span>
      </div>

      {/* Right: language, encoding, eol, model, connection */}
      <div style={styles.right}>
        <span style={styles.item}>{langDisplay}</span>
        <span style={styles.item}>UTF-8</span>
        <span style={styles.item}>LF</span>
        <span style={styles.item} title="Active model">
          {currentModel}
        </span>
        <span style={styles.item} title={connected ? 'Connected' : 'Disconnected'}>
          <span
            style={{
              ...styles.dot,
              backgroundColor: connected ? '#a0f0d0' : '#ff8888',
            }}
          />
          {connected ? 'Connected' : 'Offline'}
        </span>
      </div>
    </div>
  );
};
