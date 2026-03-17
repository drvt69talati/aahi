// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Context Chunk Card
// Displays a single context chunk with source badge, token count, redaction
// indicator, content preview with expand/collapse, and remove button.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

type ChunkSource = 'file' | 'logs' | 'metrics' | 'integration' | string;

interface ContextChunkCardProps {
  source: ChunkSource;
  sourceName: string;
  tokenCount: number;
  totalTokenBudget?: number;
  redactedCount: number;
  content: string;
  timestamp?: string;
  onRemove: () => void;
}

// ── Source badge colors ──────────────────────────────────────────────────────

const sourceConfig: Record<string, { color: string; label: string }> = {
  file: { color: '#569cd6', label: 'FILE' },
  logs: { color: '#4ec9b0', label: 'LOGS' },
  metrics: { color: '#c586c0', label: 'METRICS' },
  integration: { color: '#4ec9b0', label: 'INTEGRATION' },
};

function getSourceConfig(source: string): { color: string; label: string } {
  return sourceConfig[source] || { color: '#858585', label: source.toUpperCase() };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  return `${count}`;
}

function formatTimestamp(isoString?: string): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  } catch {
    return isoString;
  }
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  card: {
    backgroundColor: '#2d2d2d',
    border: '1px solid #3e3e42',
    borderRadius: 6,
    padding: 12,
    margin: '6px 0',
    transition: 'border-color 0.15s',
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  sourceBadge: {
    fontSize: 9,
    padding: '2px 7px',
    borderRadius: 3,
    fontWeight: 700 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    flexShrink: 0,
  },
  sourceName: {
    flex: 1,
    fontSize: 12,
    fontWeight: 500 as const,
    color: '#cccccc',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  tokenSection: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  tokenText: {
    fontSize: 10,
    color: '#858585',
  },
  tokenMiniBar: {
    width: 40,
    height: 3,
    backgroundColor: '#3e3e42',
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  tokenMiniBarFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  },
  removeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    border: '1px solid transparent',
    backgroundColor: 'transparent',
    color: '#585858',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    flexShrink: 0,
    transition: 'color 0.15s, background-color 0.15s, border-color 0.15s',
  },

  // Metadata row
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    fontSize: 10,
    color: '#585858',
  },

  // Redaction indicator
  redactionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 10,
    fontWeight: 600 as const,
    color: '#f44747',
    backgroundColor: '#f4474722',
    padding: '1px 6px',
    borderRadius: 3,
    border: '1px solid #f4474733',
  },

  // Content preview
  contentPreview: {
    padding: 8,
    backgroundColor: '#1e1e1e',
    borderRadius: 4,
    border: '1px solid #3e3e42',
    fontSize: 11,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    color: '#cccccc',
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    lineHeight: '1.6',
    cursor: 'pointer',
    transition: 'max-height 0.3s ease',
  },
  collapsed: {
    maxHeight: 80,
  },
  expanded: {
    maxHeight: 400,
  },

  // Toggle
  expandToggle: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: 4,
    fontSize: 10,
    color: '#007acc',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },

  // Timestamp
  timestamp: {
    fontSize: 10,
    color: '#454545',
  },
};

// ── Component ────────────────────────────────────────────────────────────────

export const ContextChunkCard: React.FC<ContextChunkCardProps> = ({
  source,
  sourceName,
  tokenCount,
  totalTokenBudget = 128000,
  redactedCount,
  content,
  timestamp,
  onRemove,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [removeHovered, setRemoveHovered] = useState(false);
  const [cardHovered, setCardHovered] = useState(false);

  const config = getSourceConfig(source);
  const tokenPercent = Math.min((tokenCount / totalTokenBudget) * 100, 100);
  const truncated = content.length > 200 && !expanded;
  const formattedTime = formatTimestamp(timestamp);

  return (
    <div
      style={{
        ...styles.card,
        borderColor: cardHovered ? '#505054' : '#3e3e42',
      }}
      onMouseEnter={() => setCardHovered(true)}
      onMouseLeave={() => setCardHovered(false)}
    >
      {/* Top row: source badge, name, tokens, remove */}
      <div style={styles.topRow}>
        <span
          style={{
            ...styles.sourceBadge,
            backgroundColor: config.color + '22',
            color: config.color,
            border: `1px solid ${config.color}44`,
          }}
        >
          {config.label}
        </span>
        <span style={styles.sourceName} title={sourceName}>
          {sourceName}
        </span>
        <div style={styles.tokenSection}>
          <span style={styles.tokenText}>{formatTokens(tokenCount)}</span>
          <div style={styles.tokenMiniBar}>
            <div
              style={{
                ...styles.tokenMiniBarFill,
                width: `${tokenPercent}%`,
                backgroundColor: config.color,
              }}
            />
          </div>
        </div>
        <button
          style={{
            ...styles.removeBtn,
            color: removeHovered ? '#f44747' : '#585858',
            backgroundColor: removeHovered ? '#f4474718' : 'transparent',
            borderColor: removeHovered ? '#f4474733' : 'transparent',
          }}
          title="Remove from context"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onMouseEnter={() => setRemoveHovered(true)}
          onMouseLeave={() => setRemoveHovered(false)}
        >
          X
        </button>
      </div>

      {/* Metadata: redaction indicator + timestamp */}
      <div style={styles.metaRow}>
        {redactedCount > 0 && (
          <span style={styles.redactionBadge}>
            {redactedCount} redacted
          </span>
        )}
        {formattedTime && <span style={styles.timestamp}>{formattedTime}</span>}
      </div>

      {/* Content preview */}
      <div
        style={{
          ...styles.contentPreview,
          ...(expanded ? styles.expanded : styles.collapsed),
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {truncated ? content.slice(0, 200) + '...' : content}
      </div>

      {/* Expand/collapse toggle */}
      {content.length > 200 && (
        <div
          style={styles.expandToggle as React.CSSProperties}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </div>
      )}
    </div>
  );
};
