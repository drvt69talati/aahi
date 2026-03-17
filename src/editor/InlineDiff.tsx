import React, { useState } from 'react';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber?: number;
}

interface DiffHunk {
  id: string;
  header: string;
  lines: DiffLine[];
}

interface InlineDiffProps {
  hunks: DiffHunk[];
  filePath: string;
  onAcceptHunk: (hunkId: string) => void;
  onRejectHunk: (hunkId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

const styles = {
  container: {
    backgroundColor: '#1e1e1e',
    border: '1px solid #3e3e42',
    borderRadius: 6,
    overflow: 'hidden',
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    fontSize: 12,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
  },
  filePath: {
    fontSize: 12,
    color: '#cccccc',
    fontWeight: 600 as const,
  },
  toolbarActions: {
    display: 'flex',
    gap: 8,
  },
  acceptAllBtn: {
    padding: '4px 12px',
    backgroundColor: '#4ec9b0',
    color: '#1e1e1e',
    border: 'none',
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 600 as const,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  rejectAllBtn: {
    padding: '4px 12px',
    backgroundColor: 'transparent',
    color: '#f44747',
    border: '1px solid #f44747',
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 500 as const,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  hunk: {
    borderBottom: '1px solid #3e3e42',
  },
  hunkHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 12px',
    backgroundColor: '#2d2d2d',
    borderBottom: '1px solid #3e3e42',
  },
  hunkLabel: {
    fontSize: 11,
    color: '#858585',
    fontFamily: "'Menlo', monospace",
  },
  hunkActions: {
    display: 'flex',
    gap: 6,
  },
  hunkAcceptBtn: {
    padding: '2px 10px',
    backgroundColor: '#4ec9b022',
    color: '#4ec9b0',
    border: '1px solid #4ec9b0',
    borderRadius: 3,
    fontSize: 10,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  hunkRejectBtn: {
    padding: '2px 10px',
    backgroundColor: '#f4474722',
    color: '#f44747',
    border: '1px solid #f44747',
    borderRadius: 3,
    fontSize: 10,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  line: {
    display: 'flex',
    minHeight: 20,
    lineHeight: '20px',
  },
  lineNumber: {
    width: 45,
    minWidth: 45,
    textAlign: 'right' as const,
    padding: '0 8px 0 4px',
    color: '#858585',
    userSelect: 'none' as const,
    fontSize: 11,
  },
  lineContent: {
    flex: 1,
    padding: '0 8px',
    whiteSpace: 'pre' as const,
    overflowX: 'auto' as const,
  },
  addedLine: {
    backgroundColor: '#23432a',
    color: '#4ec9b0',
  },
  removedLine: {
    backgroundColor: '#3d2020',
    color: '#f44747',
  },
  unchangedLine: {
    backgroundColor: 'transparent',
    color: '#cccccc',
  },
  addedLineNumber: {
    backgroundColor: '#1e3a25',
  },
  removedLineNumber: {
    backgroundColor: '#3a1e1e',
  },
  resolvedOverlay: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px 12px',
    backgroundColor: '#2d2d2d',
    color: '#858585',
    fontSize: 12,
    fontStyle: 'italic' as const,
  },
};

const lineStyles: Record<DiffLine['type'], React.CSSProperties> = {
  added: styles.addedLine,
  removed: styles.removedLine,
  unchanged: styles.unchangedLine,
};

const lineNumberStyles: Record<string, React.CSSProperties> = {
  added: styles.addedLineNumber,
  removed: styles.removedLineNumber,
  unchanged: {},
};

const linePrefix: Record<DiffLine['type'], string> = {
  added: '+',
  removed: '-',
  unchanged: ' ',
};

export const InlineDiff: React.FC<InlineDiffProps> = ({
  hunks,
  filePath,
  onAcceptHunk,
  onRejectHunk,
  onAcceptAll,
  onRejectAll,
}) => {
  const [resolvedHunks, setResolvedHunks] = useState<Record<string, 'accepted' | 'rejected'>>({});

  const handleAcceptHunk = (id: string) => {
    setResolvedHunks((prev) => ({ ...prev, [id]: 'accepted' }));
    onAcceptHunk(id);
  };

  const handleRejectHunk = (id: string) => {
    setResolvedHunks((prev) => ({ ...prev, [id]: 'rejected' }));
    onRejectHunk(id);
  };

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <span style={styles.filePath}>{filePath}</span>
        <div style={styles.toolbarActions}>
          <button style={styles.acceptAllBtn} onClick={onAcceptAll}>
            Accept All
          </button>
          <button style={styles.rejectAllBtn} onClick={onRejectAll}>
            Reject All
          </button>
        </div>
      </div>

      {hunks.map((hunk) => (
        <div key={hunk.id} style={styles.hunk}>
          <div style={styles.hunkHeader}>
            <span style={styles.hunkLabel}>{hunk.header}</span>
            {!resolvedHunks[hunk.id] && (
              <div style={styles.hunkActions}>
                <button style={styles.hunkAcceptBtn} onClick={() => handleAcceptHunk(hunk.id)}>
                  Accept
                </button>
                <button style={styles.hunkRejectBtn} onClick={() => handleRejectHunk(hunk.id)}>
                  Reject
                </button>
              </div>
            )}
          </div>

          {resolvedHunks[hunk.id] ? (
            <div style={styles.resolvedOverlay}>
              Hunk {resolvedHunks[hunk.id] === 'accepted' ? 'accepted' : 'rejected'}
            </div>
          ) : (
            hunk.lines.map((line, idx) => (
              <div key={idx} style={{ ...styles.line, ...lineStyles[line.type] }}>
                <div style={{ ...styles.lineNumber, ...lineNumberStyles[line.type] }}>
                  {line.lineNumber ?? ''}
                </div>
                <div style={styles.lineContent}>
                  <span style={{ color: '#858585', marginRight: 4 }}>{linePrefix[line.type]}</span>
                  {line.content}
                </div>
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
};
