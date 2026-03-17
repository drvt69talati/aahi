import React, { useState } from 'react';

type EventSource = 'commit' | 'deploy' | 'alert' | 'incident' | 'flag-change' | 'ai-annotation';
type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

interface TimelineEvent {
  id: string;
  timestamp: number;
  title: string;
  source: EventSource;
  severity: EventSeverity;
  description?: string;
  isCorrelation?: boolean;
  metadata?: Record<string, string>;
}

interface TimelinePanelProps {
  events: TimelineEvent[];
}

const sourceIcons: Record<EventSource, string> = {
  commit: '\u25CF', // filled circle
  deploy: '\u25B6', // play triangle
  alert: '\u25B2', // triangle
  incident: '\u26A0', // warning
  'flag-change': '\u2691', // flag
  'ai-annotation': '\u2605', // star
};

const sourceColors: Record<EventSource, string> = {
  commit: '#569cd6',
  deploy: '#4ec9b0',
  alert: '#cca700',
  incident: '#f44747',
  'flag-change': '#c586c0',
  'ai-annotation': '#dcdcaa',
};

const severityColors: Record<EventSeverity, string> = {
  info: '#007acc',
  warning: '#cca700',
  error: '#f44747',
  critical: '#d32f2f',
};

const allSources: EventSource[] = ['commit', 'deploy', 'alert', 'incident', 'flag-change', 'ai-annotation'];

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
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    borderBottom: '1px solid #3e3e42',
    backgroundColor: '#252526',
    flexWrap: 'wrap' as const,
  },
  filterLabel: {
    fontSize: 11,
    color: '#858585',
  },
  filterChip: {
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 10,
    cursor: 'pointer',
    border: '1px solid #3e3e42',
    backgroundColor: 'transparent',
    color: '#858585',
    fontFamily: 'inherit',
  },
  filterChipActive: {
    borderColor: '#007acc',
    color: '#007acc',
    backgroundColor: '#007acc22',
  },
  timeline: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 12px 8px 24px',
    position: 'relative' as const,
  },
  timelineLine: {
    position: 'absolute' as const,
    left: 30,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#3e3e42',
  },
  event: {
    position: 'relative' as const,
    marginBottom: 2,
    paddingLeft: 24,
    cursor: 'pointer',
  },
  eventDot: {
    position: 'absolute' as const,
    left: -1,
    top: 10,
    width: 12,
    height: 12,
    borderRadius: '50%',
    border: '2px solid #1e1e1e',
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 8,
  },
  eventCard: {
    padding: '8px 12px',
    backgroundColor: '#2d2d2d',
    borderRadius: 4,
    border: '1px solid #3e3e42',
    marginBottom: 6,
  },
  eventCardCorrelation: {
    border: '1px solid #dcdcaa44',
    boxShadow: '0 0 8px #dcdcaa22',
  },
  eventTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  eventIcon: {
    fontSize: 12,
    width: 16,
    textAlign: 'center' as const,
  },
  eventTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: 500 as const,
    color: '#cccccc',
  },
  eventTimestamp: {
    fontSize: 10,
    color: '#858585',
  },
  eventMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  sourceBadge: {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 3,
    fontWeight: 500 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  severityDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
  },
  expandedDetail: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#1e1e1e',
    borderRadius: 4,
    fontSize: 11,
    color: '#cccccc',
    lineHeight: '1.6',
  },
  metadataRow: {
    display: 'flex',
    gap: 8,
    fontSize: 11,
    marginBottom: 2,
  },
  metadataKey: {
    color: '#858585',
    minWidth: 70,
  },
  metadataValue: {
    color: '#cccccc',
  },
  correlationBadge: {
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 3,
    backgroundColor: '#dcdcaa22',
    color: '#dcdcaa',
    border: '1px solid #dcdcaa44',
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: '#858585',
    fontSize: 13,
  },
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const TimelinePanel: React.FC<TimelinePanelProps> = ({ events }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeSources, setActiveSources] = useState<Set<EventSource>>(new Set(allSources));

  const toggleSource = (source: EventSource) => {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  };

  const filtered = events
    .filter((e) => activeSources.has(e.source))
    .sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Event Timeline</span>
        <span style={{ fontSize: 11, color: '#858585' }}>{filtered.length} events</span>
      </div>

      <div style={styles.filterBar}>
        <span style={styles.filterLabel}>Source:</span>
        {allSources.map((source) => (
          <button
            key={source}
            style={{
              ...styles.filterChip,
              ...(activeSources.has(source)
                ? { ...styles.filterChipActive, borderColor: sourceColors[source], color: sourceColors[source], backgroundColor: sourceColors[source] + '22' }
                : {}),
            }}
            onClick={() => toggleSource(source)}
          >
            {sourceIcons[source]} {source}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={styles.emptyState}>No events to display</div>
      ) : (
        <div style={styles.timeline}>
          <div style={styles.timelineLine} />
          {filtered.map((event) => (
            <div
              key={event.id}
              style={styles.event}
              onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
            >
              <div
                style={{
                  ...styles.eventDot,
                  backgroundColor: sourceColors[event.source],
                  color: '#1e1e1e',
                }}
              >
                {sourceIcons[event.source]}
              </div>
              <div
                style={{
                  ...styles.eventCard,
                  ...(event.isCorrelation ? styles.eventCardCorrelation : {}),
                }}
              >
                <div style={styles.eventTop}>
                  <span style={{ ...styles.eventIcon, color: sourceColors[event.source] }}>
                    {sourceIcons[event.source]}
                  </span>
                  <span style={styles.eventTitle}>{event.title}</span>
                  <span style={styles.eventTimestamp}>{formatTimestamp(event.timestamp)}</span>
                </div>
                <div style={styles.eventMeta}>
                  <span
                    style={{
                      ...styles.sourceBadge,
                      backgroundColor: sourceColors[event.source] + '22',
                      color: sourceColors[event.source],
                    }}
                  >
                    {event.source}
                  </span>
                  <div
                    style={{
                      ...styles.severityDot,
                      backgroundColor: severityColors[event.severity],
                    }}
                  />
                  {event.isCorrelation && (
                    <span style={styles.correlationBadge}>AI Correlation</span>
                  )}
                </div>

                {expandedId === event.id && (
                  <div style={styles.expandedDetail}>
                    {event.description && (
                      <div style={{ marginBottom: 6 }}>{event.description}</div>
                    )}
                    {event.metadata &&
                      Object.entries(event.metadata).map(([key, value]) => (
                        <div key={key} style={styles.metadataRow}>
                          <span style={styles.metadataKey}>{key}:</span>
                          <span style={styles.metadataValue}>{value}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
