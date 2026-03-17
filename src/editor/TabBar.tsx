import React from 'react';
import { useRuntimeStore } from '../store/runtime-store';

/* ── Extension → short badge text ── */
const EXT_BADGE: Record<string, string> = {
  ts: 'TS',
  tsx: 'TX',
  js: 'JS',
  jsx: 'JX',
  py: 'PY',
  rs: 'RS',
  go: 'GO',
  json: '{}',
  md: 'MD',
  html: '<>',
  css: 'CS',
  yaml: 'YM',
  yml: 'YM',
  toml: 'TM',
  sql: 'SQ',
  sh: 'SH',
  java: 'JV',
  rb: 'RB',
  php: 'PH',
  c: 'C',
  cpp: 'C+',
  swift: 'SW',
};

function getExtBadge(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_BADGE[ext] ?? ext.toUpperCase().slice(0, 2) || '..';
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

/* ── Badge color by extension ── */
function getBadgeColor(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const colors: Record<string, string> = {
    ts: '#3178c6',
    tsx: '#3178c6',
    js: '#f7df1e',
    jsx: '#f7df1e',
    py: '#3776ab',
    rs: '#dea584',
    go: '#00add8',
    json: '#a0a0a0',
    md: '#858585',
    html: '#e34c26',
    css: '#264de4',
  };
  return colors[ext] ?? '#858585';
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    height: 35,
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
    overflowX: 'auto' as const,
    overflowY: 'hidden' as const,
    scrollbarWidth: 'none' as const,
    msOverflowStyle: 'none' as const,
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 12px',
    height: 35,
    fontSize: 12,
    cursor: 'pointer',
    borderRight: '1px solid #3e3e42',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    userSelect: 'none' as const,
    position: 'relative' as const,
  },
  tabActive: {
    backgroundColor: '#1e1e1e',
    color: '#cccccc',
    borderTop: '1px solid #007acc',
  },
  tabInactive: {
    backgroundColor: '#2d2d2d',
    color: '#858585',
    borderTop: '1px solid transparent',
  },
  badge: {
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 3px',
    borderRadius: 2,
    lineHeight: 1,
  },
  closeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    borderRadius: 3,
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: 11,
    lineHeight: 1,
    padding: 0,
  },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: '#cccccc',
    flexShrink: 0,
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    height: 35,
    padding: '0 16px',
    fontSize: 12,
    color: '#585858',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
  },
};

export const TabBar: React.FC = () => {
  const openFiles = useRuntimeStore((s) => s.openFiles);
  const activeFilePath = useRuntimeStore((s) => s.activeFilePath);
  const openFile = useRuntimeStore((s) => s.openFile);

  const filePaths = Array.from(openFiles.keys());

  if (filePaths.length === 0) {
    return <div style={styles.empty}>No files open</div>;
  }

  return (
    <div style={styles.container}>
      {filePaths.map((filePath) => {
        const file = openFiles.get(filePath);
        const isActive = filePath === activeFilePath;
        const isDirty = file?.dirty ?? false;
        const fileName = getFileName(filePath);
        const badge = getExtBadge(filePath);
        const badgeColor = getBadgeColor(filePath);

        return (
          <div
            key={filePath}
            style={{
              ...styles.tab,
              ...(isActive ? styles.tabActive : styles.tabInactive),
            }}
            onClick={() => openFile(filePath)}
            title={filePath}
          >
            <span
              style={{
                ...styles.badge,
                color: badgeColor,
                backgroundColor: `${badgeColor}22`,
              }}
            >
              {badge}
            </span>
            <span>{fileName}</span>
            {isDirty ? (
              <div style={styles.dirtyDot} title="Unsaved changes" />
            ) : (
              <button
                style={{
                  ...styles.closeBtn,
                  color: isActive ? '#858585' : '#585858',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  // Close file: remove from openFiles and switch active
                  const store = useRuntimeStore.getState();
                  const files = new Map(store.openFiles);
                  files.delete(filePath);
                  const remaining = Array.from(files.keys());
                  const nextActive =
                    isActive
                      ? remaining.length > 0
                        ? remaining[Math.min(filePaths.indexOf(filePath), remaining.length - 1)]
                        : null
                      : store.activeFilePath;
                  useRuntimeStore.setState({
                    openFiles: files,
                    activeFilePath: nextActive,
                  });
                }}
                title="Close"
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#3e3e42';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                }}
              >
                x
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
