import React, { useState, useEffect, useCallback } from 'react';
import { isTauri } from '../../bridge/tauri-bridge';

interface ChangedFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'U';
  staged: boolean;
}

interface CommitEntry {
  hash: string;
  message: string;
}

const statusColors: Record<string, string> = {
  M: '#cca700',
  A: '#4ec9b0',
  D: '#f44747',
  U: '#858585',
};

const statusLabels: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  U: 'Untracked',
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#252526',
    color: '#cccccc',
    fontSize: 13,
    overflow: 'hidden',
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
    flex: 1,
    overflowY: 'auto' as const,
    padding: 0,
  },
  branchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 12px',
    borderBottom: '1px solid #3e3e42',
    fontSize: 12,
  },
  branchIcon: {
    color: '#4ec9b0',
    fontSize: 14,
  },
  branchName: {
    color: '#cccccc',
    fontWeight: 500,
  },
  section: {
    padding: '6px 0',
    borderBottom: '1px solid #3e3e42',
  },
  sectionLabel: {
    padding: '4px 12px',
    fontSize: 11,
    color: '#858585',
    fontWeight: 600,
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 12px',
    cursor: 'pointer',
    fontSize: 12,
  },
  checkbox: {
    accentColor: '#007acc',
    cursor: 'pointer',
  },
  statusBadge: {
    fontSize: 10,
    fontWeight: 700,
    width: 16,
    textAlign: 'center' as const,
    borderRadius: 2,
    padding: '0 2px',
    flexShrink: 0,
  },
  fileName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    color: '#cccccc',
  },
  commitArea: {
    padding: '8px 12px',
    borderBottom: '1px solid #3e3e42',
  },
  textarea: {
    width: '100%',
    minHeight: 60,
    backgroundColor: '#1e1e1e',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    color: '#cccccc',
    fontSize: 12,
    fontFamily: 'inherit',
    padding: 8,
    resize: 'vertical' as const,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  buttonRow: {
    display: 'flex',
    gap: 6,
    marginTop: 6,
  },
  btn: {
    flex: 1,
    padding: '5px 8px',
    fontSize: 11,
    fontWeight: 500,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  commitBtn: {
    backgroundColor: '#007acc',
    color: '#ffffff',
  },
  secondaryBtn: {
    backgroundColor: '#3e3e42',
    color: '#cccccc',
  },
  commitList: {
    padding: '4px 0',
  },
  commitRow: {
    display: 'flex',
    gap: 8,
    padding: '3px 12px',
    fontSize: 11,
  },
  commitHash: {
    color: '#4ec9b0',
    fontFamily: "'Menlo', 'Monaco', monospace",
    flexShrink: 0,
  },
  commitMsg: {
    color: '#cccccc',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  browserMsg: {
    padding: 24,
    textAlign: 'center' as const,
    color: '#858585',
    fontSize: 13,
    lineHeight: 1.6,
  },
};

async function runGitCommand(args: string[]): Promise<string> {
  const result = await window.__TAURI__!.core.invoke('plugin:shell|execute', {
    program: 'git',
    args,
  });
  return typeof result === 'string' ? result : JSON.stringify(result);
}

function parseStatus(raw: string): ChangedFile[] {
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const x = line[0]; // index status
      const y = line[1]; // worktree status
      const filePath = line.substring(3).trim();
      let status: ChangedFile['status'] = 'U';
      const staged = x !== ' ' && x !== '?';
      if (x === '?' || y === '?') status = 'U';
      else if (x === 'A' || y === 'A') status = 'A';
      else if (x === 'D' || y === 'D') status = 'D';
      else if (x === 'M' || y === 'M') status = 'M';
      return { path: filePath, status, staged };
    });
}

function parseLog(raw: string): CommitEntry[] {
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const spaceIdx = line.indexOf(' ');
      return {
        hash: line.substring(0, spaceIdx),
        message: line.substring(spaceIdx + 1),
      };
    });
}

export const GitPanel: React.FC = () => {
  const [branch, setBranch] = useState('');
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    setLoading(true);
    try {
      const [branchRaw, statusRaw, logRaw] = await Promise.all([
        runGitCommand(['branch', '--show-current']),
        runGitCommand(['status', '--porcelain']),
        runGitCommand(['log', '--oneline', '-10']),
      ]);
      setBranch(branchRaw.trim());
      setFiles(parseStatus(statusRaw));
      setCommits(parseLog(logRaw));
    } catch (err) {
      console.error('[GitPanel] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleStage = useCallback(
    async (file: ChangedFile) => {
      if (!isTauri()) return;
      try {
        if (file.staged) {
          await runGitCommand(['restore', '--staged', file.path]);
        } else {
          await runGitCommand(['add', file.path]);
        }
        await refresh();
      } catch (err) {
        console.error('[GitPanel] stage error:', err);
      }
    },
    [refresh],
  );

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim() || !isTauri()) return;
    try {
      await runGitCommand(['commit', '-m', commitMsg.trim()]);
      setCommitMsg('');
      await refresh();
    } catch (err) {
      console.error('[GitPanel] commit error:', err);
    }
  }, [commitMsg, refresh]);

  const handlePull = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await runGitCommand(['pull']);
      await refresh();
    } catch (err) {
      console.error('[GitPanel] pull error:', err);
    }
  }, [refresh]);

  const handlePush = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await runGitCommand(['push']);
      await refresh();
    } catch (err) {
      console.error('[GitPanel] push error:', err);
    }
  }, [refresh]);

  if (!isTauri()) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>Source Control</div>
        <div style={styles.browserMsg}>
          Git integration requires Tauri desktop mode.
          <br />
          Start the app with <code>cargo tauri dev</code> to enable.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>Source Control</div>
      <div style={styles.content}>
        {/* Branch */}
        <div style={styles.branchRow}>
          <span style={styles.branchIcon}>{'\u2387'}</span>
          <span style={styles.branchName}>{branch || '...'}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button
              style={{ ...styles.btn, ...styles.secondaryBtn, flex: 'none', padding: '2px 8px' }}
              onClick={handlePull}
              title="Pull"
            >
              Pull
            </button>
            <button
              style={{ ...styles.btn, ...styles.secondaryBtn, flex: 'none', padding: '2px 8px' }}
              onClick={handlePush}
              title="Push"
            >
              Push
            </button>
            <button
              style={{ ...styles.btn, ...styles.secondaryBtn, flex: 'none', padding: '2px 8px' }}
              onClick={refresh}
              title="Refresh"
            >
              {loading ? '...' : '\u21BB'}
            </button>
          </div>
        </div>

        {/* Commit input */}
        <div style={styles.commitArea}>
          <textarea
            style={styles.textarea}
            placeholder="Commit message..."
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
          />
          <div style={styles.buttonRow}>
            <button
              style={{ ...styles.btn, ...styles.commitBtn }}
              onClick={handleCommit}
              disabled={!commitMsg.trim()}
            >
              Commit
            </button>
          </div>
        </div>

        {/* Changed files */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>
            Changes ({files.length})
          </div>
          {files.length === 0 && (
            <div style={{ padding: '8px 12px', color: '#858585', fontSize: 12 }}>
              No changes detected
            </div>
          )}
          {files.map((file) => (
            <div
              key={file.path}
              style={{
                ...styles.fileRow,
                backgroundColor: file.staged ? '#007acc15' : 'transparent',
              }}
              onClick={() => toggleStage(file)}
            >
              <input
                type="checkbox"
                checked={file.staged}
                onChange={() => toggleStage(file)}
                style={styles.checkbox}
              />
              <span
                style={{
                  ...styles.statusBadge,
                  color: statusColors[file.status],
                }}
                title={statusLabels[file.status]}
              >
                {file.status}
              </span>
              <span style={styles.fileName}>{file.path}</span>
            </div>
          ))}
        </div>

        {/* Recent commits */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Recent Commits</div>
          <div style={styles.commitList}>
            {commits.map((c) => (
              <div key={c.hash} style={styles.commitRow}>
                <span style={styles.commitHash}>{c.hash}</span>
                <span style={styles.commitMsg}>{c.message}</span>
              </div>
            ))}
            {commits.length === 0 && (
              <div style={{ padding: '8px 12px', color: '#858585', fontSize: 12 }}>
                No commits found
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
