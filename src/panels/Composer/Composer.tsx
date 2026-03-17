import React, { useState } from 'react';

type FileOperation = 'create' | 'modify' | 'delete';
type FileStatus = 'pending' | 'in-progress' | 'done' | 'error';

interface ComposerFile {
  id: string;
  path: string;
  operation: FileOperation;
  status: FileStatus;
  diff?: string;
}

interface IntegrationStep {
  id: string;
  name: string;
  integration: string;
  status: FileStatus;
}

interface ComposerProps {
  intent: string;
  files: ComposerFile[];
  integrationSteps: IntegrationStep[];
  progress: number; // 0-100
  onAcceptAll: () => void;
  onRollback: () => void;
  onClose: () => void;
  onAcceptFile: (fileId: string) => void;
  onRejectFile: (fileId: string) => void;
}

const operationIcons: Record<FileOperation, string> = {
  create: '+',
  modify: '~',
  delete: '-',
};

const operationColors: Record<FileOperation, string> = {
  create: '#4ec9b0',
  modify: '#cca700',
  delete: '#f44747',
};

const statusColors: Record<FileStatus, string> = {
  pending: '#858585',
  'in-progress': '#007acc',
  done: '#4ec9b0',
  error: '#f44747',
};

const statusLabels: Record<FileStatus, string> = {
  pending: 'Pending',
  'in-progress': 'In Progress',
  done: 'Done',
  error: 'Error',
};

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1e1e1eee',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
  },
  intentText: {
    fontSize: 14,
    fontWeight: 600 as const,
    color: '#cccccc',
    flex: 1,
  },
  progressContainer: {
    flex: 1,
    maxWidth: 300,
    margin: '0 16px',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#3e3e42',
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007acc',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  },
  progressLabel: {
    fontSize: 10,
    color: '#858585',
    marginTop: 2,
    textAlign: 'right' as const,
  },
  topActions: {
    display: 'flex',
    gap: 8,
  },
  acceptAllBtn: {
    padding: '6px 16px',
    backgroundColor: '#4ec9b0',
    color: '#1e1e1e',
    border: 'none',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600 as const,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  rollbackBtn: {
    padding: '6px 16px',
    backgroundColor: 'transparent',
    color: '#f44747',
    border: '1px solid #f44747',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500 as const,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  closeBtn: {
    padding: '6px 12px',
    backgroundColor: 'transparent',
    color: '#858585',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden' as const,
  },
  fileTree: {
    width: 280,
    minWidth: 220,
    backgroundColor: '#252526',
    borderRight: '1px solid #3e3e42',
    overflowY: 'auto' as const,
    padding: '8px 0',
  },
  fileTreeHeader: {
    padding: '6px 12px',
    fontSize: 11,
    fontWeight: 600 as const,
    color: '#858585',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 12px',
    fontSize: 12,
    cursor: 'pointer',
    gap: 8,
    borderLeft: '2px solid transparent',
  },
  fileItemSelected: {
    backgroundColor: '#2d2d2d',
    borderLeftColor: '#007acc',
  },
  fileIcon: {
    width: 16,
    textAlign: 'center' as const,
    fontWeight: 700 as const,
    fontSize: 13,
  },
  fileName: {
    flex: 1,
    color: '#cccccc',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  fileStatus: {
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 3,
  },
  integrationItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 12px',
    fontSize: 12,
    gap: 8,
    color: '#858585',
  },
  diffPane: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 16,
  },
  diffHeader: {
    fontSize: 13,
    fontWeight: 600 as const,
    color: '#cccccc',
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  diffContent: {
    backgroundColor: '#1e1e1e',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    padding: 12,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    fontSize: 12,
    color: '#cccccc',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap' as const,
    overflowX: 'auto' as const,
  },
  diffActions: {
    display: 'flex',
    gap: 8,
  },
  diffAcceptBtn: {
    padding: '4px 10px',
    backgroundColor: '#4ec9b022',
    color: '#4ec9b0',
    border: '1px solid #4ec9b0',
    borderRadius: 3,
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  diffRejectBtn: {
    padding: '4px 10px',
    backgroundColor: '#f4474722',
    color: '#f44747',
    border: '1px solid #f44747',
    borderRadius: 3,
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  emptyDiff: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: '#858585',
    fontSize: 13,
  },
};

export const Composer: React.FC<ComposerProps> = ({
  intent,
  files,
  integrationSteps,
  progress,
  onAcceptAll,
  onRollback,
  onClose,
  onAcceptFile,
  onRejectFile,
}) => {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(
    files.length > 0 ? files[0].id : null
  );

  const selectedFile = files.find((f) => f.id === selectedFileId);

  return (
    <div style={styles.overlay}>
      {/* Top Bar */}
      <div style={styles.topBar}>
        <div style={styles.intentText}>{intent}</div>
        <div style={styles.progressContainer}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${progress}%` }} />
          </div>
          <div style={styles.progressLabel as React.CSSProperties}>{progress}% complete</div>
        </div>
        <div style={styles.topActions}>
          <button style={styles.acceptAllBtn} onClick={onAcceptAll}>
            Accept All
          </button>
          <button style={styles.rollbackBtn} onClick={onRollback}>
            Rollback
          </button>
          <button style={styles.closeBtn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* File Tree */}
        <div style={styles.fileTree}>
          <div style={styles.fileTreeHeader}>Planned Operations</div>
          {files.map((file) => (
            <div
              key={file.id}
              style={{
                ...styles.fileItem,
                ...(selectedFileId === file.id ? styles.fileItemSelected : {}),
              }}
              onClick={() => setSelectedFileId(file.id)}
            >
              <span
                style={{
                  ...styles.fileIcon,
                  color: operationColors[file.operation],
                }}
              >
                {operationIcons[file.operation]}
              </span>
              <span style={styles.fileName}>{file.path}</span>
              <span
                style={{
                  ...styles.fileStatus,
                  backgroundColor: statusColors[file.status] + '22',
                  color: statusColors[file.status],
                }}
              >
                {statusLabels[file.status]}
              </span>
            </div>
          ))}

          {integrationSteps.length > 0 && (
            <>
              <div style={{ ...styles.fileTreeHeader, marginTop: 12 }}>Integration Steps</div>
              {integrationSteps.map((step) => (
                <div key={step.id} style={styles.integrationItem}>
                  <span style={{ color: '#569cd6', fontSize: 11 }}>&#9881;</span>
                  <span style={{ flex: 1, color: '#cccccc' }}>{step.name}</span>
                  <span
                    style={{
                      ...styles.fileStatus,
                      backgroundColor: statusColors[step.status] + '22',
                      color: statusColors[step.status],
                    }}
                  >
                    {statusLabels[step.status]}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Diff Pane */}
        {selectedFile ? (
          <div style={styles.diffPane}>
            <div style={styles.diffHeader}>
              <span>
                <span style={{ color: operationColors[selectedFile.operation], marginRight: 8 }}>
                  {operationIcons[selectedFile.operation]}
                </span>
                {selectedFile.path}
              </span>
              <div style={styles.diffActions}>
                <button
                  style={styles.diffAcceptBtn}
                  onClick={() => onAcceptFile(selectedFile.id)}
                >
                  Accept
                </button>
                <button
                  style={styles.diffRejectBtn}
                  onClick={() => onRejectFile(selectedFile.id)}
                >
                  Reject
                </button>
              </div>
            </div>
            <div style={styles.diffContent}>
              {selectedFile.diff || 'No diff available for this file.'}
            </div>
          </div>
        ) : (
          <div style={styles.emptyDiff}>Select a file to view its diff</div>
        )}
      </div>
    </div>
  );
};
