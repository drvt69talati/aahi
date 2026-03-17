import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRuntimeStore } from '../../store/runtime-store';

type EventSource = 'commit' | 'deploy' | 'alert' | 'incident' | 'flag-change' | 'ai-annotation';
type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

const sourceIcons: Record<EventSource, string> = {
  commit: '\u25CF',
  deploy: '\u25B6',
  alert: '\u25B2',
  incident: '\u26A0',
  'flag-change': '\u2691',
  'ai-annotation': '\u2605',
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

const REFRESH_INTERVAL_MS = 30_000;

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
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: '#858585',
    fontSize: 13,
    gap: 8,
    textAlign: 'center' as const,
    padding: 24,
  },
};

function formatTimestamp(ts: string | number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function toNumericTimestamp(ts: string | number): number {
  return typeof ts === 'number' ? ts : new Date(ts).getTime();
}

export const TimelinePanel: React.FC = () => {
  const timelineEvents = useRuntimeStore((s) => s.timelineEvents);
  const loadTimeline = useRuntimeStore((s) => s.loadTimeline);
  const connected = useRuntimeStore((s) => s.connected);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeSources, setActiveSources] = useState<Set<EventSource>>(new Set(allSources));
  const [loading, setLoading] = useState(false);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doLoad = useCallback(
    (sources?: EventSource[]) => {
      if (!connected) return;
      setLoading(true);
      const query = sources ? { sources } : undefined;
      loadTimeline(query).finally(() => setLoading(false));
    },
    [connected, loadTimeline]
  );

  // Load on mount
  useEffect(() => {
    doLoad();
  }, [doLoad]);

  // Auto-refresh every 30s
  useEffect(() => {
    refreshRef.current = setInterval(() => doLoad(), REFRESH_INTERVAL_MS);
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [doLoad]);

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

  const events = timelineEvents || [];
  const filtered = events
    .filter((e) => activeSources.has(e.source as EventSource))
    .sort((a, b) => toNumericTimestamp(b.timestamp) - toNumericTimestamp(a.timestamp));

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Event Timeline</span>
        <span style={{ fontSize: 11, color: '#858585' }}>
          {loading ? 'Loading...' : `${filtered.length} events`}
        </span>
      </div>

      <div style={styles.filterBar}>
        <span style={styles.filterLabel}>Source:</span>
        {allSources.map((source) => (
          <button
            key={source}
            style={{
              ...styles.filterChip,
              ...(activeSources.has(source)
                ? {
                    ...styles.filterChipActive,
                    borderColor: sourceColors[source],
                    color: sourceColors[source],
                    backgroundColor: sourceColors[source] + '22',
                  }
                : {}),
            }}
            onClick={() => toggleSource(source)}
          >
            {sourceIcons[source]} {source}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={styles.emptyState}>
          <span style={{ fontSize: 20, color: '#4ec9b0' }}>{'\u231A'}</span>
          <span>No events yet</span>
          <span style={{ fontSize: 11 }}>
            Connect integrations to see live data
          </span>
        </div>
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
                  backgroundColor: sourceColors[event.source as EventSource] || '#858585',
                  color: '#1e1e1e',
                }}
              >
                {sourceIcons[event.source as EventSource] || '\u2022'}
              </div>
              <div
                style={{
                  ...styles.eventCard,
                  ...((event as Record<string, unknown>).isCorrelation ? styles.eventCardCorrelation : {}),
                }}
              >
                <div style={styles.eventTop}>
                  <span
                    style={{
                      ...styles.eventIcon,
                      color: sourceColors[event.source as EventSource] || '#858585',
                    }}
                  >
                    {sourceIcons[event.source as EventSource] || '\u2022'}
                  </span>
                  <span style={styles.eventTitle}>{event.title}</span>
                  <span style={styles.eventTimestamp}>
                    {formatTimestamp(event.timestamp)}
                  </span>
                </div>
                <div style={styles.eventMeta}>
                  <span
                    style={{
                      ...styles.sourceBadge,
                      backgroundColor: (sourceColors[event.source as EventSource] || '#858585') + '22',
                      color: sourceColors[event.source as EventSource] || '#858585',
                    }}
                  >
                    {event.source}
                  </span>
                  <div
                    style={{
                      ...styles.severityDot,
                      backgroundColor: severityColors[event.severity as EventSeverity] || '#858585',
                    }}
                  />
                  {(event as Record<string, unknown>).isCorrelation && (
                    <span style={styles.correlationBadge}>AI Correlation</span>
                  )}
                </div>

                {expandedId === event.id && (
                  <div style={styles.expandedDetail}>
                    {event.description && (
                      <div style={{ marginBottom: 6 }}>{event.description}</div>
                    )}
                    {event.service && (
                      <div style={styles.metadataRow}>
                        <span style={styles.metadataKey}>service:</span>
                        <span style={styles.metadataValue}>{event.service}</span>
                      </div>
                    )}
                    {(event as Record<string, unknown>).metadata &&
                      Object.entries((event as Record<string, unknown>).metadata as Record<string, string>).map(([key, value]) => (
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
