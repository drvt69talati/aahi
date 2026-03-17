import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRuntimeStore } from '../../store/runtime-store';

// ── Types ────────────────────────────────────────────────────────────────

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged' | 'modified';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
}

interface DiffHunk {
  id: string;
  startOld: number;
  startNew: number;
  lines: DiffLine[];
}

type ViewMode = 'side-by-side' | 'unified';

// ── LCS-based diff algorithm ─────────────────────────────────────────────

function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

function computeDiffLines(original: string, modified: string): DiffLine[] {
  const oldLines = original.split('\n');
  const newLines = modified.split('\n');
  const dp = computeLCS(oldLines, newLines);

  const result: DiffLine[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({
        type: 'unchanged',
        oldLineNumber: i,
        newLineNumber: j,
        content: oldLines[i - 1],
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({
        type: 'added',
        oldLineNumber: null,
        newLineNumber: j,
        content: newLines[j - 1],
      });
      j--;
    } else if (i > 0) {
      stack.push({
        type: 'removed',
        oldLineNumber: i,
        newLineNumber: null,
        content: oldLines[i - 1],
      });
      i--;
    }
  }

  // Reverse since we built it backwards
  for (let k = stack.length - 1; k >= 0; k--) {
    result.push(stack[k]);
  }

  // Post-process: detect modified lines (adjacent removed + added)
  for (let k = 0; k < result.length - 1; k++) {
    if (result[k].type === 'removed' && result[k + 1].type === 'added') {
      result[k].type = 'modified';
      result[k + 1].type = 'modified';
    }
  }

  return result;
}

function groupIntoHunks(lines: DiffLine[], contextLines: number = 3): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffLine[] = [];
  let hunkId = 0;
  let unchangedStreak = 0;
  let startOld = 1;
  let startNew = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.type === 'unchanged') {
      unchangedStreak++;
      if (unchangedStreak > contextLines * 2 && currentHunk.length > 0) {
        // Close current hunk with trailing context
        const trailing = currentHunk.slice(-contextLines);
        const leading = currentHunk.slice(0, currentHunk.length - unchangedStreak + contextLines);
        if (leading.some((l) => l.type !== 'unchanged')) {
          hunks.push({
            id: `hunk-${hunkId++}`,
            startOld,
            startNew,
            lines: [...leading, ...trailing.slice(0, 0)],
          });
        }
        currentHunk = [];
        unchangedStreak = 0;
        startOld = line.oldLineNumber ?? startOld;
        startNew = line.newLineNumber ?? startNew;
      }
      currentHunk.push(line);
    } else {
      unchangedStreak = 0;
      currentHunk.push(line);
    }
  }

  if (currentHunk.length > 0 && currentHunk.some((l) => l.type !== 'unchanged')) {
    hunks.push({
      id: `hunk-${hunkId++}`,
      startOld,
      startNew,
      lines: currentHunk,
    });
  }

  // If no hunks (no changes), return empty
  if (hunks.length === 0 && lines.some((l) => l.type !== 'unchanged')) {
    hunks.push({
      id: 'hunk-0',
      startOld: 1,
      startNew: 1,
      lines,
    });
  }

  return hunks;
}

function generateUnifiedDiffText(original: string, modified: string, filePath: string): string {
  const diffLines = computeDiffLines(original, modified);
  const output: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  for (const line of diffLines) {
    if (line.type === 'added') {
      output.push(`+${line.content}`);
    } else if (line.type === 'removed') {
      output.push(`-${line.content}`);
    } else if (line.type === 'modified') {
      if (line.oldLineNumber !== null) output.push(`-${line.content}`);
      else output.push(`+${line.content}`);
    } else {
      output.push(` ${line.content}`);
    }
  }

  return output.join('\n');
}

// ── Styles ───────────────────────────────────────────────────────────────

const s = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
    color: '#cccccc',
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    fontSize: 12,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
    flexShrink: 0,
  },
  select: {
    backgroundColor: '#3c3c3c',
    color: '#cccccc',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    padding: '4px 8px',
    fontSize: 12,
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
    minWidth: 180,
  },
  viewToggle: {
    display: 'flex',
    borderRadius: 3,
    overflow: 'hidden' as const,
    border: '1px solid #3e3e42',
  },
  viewBtn: {
    padding: '4px 10px',
    fontSize: 11,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    backgroundColor: '#3c3c3c',
    color: '#858585',
  },
  viewBtnActive: {
    backgroundColor: '#007acc',
    color: '#ffffff',
  },
  actionBtn: {
    padding: '4px 10px',
    fontSize: 11,
    border: '1px solid #3e3e42',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backgroundColor: 'transparent',
    color: '#cccccc',
  },
  acceptAllBtn: {
    padding: '4px 10px',
    fontSize: 11,
    border: 'none',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backgroundColor: '#4ec9b0',
    color: '#1e1e1e',
    fontWeight: 600 as const,
  },
  revertBtn: {
    padding: '4px 10px',
    fontSize: 11,
    border: '1px solid #f44747',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    backgroundColor: 'transparent',
    color: '#f44747',
  },
  spacer: { flex: 1 },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#007acc',
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 600 as const,
    padding: '0 5px',
    marginLeft: 6,
  },
  diffBody: {
    flex: 1,
    overflow: 'auto',
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
  },
  hunkActions: {
    display: 'flex',
    gap: 6,
  },
  hunkAcceptBtn: {
    padding: '2px 8px',
    backgroundColor: 'transparent',
    color: '#4ec9b0',
    border: '1px solid #4ec9b0',
    borderRadius: 3,
    fontSize: 10,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  hunkRejectBtn: {
    padding: '2px 8px',
    backgroundColor: 'transparent',
    color: '#f44747',
    border: '1px solid #f44747',
    borderRadius: 3,
    fontSize: 10,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  // Unified view
  uLine: {
    display: 'flex',
    minHeight: 20,
    lineHeight: '20px',
  },
  uLineNum: {
    width: 40,
    minWidth: 40,
    textAlign: 'right' as const,
    padding: '0 6px',
    color: '#858585',
    userSelect: 'none' as const,
    fontSize: 11,
  },
  uLineContent: {
    flex: 1,
    padding: '0 8px',
    whiteSpace: 'pre' as const,
    overflowX: 'auto' as const,
  },
  // Side-by-side
  sbsContainer: {
    display: 'flex',
    width: '100%',
    minHeight: '100%',
  },
  sbsSide: {
    flex: 1,
    overflow: 'hidden' as const,
    minWidth: 0,
  },
  sbsLine: {
    display: 'flex',
    minHeight: 20,
    lineHeight: '20px',
  },
  sbsLineNum: {
    width: 45,
    minWidth: 45,
    textAlign: 'right' as const,
    padding: '0 6px 0 4px',
    color: '#858585',
    userSelect: 'none' as const,
    fontSize: 11,
  },
  sbsLineContent: {
    flex: 1,
    padding: '0 8px',
    whiteSpace: 'pre' as const,
    overflowX: 'auto' as const,
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#858585',
    fontSize: 13,
  },
  divider: {
    width: 1,
    backgroundColor: '#3e3e42',
    flexShrink: 0,
  },
};

const lineColors: Record<string, React.CSSProperties> = {
  added: { backgroundColor: '#2ea04333' },
  removed: { backgroundColor: '#f4474733' },
  modified: { borderLeft: '3px solid #dcdcaa' },
  unchanged: {},
};

// ── Component ────────────────────────────────────────────────────────────

export const DiffPanel: React.FC = () => {
  const openFiles = useRuntimeStore((st) => st.openFiles);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [resolvedHunks, setResolvedHunks] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const [originals, setOriginals] = useState<Map<string, string>>(new Map());

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  // Get dirty files
  const dirtyFiles = useMemo(() => {
    const result: Array<{ path: string; changeCount: number }> = [];
    openFiles.forEach((file) => {
      if (file.dirty) {
        const orig = originals.get(file.path) ?? '';
        const diffLines = computeDiffLines(orig, file.content);
        const changes = diffLines.filter((l) => l.type !== 'unchanged').length;
        result.push({ path: file.path, changeCount: changes });
      }
    });
    return result;
  }, [openFiles, originals]);

  // Track originals: when a file is first opened (not dirty), store its content
  useEffect(() => {
    openFiles.forEach((file) => {
      if (!originals.has(file.path) && !file.dirty) {
        setOriginals((prev) => {
          const next = new Map(prev);
          next.set(file.path, file.content);
          return next;
        });
      }
    });
  }, [openFiles, originals]);

  // Auto-select first dirty file
  useEffect(() => {
    if (!selectedFile && dirtyFiles.length > 0) {
      setSelectedFile(dirtyFiles[0].path);
    }
  }, [dirtyFiles, selectedFile]);

  // Compute diff for selected file
  const { diffLines, hunks } = useMemo(() => {
    if (!selectedFile) return { diffLines: [], hunks: [] };
    const file = openFiles.get(selectedFile);
    if (!file) return { diffLines: [], hunks: [] };
    const orig = originals.get(selectedFile) ?? '';
    const lines = computeDiffLines(orig, file.content);
    return { diffLines: lines, hunks: groupIntoHunks(lines) };
  }, [selectedFile, openFiles, originals]);

  // Synchronized scrolling
  const handleScroll = useCallback((source: 'left' | 'right') => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const from = source === 'left' ? leftRef.current : rightRef.current;
    const to = source === 'left' ? rightRef.current : leftRef.current;
    if (from && to) {
      to.scrollTop = from.scrollTop;
    }
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }, []);

  // Actions
  const handleAcceptAll = useCallback(() => {
    if (!selectedFile) return;
    // Mark file as not dirty (accept all changes as the new baseline)
    const store = useRuntimeStore.getState();
    const file = store.openFiles.get(selectedFile);
    if (file) {
      setOriginals((prev) => {
        const next = new Map(prev);
        next.set(selectedFile, file.content);
        return next;
      });
    }
  }, [selectedFile]);

  const handleRevert = useCallback(() => {
    if (!selectedFile) return;
    const orig = originals.get(selectedFile);
    if (orig === undefined) return;
    const store = useRuntimeStore.getState();
    const file = store.openFiles.get(selectedFile);
    if (file) {
      store.openFiles.set(selectedFile, { ...file, content: orig, dirty: false });
      useRuntimeStore.setState({ openFiles: new Map(store.openFiles) });
    }
  }, [selectedFile, originals]);

  const handleCopyDiff = useCallback(() => {
    if (!selectedFile) return;
    const file = openFiles.get(selectedFile);
    if (!file) return;
    const orig = originals.get(selectedFile) ?? '';
    const text = generateUnifiedDiffText(orig, file.content, selectedFile);
    navigator.clipboard.writeText(text).catch(() => {});
  }, [selectedFile, openFiles, originals]);

  const handleAcceptHunk = useCallback((hunkId: string) => {
    setResolvedHunks((prev) => ({ ...prev, [hunkId]: 'accepted' }));
  }, []);

  const handleRejectHunk = useCallback((hunkId: string) => {
    setResolvedHunks((prev) => ({ ...prev, [hunkId]: 'rejected' }));
  }, []);

  // Build side-by-side lines
  const { leftLines, rightLines } = useMemo(() => {
    const left: Array<{ lineNum: number | null; content: string; type: DiffLine['type'] }> = [];
    const right: Array<{ lineNum: number | null; content: string; type: DiffLine['type'] }> = [];

    for (const line of diffLines) {
      if (line.type === 'unchanged') {
        left.push({ lineNum: line.oldLineNumber, content: line.content, type: 'unchanged' });
        right.push({ lineNum: line.newLineNumber, content: line.content, type: 'unchanged' });
      } else if (line.type === 'removed') {
        left.push({ lineNum: line.oldLineNumber, content: line.content, type: 'removed' });
        right.push({ lineNum: null, content: '', type: 'unchanged' });
      } else if (line.type === 'added') {
        left.push({ lineNum: null, content: '', type: 'unchanged' });
        right.push({ lineNum: line.newLineNumber, content: line.content, type: 'added' });
      } else if (line.type === 'modified') {
        if (line.oldLineNumber !== null) {
          left.push({ lineNum: line.oldLineNumber, content: line.content, type: 'modified' });
          right.push({ lineNum: null, content: '', type: 'unchanged' });
        } else {
          left.push({ lineNum: null, content: '', type: 'unchanged' });
          right.push({ lineNum: line.newLineNumber, content: line.content, type: 'modified' });
        }
      }
    }

    return { leftLines: left, rightLines: right };
  }, [diffLines]);

  if (dirtyFiles.length === 0 && !selectedFile) {
    return (
      <div style={s.container}>
        <div style={s.emptyState}>No modified files to diff</div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        {/* File selector */}
        <select
          style={s.select}
          value={selectedFile ?? ''}
          onChange={(e) => {
            setSelectedFile(e.target.value || null);
            setResolvedHunks({});
          }}
        >
          <option value="">Select file...</option>
          {dirtyFiles.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path.split('/').pop()} ({f.changeCount} changes)
            </option>
          ))}
        </select>

        {/* View mode toggle */}
        <div style={s.viewToggle}>
          <button
            style={{
              ...s.viewBtn,
              ...(viewMode === 'side-by-side' ? s.viewBtnActive : {}),
            }}
            onClick={() => setViewMode('side-by-side')}
          >
            Side-by-Side
          </button>
          <button
            style={{
              ...s.viewBtn,
              ...(viewMode === 'unified' ? s.viewBtnActive : {}),
            }}
            onClick={() => setViewMode('unified')}
          >
            Unified
          </button>
        </div>

        <div style={s.spacer} />

        {/* Actions */}
        <button style={s.actionBtn} onClick={handleCopyDiff} title="Copy unified diff to clipboard">
          Copy Diff
        </button>
        <button style={s.acceptAllBtn} onClick={handleAcceptAll}>
          Accept All Changes
        </button>
        <button style={s.revertBtn} onClick={handleRevert}>
          Revert File
        </button>
      </div>

      {/* Diff body */}
      <div style={s.diffBody}>
        {!selectedFile ? (
          <div style={s.emptyState}>Select a file to view its diff</div>
        ) : diffLines.length === 0 ? (
          <div style={s.emptyState}>No changes detected</div>
        ) : viewMode === 'unified' ? (
          /* Unified view */
          <div>
            {hunks.map((hunk) => (
              <div key={hunk.id} style={s.hunk}>
                <div style={s.hunkHeader}>
                  <span style={s.hunkLabel}>
                    @@ -{hunk.startOld} +{hunk.startNew} @@
                  </span>
                  {!resolvedHunks[hunk.id] && (
                    <div style={s.hunkActions}>
                      <button
                        style={s.hunkAcceptBtn}
                        onClick={() => handleAcceptHunk(hunk.id)}
                      >
                        Accept
                      </button>
                      <button
                        style={s.hunkRejectBtn}
                        onClick={() => handleRejectHunk(hunk.id)}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
                {resolvedHunks[hunk.id] ? (
                  <div
                    style={{
                      padding: '8px 12px',
                      color: '#858585',
                      fontStyle: 'italic',
                      backgroundColor: '#2d2d2d',
                    }}
                  >
                    Hunk {resolvedHunks[hunk.id]}
                  </div>
                ) : (
                  hunk.lines.map((line, idx) => {
                    const prefix =
                      line.type === 'added'
                        ? '+'
                        : line.type === 'removed'
                          ? '-'
                          : line.type === 'modified'
                            ? line.oldLineNumber !== null
                              ? '-'
                              : '+'
                            : ' ';
                    const bgColor = lineColors[line.type] ?? {};
                    return (
                      <div key={idx} style={{ ...s.uLine, ...bgColor }}>
                        <div style={s.uLineNum}>
                          {line.oldLineNumber ?? ''}
                        </div>
                        <div style={s.uLineNum}>
                          {line.newLineNumber ?? ''}
                        </div>
                        <div style={s.uLineContent}>
                          <span style={{ color: '#858585', marginRight: 4 }}>{prefix}</span>
                          {line.content}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </div>
        ) : (
          /* Side-by-side view */
          <div style={s.sbsContainer}>
            <div
              ref={leftRef}
              style={{ ...s.sbsSide, overflowY: 'auto' as const }}
              onScroll={() => handleScroll('left')}
            >
              {leftLines.map((line, idx) => (
                <div
                  key={idx}
                  style={{
                    ...s.sbsLine,
                    ...(line.type !== 'unchanged' ? lineColors[line.type] ?? {} : {}),
                  }}
                >
                  <div style={s.sbsLineNum}>{line.lineNum ?? ''}</div>
                  <div style={s.sbsLineContent}>{line.content}</div>
                </div>
              ))}
            </div>
            <div style={s.divider} />
            <div
              ref={rightRef}
              style={{ ...s.sbsSide, overflowY: 'auto' as const }}
              onScroll={() => handleScroll('right')}
            >
              {rightLines.map((line, idx) => (
                <div
                  key={idx}
                  style={{
                    ...s.sbsLine,
                    ...(line.type !== 'unchanged' ? lineColors[line.type] ?? {} : {}),
                  }}
                >
                  <div style={s.sbsLineNum}>{line.lineNum ?? ''}</div>
                  <div style={s.sbsLineContent}>{line.content}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
