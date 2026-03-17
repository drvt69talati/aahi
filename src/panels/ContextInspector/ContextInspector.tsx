import React, { useState } from 'react';

type ContextPriority = 'high' | 'medium' | 'low';

interface ContextSource {
  id: string;
  name: string;
  integration: string;
  tokenCount: number;
  priority: ContextPriority;
  redactedCount: number;
  content?: string;
}

interface ContextInspectorProps {
  totalTokenBudget: number;
  usedTokens: number;
  sources: ContextSource[];
  totalRedacted: number;
}

const priorityColors: Record<ContextPriority, string> = {
  high: '#f44747',
  medium: '#cca700',
  low: '#4ec9b0',
};

const priorityLabels: Record<ContextPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 600 as const,
    color: '#cccccc',
  },
  budgetSection: {
    padding: '12px',
    borderBottom: '1px solid #3e3e42',
  },
  budgetLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#858585',
    marginBottom: 6,
  },
  budgetBar: {
    height: 8,
    backgroundColor: '#3e3e42',
    borderRadius: 4,
    overflow: 'hidden' as const,
  },
  budgetFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.3s ease',
  },
  budgetDetails: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 6,
    fontSize: 11,
  },
  redactionSummary: {
    padding: '8px 12px',
    borderBottom: '1px solid #3e3e42',
    backgroundColor: '#2d2d2d',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
  },
  redactionIcon: {
    color: '#cca700',
    fontSize: 13,
  },
  redactionText: {
    color: '#858585',
    fontSize: 12,
  },
  sourceList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  sourceItem: {
    padding: '8px 12px',
    borderBottom: '1px solid #2d2d2d',
    cursor: 'pointer',
  },
  sourceTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sourceName: {
    flex: 1,
    fontSize: 12,
    fontWeight: 500 as const,
    color: '#cccccc',
  },
  tokenBadge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 3,
    backgroundColor: '#2d2d2d',
    color: '#858585',
    border: '1px solid #3e3e42',
  },
  sourceIntegration: {
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 3,
    backgroundColor: '#007acc22',
    color: '#569cd6',
    border: '1px solid #007acc44',
  },
  priorityIndicator: {
    width: 6,
    height: 6,
    borderRadius: '50%',
  },
  sourceMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginLeft: 14,
    fontSize: 11,
    color: '#858585',
  },
  expandedContent: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#2d2d2d',
    borderRadius: 4,
    border: '1px solid #3e3e42',
    fontSize: 11,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    color: '#cccccc',
    maxHeight: 150,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    lineHeight: '1.5',
  },
  tokenBar: {
    height: 3,
    backgroundColor: '#3e3e42',
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden' as const,
  },
  tokenBarFill: {
    height: '100%',
    backgroundColor: '#569cd6',
    borderRadius: 2,
  },
};

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return `${count}`;
}

export const ContextInspector: React.FC<ContextInspectorProps> = ({
  totalTokenBudget,
  usedTokens,
  sources,
  totalRedacted,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const usagePercent = Math.min((usedTokens / totalTokenBudget) * 100, 100);
  const budgetColor =
    usagePercent > 90 ? '#f44747' : usagePercent > 70 ? '#cca700' : '#4ec9b0';

  // Group by integration
  const integrationBreakdown = sources.reduce(
    (acc, src) => {
      acc[src.integration] = (acc[src.integration] || 0) + src.tokenCount;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Context Inspector</span>
        <span style={{ fontSize: 11, color: '#858585' }}>{sources.length} sources</span>
      </div>

      {/* Token Budget */}
      <div style={styles.budgetSection}>
        <div style={styles.budgetLabel}>
          <span>Token Budget</span>
          <span>
            {formatTokens(usedTokens)} / {formatTokens(totalTokenBudget)} ({usagePercent.toFixed(1)}
            %)
          </span>
        </div>
        <div style={styles.budgetBar}>
          <div
            style={{
              ...styles.budgetFill,
              width: `${usagePercent}%`,
              backgroundColor: budgetColor,
            }}
          />
        </div>
        <div style={styles.budgetDetails}>
          {Object.entries(integrationBreakdown).map(([integration, tokens]) => (
            <span key={integration} style={{ color: '#858585' }}>
              {integration}: {formatTokens(tokens)}
            </span>
          ))}
        </div>
      </div>

      {/* Redaction Summary */}
      {totalRedacted > 0 && (
        <div style={styles.redactionSummary}>
          <span style={styles.redactionIcon}>{'\u26BF'}</span>
          <span style={styles.redactionText}>
            {totalRedacted} entities redacted in this context
          </span>
        </div>
      )}

      {/* Source List */}
      <div style={styles.sourceList}>
        {sources.map((source) => {
          const tokenPercent = (source.tokenCount / totalTokenBudget) * 100;

          return (
            <div
              key={source.id}
              style={{
                ...styles.sourceItem,
                backgroundColor: expandedId === source.id ? '#2d2d2d' : 'transparent',
              }}
              onClick={() => setExpandedId(expandedId === source.id ? null : source.id)}
            >
              <div style={styles.sourceTop}>
                <div
                  style={{
                    ...styles.priorityIndicator,
                    backgroundColor: priorityColors[source.priority],
                  }}
                  title={`${priorityLabels[source.priority]} priority`}
                />
                <span style={styles.sourceName}>{source.name}</span>
                <span style={styles.sourceIntegration}>{source.integration}</span>
                <span style={styles.tokenBadge}>{formatTokens(source.tokenCount)} tokens</span>
              </div>
              <div style={styles.sourceMeta}>
                <span>Priority: {priorityLabels[source.priority]}</span>
                {source.redactedCount > 0 && (
                  <span style={{ color: '#cca700' }}>
                    {source.redactedCount} redacted
                  </span>
                )}
              </div>
              <div style={styles.tokenBar}>
                <div style={{ ...styles.tokenBarFill, width: `${tokenPercent}%` }} />
              </div>

              {expandedId === source.id && source.content && (
                <div style={styles.expandedContent}>{source.content}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
