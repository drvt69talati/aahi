import React, { useState } from 'react';

type ChunkSource = 'file' | 'logs' | 'metrics' | string;

interface ContextChunkCardProps {
  source: ChunkSource;
  sourceName: string;
  tokenCount: number;
  redactedCount: number;
  content: string;
  onRemove: () => void;
}

const sourceColors: Record<string, string> = {
  file: '#569cd6',
  logs: '#4ec9b0',
  metrics: '#dcdcaa',
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
    marginBottom: 8,
  },
  sourceBadge: {
    fontSize: 10,
    padding: '1px 7px',
    borderRadius: 3,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
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
  tokenBadge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 3,
    backgroundColor: '#1e1e1e',
    color: '#858585',
    border: '1px solid #3e3e42',
  },
  removeBtn: {
    padding: '2px 8px',
    backgroundColor: 'transparent',
    color: '#858585',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    fontSize: 10,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  redactionIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    color: '#cca700',
    marginBottom: 8,
  },
  contentPreview: {
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
  expandedContent: {
    maxHeight: 300,
  },
  expandToggle: {
    fontSize: 10,
    color: '#858585',
    cursor: 'pointer',
    marginTop: 4,
    textAlign: 'right' as const,
  },
};

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return `${count}`;
}

function getSourceColor(source: string): string {
  return sourceColors[source] || '#c586c0';
}

export const ContextChunkCard: React.FC<ContextChunkCardProps> = ({
  source,
  sourceName,
  tokenCount,
  redactedCount,
  content,
  onRemove,
}) => {
  const [expanded, setExpanded] = useState(false);

  const color = getSourceColor(source);
  const truncated = content.length > 150 && !expanded;

  return (
    <div style={styles.card}>
      <div style={styles.top}>
        <span
          style={{
            ...styles.sourceBadge,
            backgroundColor: color + '22',
            color,
            border: `1px solid ${color}44`,
          }}
        >
          {source}
        </span>
        <span style={styles.sourceName}>{sourceName}</span>
        <span style={styles.tokenBadge}>{formatTokens(tokenCount)} tokens</span>
        <button
          style={styles.removeBtn}
          onClick={onRemove}
          title="Remove from context"
        >
          Remove
        </button>
      </div>

      {redactedCount > 0 && (
        <div style={styles.redactionIndicator}>
          <span>{'\u26BF'}</span>
          <span>{redactedCount} entities redacted</span>
        </div>
      )}

      <div
        style={{
          ...styles.contentPreview,
          ...(expanded ? styles.expandedContent : {}),
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {truncated ? content.slice(0, 150) + '...' : content}
      </div>
      {content.length > 150 && (
        <div
          style={styles.expandToggle as React.CSSProperties}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </div>
      )}
    </div>
  );
};
