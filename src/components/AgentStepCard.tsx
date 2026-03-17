import React, { useState, useEffect } from 'react';

type StepType = 'llm' | 'tool' | 'a2a' | 'parallel';
type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

interface AgentStepCardProps {
  name: string;
  type: StepType;
  status: StepStatus;
  duration?: number; // ms
  result?: string;
  error?: string;
}

const typeColors: Record<StepType, string> = {
  llm: '#569cd6',
  tool: '#4ec9b0',
  a2a: '#c586c0',
  parallel: '#dcdcaa',
};

const typeLabels: Record<StepType, string> = {
  llm: 'LLM',
  tool: 'Tool',
  a2a: 'A2A',
  parallel: 'Parallel',
};

const statusColors: Record<StepStatus, string> = {
  pending: '#858585',
  running: '#cca700',
  completed: '#4ec9b0',
  failed: '#f44747',
};

const statusIcons: Record<StepStatus, string> = {
  pending: '\u25CB',
  running: '',
  completed: '\u2713',
  failed: '\u2717',
};

const styles = {
  card: {
    backgroundColor: '#2d2d2d',
    border: '1px solid #3e3e42',
    borderRadius: 6,
    padding: 12,
    margin: '6px 0',
  },
  top: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  statusIndicator: {
    width: 16,
    height: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700 as const,
  },
  name: {
    flex: 1,
    fontSize: 13,
    fontWeight: 500 as const,
    color: '#cccccc',
  },
  typeBadge: {
    fontSize: 10,
    padding: '1px 7px',
    borderRadius: 3,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  duration: {
    fontSize: 10,
    color: '#858585',
  },
  spinner: {
    display: 'inline-block',
    width: 12,
    height: 12,
    border: '2px solid #cca70044',
    borderTopColor: '#cca700',
    borderRadius: '50%',
    animation: 'aahi-step-spin 0.8s linear infinite',
  },
  resultPreview: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#1e1e1e',
    borderRadius: 4,
    border: '1px solid #3e3e42',
    fontSize: 11,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    color: '#cccccc',
    maxHeight: 80,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    lineHeight: '1.5',
    cursor: 'pointer',
  },
  errorMessage: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#f4474711',
    borderRadius: 4,
    border: '1px solid #f4474744',
    fontSize: 11,
    color: '#f44747',
    lineHeight: '1.5',
  },
  expandToggle: {
    fontSize: 10,
    color: '#858585',
    cursor: 'pointer',
    marginTop: 4,
    textAlign: 'right' as const,
  },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const AgentStepCard: React.FC<AgentStepCardProps> = ({
  name,
  type,
  status,
  duration,
  result,
  error,
}) => {
  const [expanded, setExpanded] = useState(false);

  // Inject spin animation
  useEffect(() => {
    const styleId = 'aahi-step-spin-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes aahi-step-spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const resultText = result || '';
  const truncated = resultText.length > 120 && !expanded;

  return (
    <div
      style={{
        ...styles.card,
        borderLeftColor: statusColors[status],
        borderLeftWidth: 3,
      }}
    >
      <div style={styles.top}>
        <div style={styles.statusIndicator}>
          {status === 'running' ? (
            <div style={styles.spinner} />
          ) : (
            <span style={{ color: statusColors[status] }}>{statusIcons[status]}</span>
          )}
        </div>
        <span style={styles.name}>{name}</span>
        <span
          style={{
            ...styles.typeBadge,
            backgroundColor: typeColors[type] + '22',
            color: typeColors[type],
            border: `1px solid ${typeColors[type]}44`,
          }}
        >
          {typeLabels[type]}
        </span>
        {duration != null && (
          <span style={styles.duration}>{formatDuration(duration)}</span>
        )}
      </div>

      {status === 'failed' && error && <div style={styles.errorMessage}>{error}</div>}

      {status === 'completed' && result && (
        <>
          <div
            style={styles.resultPreview}
            onClick={() => setExpanded(!expanded)}
          >
            {truncated ? resultText.slice(0, 120) + '...' : resultText}
          </div>
          {resultText.length > 120 && (
            <div
              style={styles.expandToggle as React.CSSProperties}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Show less' : 'Show more'}
            </div>
          )}
        </>
      )}
    </div>
  );
};
