// ─────────────────────────────────────────────────────────────────────────────
// Aahi — AgentStepCard: Full-featured step execution card with expandable
// input/output sections, animated status indicators, and copy-to-clipboard.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────

export type StepType = 'llm' | 'tool' | 'a2a' | 'parallel' | 'conditional';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'waiting-approval';

export interface AgentStepCardProps {
  id: string;
  name: string;
  type: StepType;
  status: StepStatus;
  duration?: number; // ms
  result?: unknown;
  error?: string;
  input?: unknown;
  /** For LLM steps */
  model?: string;
  tokenCount?: number;
  latencyMs?: number;
  /** Position in plan (0-1) */
  progressPct?: number;
  /** Total steps in plan */
  totalSteps?: number;
  /** Current step index (0-based) */
  stepIndex?: number;
}

// ── Theme constants ──────────────────────────────────────────────────────

const COLORS = {
  bg: '#1e1e1e',
  panel: '#2d2d2d',
  sidebar: '#252526',
  text: '#cccccc',
  secondary: '#858585',
  accent: '#007acc',
  teal: '#4ec9b0',
  border: '#3e3e42',
  error: '#f44747',
  warning: '#cca700',
  success: '#4ec9b0',
};

const TYPE_COLORS: Record<StepType, string> = {
  llm: '#569cd6',
  tool: '#4ec9b0',
  a2a: '#c586c0',
  parallel: '#dcdcaa',
  conditional: '#ce9178',
};

const TYPE_LABELS: Record<StepType, string> = {
  llm: 'LLM',
  tool: 'Tool',
  a2a: 'A2A',
  parallel: 'Parallel',
  conditional: 'Conditional',
};

const STATUS_COLORS: Record<StepStatus, string> = {
  pending: COLORS.secondary,
  running: COLORS.accent,
  completed: COLORS.success,
  failed: COLORS.error,
  'waiting-approval': COLORS.warning,
};

const STATUS_LABELS: Record<StepStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  'waiting-approval': 'Awaiting user approval',
};

const STATUS_ICONS: Record<StepStatus, string> = {
  pending: '\u25CB',
  running: '',
  completed: '\u2713',
  failed: '\u2717',
  'waiting-approval': '\u23F0',
};

// ── Styles ───────────────────────────────────────────────────────────────

const styles = {
  card: {
    backgroundColor: COLORS.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    margin: '6px 0',
    overflow: 'hidden',
    transition: 'border-color 0.15s',
  } as React.CSSProperties,
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    cursor: 'pointer',
  } as React.CSSProperties,
  statusIndicator: {
    width: 18,
    height: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  } as React.CSSProperties,
  pulsingDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    backgroundColor: COLORS.accent,
    animation: 'aahi-step-pulse 1.2s ease-in-out infinite',
  } as React.CSSProperties,
  spinner: {
    display: 'inline-block',
    width: 12,
    height: 12,
    border: `2px solid ${COLORS.accent}44`,
    borderTopColor: COLORS.accent,
    borderRadius: '50%',
    animation: 'aahi-step-spin 0.8s linear infinite',
  } as React.CSSProperties,
  clockIcon: {
    fontSize: 14,
    color: COLORS.warning,
  } as React.CSSProperties,
  name: {
    flex: 1,
    fontSize: 13,
    fontWeight: 500,
    color: COLORS.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  typeBadge: {
    fontSize: 9,
    padding: '2px 7px',
    borderRadius: 3,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    flexShrink: 0,
  } as React.CSSProperties,
  statusText: {
    fontSize: 10,
    fontWeight: 500,
    flexShrink: 0,
  } as React.CSSProperties,
  duration: {
    fontSize: 10,
    color: COLORS.secondary,
    flexShrink: 0,
  } as React.CSSProperties,
  copyBtn: {
    padding: '2px 6px',
    backgroundColor: 'transparent',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 3,
    color: COLORS.secondary,
    fontSize: 10,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'color 0.15s, border-color 0.15s',
  } as React.CSSProperties,
  expandableSection: {
    borderTop: `1px solid ${COLORS.border}`,
  } as React.CSSProperties,
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 600,
    color: COLORS.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as React.CSSProperties,
  sectionContent: {
    padding: '0 12px 10px',
  } as React.CSSProperties,
  codeBlock: {
    padding: 8,
    backgroundColor: COLORS.bg,
    borderRadius: 4,
    border: `1px solid ${COLORS.border}`,
    fontSize: 11,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    color: COLORS.text,
    maxHeight: 200,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    lineHeight: '1.5',
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,
  errorBlock: {
    padding: 8,
    backgroundColor: '#f4474711',
    borderRadius: 4,
    border: `1px solid ${COLORS.error}44`,
    fontSize: 11,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    color: COLORS.error,
    maxHeight: 200,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    lineHeight: '1.5',
  } as React.CSSProperties,
  progressBar: {
    height: 3,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    overflow: 'hidden',
    margin: '0 12px 8px',
  } as React.CSSProperties,
  progressFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  } as React.CSSProperties,
  llmMeta: {
    display: 'flex',
    gap: 12,
    padding: '6px 12px 10px',
    borderTop: `1px solid ${COLORS.border}`,
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  llmMetaItem: {
    fontSize: 10,
    color: COLORS.secondary,
  } as React.CSSProperties,
  llmMetaValue: {
    color: COLORS.text,
    fontWeight: 500,
  } as React.CSSProperties,
  chevron: {
    fontSize: 10,
    color: COLORS.secondary,
    transition: 'transform 0.15s',
  } as React.CSSProperties,
};

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatData(data: unknown): string {
  if (data === undefined || data === null) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function truncateStr(str: string, maxLen: number): { text: string; truncated: boolean } {
  if (str.length <= maxLen) return { text: str, truncated: false };
  return { text: str.slice(0, maxLen) + '...', truncated: true };
}

// ── Component ────────────────────────────────────────────────────────────

export const AgentStepCard: React.FC<AgentStepCardProps> = ({
  id,
  name,
  type,
  status,
  duration,
  result,
  error,
  input,
  model,
  tokenCount,
  latencyMs,
  progressPct,
  totalSteps,
  stepIndex,
}) => {
  const [showInput, setShowInput] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy');
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(Date.now());

  // Inject animations
  useEffect(() => {
    const styleId = 'aahi-step-card-anims';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes aahi-step-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes aahi-step-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Elapsed time counter for running steps
  useEffect(() => {
    if (status !== 'running') return;
    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [status]);

  const handleCopy = useCallback(() => {
    const data = {
      id,
      name,
      type,
      status,
      duration,
      input,
      result,
      error,
      model,
      tokenCount,
      latencyMs,
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy'), 1500);
    });
  }, [id, name, type, status, duration, input, result, error, model, tokenCount, latencyMs]);

  const typeColor = TYPE_COLORS[type] || COLORS.secondary;
  const statusColor = STATUS_COLORS[status] || COLORS.secondary;

  const inputStr = formatData(input);
  const outputStr = formatData(result);

  const inputPreview = inputExpanded ? inputStr : truncateStr(inputStr, 200).text;
  const inputIsTruncated = inputStr.length > 200;
  const outputPreview = outputExpanded ? outputStr : truncateStr(outputStr, 200).text;
  const outputIsTruncated = outputStr.length > 200;

  const computedProgress =
    progressPct != null
      ? progressPct
      : totalSteps != null && stepIndex != null
        ? ((stepIndex + 1) / totalSteps) * 100
        : null;

  // Card left-border color based on status
  const cardStyle: React.CSSProperties = {
    ...styles.card,
    borderLeftWidth: 3,
    borderLeftColor: statusColor,
  };

  if (status === 'failed') {
    cardStyle.backgroundColor = '#f4474708';
  }

  return (
    <div style={cardStyle}>
      {/* ── Header row ────────────────────────────────────────────────── */}
      <div style={styles.cardHeader}>
        {/* Status indicator */}
        <div style={styles.statusIndicator}>
          {status === 'running' ? (
            <div style={styles.pulsingDot} />
          ) : status === 'waiting-approval' ? (
            <span style={styles.clockIcon}>{STATUS_ICONS[status]}</span>
          ) : (
            <span style={{ color: statusColor }}>{STATUS_ICONS[status]}</span>
          )}
        </div>

        {/* Step name */}
        <span style={styles.name} title={name}>
          {name}
        </span>

        {/* Type badge */}
        <span
          style={{
            ...styles.typeBadge,
            backgroundColor: typeColor + '22',
            color: typeColor,
            border: `1px solid ${typeColor}44`,
          }}
        >
          {TYPE_LABELS[type] || type}
        </span>

        {/* Status text */}
        <span style={{ ...styles.statusText, color: statusColor }}>
          {status === 'running'
            ? formatDuration(elapsed)
            : status === 'waiting-approval'
              ? 'Awaiting approval'
              : STATUS_LABELS[status]}
        </span>

        {/* Duration for completed/failed */}
        {(status === 'completed' || status === 'failed') && duration != null && (
          <span style={styles.duration}>{formatDuration(duration)}</span>
        )}

        {/* Copy button */}
        <button
          style={styles.copyBtn}
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          title="Copy step data as JSON"
        >
          {copyLabel}
        </button>
      </div>

      {/* ── Mini progress bar ─────────────────────────────────────────── */}
      {computedProgress != null && (
        <div style={styles.progressBar}>
          <div
            style={{
              ...styles.progressFill,
              width: `${Math.min(computedProgress, 100)}%`,
              backgroundColor: statusColor,
            }}
          />
        </div>
      )}

      {/* ── Error display ─────────────────────────────────────────────── */}
      {status === 'failed' && error && (
        <div style={{ padding: '0 12px 10px' }}>
          <div style={styles.errorBlock}>{error}</div>
        </div>
      )}

      {/* ── Waiting approval message ──────────────────────────────────── */}
      {status === 'waiting-approval' && (
        <div
          style={{
            padding: '6px 12px 10px',
            fontSize: 11,
            color: COLORS.warning,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14 }}>{'\u23F0'}</span>
          Awaiting user approval to continue
        </div>
      )}

      {/* ── Input section ─────────────────────────────────────────────── */}
      {inputStr && (
        <div style={styles.expandableSection}>
          <div style={styles.sectionHeader} onClick={() => setShowInput(!showInput)}>
            <span>Input</span>
            <span style={{ ...styles.chevron, transform: showInput ? 'rotate(90deg)' : 'none' }}>
              {'\u25B6'}
            </span>
          </div>
          {showInput && (
            <div style={styles.sectionContent}>
              <div style={styles.codeBlock}>{inputPreview}</div>
              {inputIsTruncated && (
                <div
                  style={{
                    fontSize: 10,
                    color: COLORS.accent,
                    cursor: 'pointer',
                    marginTop: 4,
                    textAlign: 'right',
                  }}
                  onClick={() => setInputExpanded(!inputExpanded)}
                >
                  {inputExpanded ? 'Show less' : 'Show more'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Output section ────────────────────────────────────────────── */}
      {outputStr && status !== 'failed' && (
        <div style={styles.expandableSection}>
          <div style={styles.sectionHeader} onClick={() => setShowOutput(!showOutput)}>
            <span>Output</span>
            <span style={{ ...styles.chevron, transform: showOutput ? 'rotate(90deg)' : 'none' }}>
              {'\u25B6'}
            </span>
          </div>
          {showOutput && (
            <div style={styles.sectionContent}>
              <div style={styles.codeBlock}>{outputPreview}</div>
              {outputIsTruncated && (
                <div
                  style={{
                    fontSize: 10,
                    color: COLORS.accent,
                    cursor: 'pointer',
                    marginTop: 4,
                    textAlign: 'right',
                  }}
                  onClick={() => setOutputExpanded(!outputExpanded)}
                >
                  {outputExpanded ? 'Show less' : 'Show more'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── LLM metadata ──────────────────────────────────────────────── */}
      {type === 'llm' && (model || tokenCount != null || latencyMs != null) && (
        <div style={styles.llmMeta}>
          {model && (
            <span style={styles.llmMetaItem}>
              Model: <span style={styles.llmMetaValue}>{model}</span>
            </span>
          )}
          {tokenCount != null && (
            <span style={styles.llmMetaItem}>
              Tokens: <span style={styles.llmMetaValue}>{tokenCount.toLocaleString()}</span>
            </span>
          )}
          {latencyMs != null && (
            <span style={styles.llmMetaItem}>
              Latency: <span style={styles.llmMetaValue}>{formatDuration(latencyMs)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};
