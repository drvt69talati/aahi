// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Knowledge Graph Panel
// Visual service map, ownership table, expertise index, and ADR browser.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { runtime } from '../../bridge/runtime-client';

// ── Types ────────────────────────────────────────────────────────────────────

type HealthStatus = 'healthy' | 'degraded' | 'down';

interface ServiceNode {
  id: string;
  name: string;
  team: string;
  health: HealthStatus;
  owners: string[];
  slackChannel?: string;
  lastIncident?: string;
  dependencies: string[]; // service IDs this depends on
}

interface ExpertEntry {
  person: string;
  confidence: number;
  commitCount: number;
  lastCommit: string;
  areas?: string[];
}

interface ADREntry {
  id: string;
  title: string;
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  date: string;
  authors: string[];
  context: string;
  decision: string;
  consequences: string;
}

type TabId = 'service-map' | 'expertise' | 'adrs';

// ── Mock data ────────────────────────────────────────────────────────────────

function getMockServices(): ServiceNode[] {
  return [
    { id: 'auth', name: 'auth-service', team: 'Platform', health: 'healthy', owners: ['alice', 'bob'], slackChannel: '#platform-auth', lastIncident: '2026-02-28', dependencies: ['user-db', 'redis-cache'] },
    { id: 'api-gw', name: 'api-gateway', team: 'Platform', health: 'healthy', owners: ['charlie'], slackChannel: '#platform-gateway', dependencies: ['auth', 'rate-limiter'] },
    { id: 'user-db', name: 'user-database', team: 'Data', health: 'healthy', owners: ['dave', 'eve'], slackChannel: '#data-eng', dependencies: [] },
    { id: 'redis-cache', name: 'redis-cache', team: 'Platform', health: 'degraded', owners: ['bob'], slackChannel: '#platform-infra', lastIncident: '2026-03-15', dependencies: [] },
    { id: 'rate-limiter', name: 'rate-limiter', team: 'Platform', health: 'healthy', owners: ['alice'], slackChannel: '#platform-auth', dependencies: ['redis-cache'] },
    { id: 'payment', name: 'payment-service', team: 'Payments', health: 'healthy', owners: ['frank', 'grace'], slackChannel: '#payments', dependencies: ['auth', 'user-db'] },
    { id: 'notification', name: 'notification-svc', team: 'Growth', health: 'down', owners: ['henry'], slackChannel: '#growth-eng', lastIncident: '2026-03-16', dependencies: ['user-db', 'redis-cache'] },
    { id: 'search', name: 'search-service', team: 'Discovery', health: 'healthy', owners: ['ivy', 'jack'], slackChannel: '#discovery', dependencies: ['api-gw'] },
  ];
}

function getMockExperts(): ExpertEntry[] {
  return [
    { person: 'alice', confidence: 0.95, commitCount: 342, lastCommit: '2026-03-15', areas: ['src/auth/**', 'src/middleware/**'] },
    { person: 'bob', confidence: 0.88, commitCount: 218, lastCommit: '2026-03-14', areas: ['src/auth/**', 'infrastructure/**'] },
    { person: 'charlie', confidence: 0.82, commitCount: 156, lastCommit: '2026-03-16', areas: ['src/gateway/**', 'src/routing/**'] },
    { person: 'dave', confidence: 0.78, commitCount: 289, lastCommit: '2026-03-13', areas: ['src/db/**', 'migrations/**'] },
    { person: 'eve', confidence: 0.75, commitCount: 201, lastCommit: '2026-03-12', areas: ['src/db/**', 'src/models/**'] },
    { person: 'frank', confidence: 0.71, commitCount: 134, lastCommit: '2026-03-10', areas: ['src/payments/**'] },
    { person: 'grace', confidence: 0.65, commitCount: 98, lastCommit: '2026-03-11', areas: ['src/payments/**', 'src/billing/**'] },
    { person: 'henry', confidence: 0.60, commitCount: 87, lastCommit: '2026-03-09', areas: ['src/notifications/**'] },
  ];
}

function getMockADRs(): ADREntry[] {
  return [
    { id: 'adr-001', title: 'Use JWT for service-to-service authentication', status: 'accepted', date: '2025-11-15', authors: ['alice', 'bob'], context: 'Services need a secure way to authenticate requests between each other without hitting the auth database on every call.', decision: 'Use short-lived JWTs signed with RS256 for service-to-service auth. Each service validates tokens locally using the public key.', consequences: 'Reduced load on auth-service. Need to handle key rotation. Token expiry must be short (5 min) to limit blast radius.' },
    { id: 'adr-002', title: 'Migrate from REST to gRPC for internal services', status: 'proposed', date: '2026-02-20', authors: ['charlie'], context: 'Internal service communication is becoming a bottleneck. JSON serialization overhead and lack of streaming support are limiting throughput.', decision: 'Adopt gRPC with Protocol Buffers for all new internal service communication. Existing REST endpoints will be maintained for external consumers.', consequences: 'Better performance and type safety. Team needs to learn protobuf. Need to update monitoring for gRPC status codes.' },
    { id: 'adr-003', title: 'Replace homegrown rate limiter with Redis-based token bucket', status: 'accepted', date: '2026-01-08', authors: ['alice', 'frank'], context: 'Current in-memory rate limiter does not work across multiple instances. Rate limits are per-pod, not per-user.', decision: 'Implement a distributed token bucket algorithm using Redis EVAL scripts for atomic operations.', consequences: 'Consistent rate limiting across all pods. Added dependency on Redis. Slightly higher latency per request (~2ms).' },
    { id: 'adr-004', title: 'Deprecate MongoDB in favor of PostgreSQL', status: 'deprecated', date: '2025-06-01', authors: ['dave', 'eve'], context: 'Originally we used MongoDB for flexibility but have found that most data is relational in nature.', decision: 'Migrate all MongoDB collections to PostgreSQL tables over the next quarter.', consequences: 'Migration completed. MongoDB cluster decommissioned. Some aggregation pipelines needed rewriting as SQL.' },
  ];
}

// ── Health colors ────────────────────────────────────────────────────────────

const healthColors: Record<HealthStatus, string> = {
  healthy: '#4ec9b0',
  degraded: '#cca700',
  down: '#f44747',
};

const adrStatusColors: Record<string, string> = {
  accepted: '#4ec9b0',
  proposed: '#569cd6',
  deprecated: '#858585',
  superseded: '#c586c0',
};

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
    color: '#cccccc',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 14px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 600 as const,
    color: '#cccccc',
    flex: 1,
  },

  // Tabs
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid #3e3e42',
    backgroundColor: '#252526',
    flexShrink: 0,
  },
  tab: {
    padding: '8px 16px',
    fontSize: 12,
    color: '#858585',
    cursor: 'pointer',
    border: 'none',
    backgroundColor: 'transparent',
    borderBottom: '2px solid transparent',
    fontFamily: 'inherit',
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabActive: {
    color: '#cccccc',
    borderBottomColor: '#007acc',
  },

  scrollBody: {
    flex: 1,
    overflowY: 'auto' as const,
  },

  // Service Map
  mapContainer: {
    position: 'relative' as const,
    minHeight: 400,
    padding: 20,
    overflow: 'auto' as const,
  },
  serviceNode: {
    position: 'absolute' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    padding: '10px 14px',
    backgroundColor: '#2d2d2d',
    border: '1px solid #3e3e42',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    minWidth: 120,
    textAlign: 'center' as const,
    zIndex: 2,
  },
  nodeSelected: {
    borderColor: '#007acc',
    boxShadow: '0 0 12px rgba(0, 122, 204, 0.3)',
  },
  nodeName: {
    fontSize: 11,
    fontWeight: 600 as const,
    color: '#cccccc',
  },
  nodeTeam: {
    fontSize: 9,
    color: '#858585',
    backgroundColor: '#3e3e42',
    padding: '1px 5px',
    borderRadius: 2,
  },
  healthDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    position: 'absolute' as const,
    top: 6,
    right: 6,
  },

  // SVG edges
  edgeSvg: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none' as const,
    zIndex: 1,
  },

  // Node detail panel
  nodeDetail: {
    padding: '12px 14px',
    backgroundColor: '#252526',
    borderTop: '1px solid #3e3e42',
    fontSize: 12,
  },
  detailRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 6,
    alignItems: 'center' as const,
  },
  detailLabel: {
    fontWeight: 600 as const,
    color: '#858585',
    fontSize: 11,
    width: 90,
    flexShrink: 0,
  },
  detailValue: {
    color: '#cccccc',
    fontSize: 12,
  },

  // Ownership Table
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
  },
  th: {
    padding: '8px 12px',
    textAlign: 'left' as const,
    fontSize: 11,
    fontWeight: 600 as const,
    color: '#858585',
    borderBottom: '1px solid #3e3e42',
    backgroundColor: '#252526',
    cursor: 'pointer',
    userSelect: 'none' as const,
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid #2d2d2d',
    color: '#cccccc',
  },
  tableRow: {
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },

  // Search input
  searchInput: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: '#1e1e1e',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    color: '#cccccc',
    fontSize: 12,
    outline: 'none',
    fontFamily: 'inherit',
    margin: '10px 14px',
    boxSizing: 'border-box' as const,
  },
  searchWrapper: {
    padding: '10px 14px 0',
  },

  // Expertise list
  expertItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 14px',
    borderBottom: '1px solid #2d2d2d',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  expertRank: {
    width: 24,
    fontSize: 11,
    fontWeight: 600 as const,
    color: '#585858',
    flexShrink: 0,
  },
  expertName: {
    flex: 1,
    fontSize: 12,
    fontWeight: 500 as const,
    color: '#cccccc',
  },
  confidenceBar: {
    width: 60,
    height: 4,
    backgroundColor: '#3e3e42',
    borderRadius: 2,
    overflow: 'hidden' as const,
    marginRight: 10,
  },
  confidenceFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#007acc',
  },
  expertMeta: {
    fontSize: 10,
    color: '#858585',
    textAlign: 'right' as const,
    minWidth: 80,
  },
  expertAreas: {
    marginTop: 4,
    marginLeft: 24,
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap' as const,
  },
  areaTag: {
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 2,
    backgroundColor: '#007acc22',
    color: '#569cd6',
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
  },

  // ADR list
  adrItem: {
    padding: '10px 14px',
    borderBottom: '1px solid #2d2d2d',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  adrHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  adrTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: 500 as const,
    color: '#cccccc',
  },
  adrStatusBadge: {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 3,
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  adrMeta: {
    display: 'flex',
    gap: 12,
    fontSize: 10,
    color: '#858585',
  },
  adrExpanded: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#2d2d2d',
    borderRadius: 4,
    border: '1px solid #3e3e42',
    fontSize: 12,
    lineHeight: '1.6',
  },
  adrSection: {
    marginBottom: 8,
  },
  adrSectionLabel: {
    fontSize: 10,
    fontWeight: 600 as const,
    color: '#858585',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  adrSectionText: {
    color: '#cccccc',
    fontSize: 12,
  },

  // Empty state
  emptyState: {
    padding: '40px 20px',
    textAlign: 'center' as const,
    color: '#585858',
    fontSize: 13,
  },
  emptyHint: {
    marginTop: 8,
    fontSize: 11,
    color: '#454545',
  },
};

// ── Grid layout calculator for service map ───────────────────────────────────

function computeNodePositions(
  services: ServiceNode[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const cols = Math.ceil(Math.sqrt(services.length));
  const colWidth = 170;
  const rowHeight = 90;
  const startX = 20;
  const startY = 20;

  // Simple layered layout: nodes with no dependencies first, then dependents
  const placed = new Set<string>();
  const layers: string[][] = [];

  // Find roots (no incoming dependencies)
  const hasIncoming = new Set<string>();
  for (const s of services) {
    for (const dep of s.dependencies) {
      hasIncoming.add(dep);
    }
  }

  const roots = services.filter((s) => !hasIncoming.has(s.id)).map((s) => s.id);
  const remaining = services.filter((s) => hasIncoming.has(s.id)).map((s) => s.id);

  if (roots.length > 0) {
    layers.push(roots);
    roots.forEach((id) => placed.add(id));
  }

  // BFS layers
  let attempts = 0;
  let current = [...remaining];
  while (current.length > 0 && attempts < 10) {
    const nextLayer: string[] = [];
    const stillRemaining: string[] = [];

    for (const id of current) {
      const svc = services.find((s) => s.id === id);
      if (!svc) continue;
      const depsPlaced = svc.dependencies.every((d) => placed.has(d) || !services.find((s) => s.id === d));
      if (depsPlaced || attempts > 5) {
        nextLayer.push(id);
        placed.add(id);
      } else {
        stillRemaining.push(id);
      }
    }

    if (nextLayer.length > 0) {
      layers.push(nextLayer);
    }
    current = stillRemaining;
    attempts++;
  }

  // Any remaining unplaced
  if (current.length > 0) {
    layers.push(current);
  }

  // Assign positions
  for (let row = 0; row < layers.length; row++) {
    const layer = layers[row];
    const layerWidth = layer.length * colWidth;
    const totalWidth = Math.max(cols, layer.length) * colWidth;
    const offsetX = (totalWidth - layerWidth) / 2;

    for (let col = 0; col < layer.length; col++) {
      positions.set(layer[col], {
        x: startX + offsetX + col * colWidth,
        y: startY + row * rowHeight,
      });
    }
  }

  return positions;
}

// ── Component ────────────────────────────────────────────────────────────────

export const KnowledgeGraph: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('service-map');
  const [services, setServices] = useState<ServiceNode[]>([]);
  const [experts, setExperts] = useState<ExpertEntry[]>([]);
  const [adrs, setAdrs] = useState<ADREntry[]>([]);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [highlightedService, setHighlightedService] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expertiseQuery, setExpertiseQuery] = useState('');
  const [expandedAdr, setExpandedAdr] = useState<string | null>(null);
  const [expandedExpert, setExpandedExpert] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<string>('service');
  const [sortAsc, setSortAsc] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);

  // Fetch data from runtime or fall back to mock data
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      // Fetch services
      try {
        const result = await runtime.request<{ services: ServiceNode[] }>(
          'knowledgeGraph.getServiceContext',
          { service: '*' },
        );
        if (!cancelled && result?.services) {
          setServices(result.services);
        }
      } catch {
        if (!cancelled) setServices(getMockServices());
      }

      // Fetch experts
      try {
        const result = await runtime.request<{ experts: ExpertEntry[] }>(
          'knowledgeGraph.whoKnows',
          { filePath: '*' },
        );
        if (!cancelled && result?.experts) {
          setExperts(result.experts);
        }
      } catch {
        if (!cancelled) setExperts(getMockExperts());
      }

      // Fetch ADRs
      try {
        const result = await runtime.request<{ adrs: ADREntry[] }>(
          'knowledgeGraph.listADRs',
          {},
        );
        if (!cancelled && result?.adrs) {
          setAdrs(result.adrs);
        }
      } catch {
        if (!cancelled) setAdrs(getMockADRs());
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  // Node positions for the service map
  const nodePositions = computeNodePositions(services);

  // Map dimensions
  const mapWidth = Math.max(
    ...Array.from(nodePositions.values()).map((p) => p.x + 160),
    600,
  );
  const mapHeight = Math.max(
    ...Array.from(nodePositions.values()).map((p) => p.y + 80),
    300,
  );

  // Table sorting
  const handleSort = useCallback((col: string) => {
    setSortColumn((prev) => {
      if (prev === col) {
        setSortAsc((a) => !a);
        return col;
      }
      setSortAsc(true);
      return col;
    });
  }, []);

  // Filter services for ownership table
  const filteredServices = services
    .filter((s) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.team.toLowerCase().includes(q) ||
        s.owners.some((o) => o.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      switch (sortColumn) {
        case 'team': return dir * a.team.localeCompare(b.team);
        case 'owners': return dir * (a.owners[0] || '').localeCompare(b.owners[0] || '');
        case 'lastIncident': return dir * ((a.lastIncident || '').localeCompare(b.lastIncident || ''));
        default: return dir * a.name.localeCompare(b.name);
      }
    });

  // Filter experts
  const filteredExperts = experts.filter((e) => {
    if (!expertiseQuery) return true;
    const q = expertiseQuery.toLowerCase();
    return (
      e.person.toLowerCase().includes(q) ||
      (e.areas || []).some((a) => a.toLowerCase().includes(q))
    );
  });

  const selectedNode = services.find((s) => s.id === selectedService);

  // ── Render tabs ────────────────────────────────────────────────────────────

  const renderServiceMap = () => (
    <>
      {/* Graph area */}
      <div
        ref={mapRef}
        style={{
          ...styles.mapContainer,
          width: mapWidth + 40,
          height: mapHeight + 40,
        }}
      >
        {/* Edges (SVG) */}
        <svg
          style={{ ...styles.edgeSvg, width: mapWidth + 40, height: mapHeight + 40 }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="6"
              refX="8"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#585858" />
            </marker>
          </defs>
          {services.map((svc) =>
            svc.dependencies.map((depId) => {
              const from = nodePositions.get(svc.id);
              const to = nodePositions.get(depId);
              if (!from || !to) return null;
              const fromX = from.x + 60;
              const fromY = from.y + 55;
              const toX = to.x + 60;
              const toY = to.y + 5;
              const isHighlighted =
                highlightedService === svc.id || highlightedService === depId;
              return (
                <line
                  key={`${svc.id}-${depId}`}
                  x1={fromX}
                  y1={fromY}
                  x2={toX}
                  y2={toY}
                  stroke={isHighlighted ? '#007acc' : '#3e3e42'}
                  strokeWidth={isHighlighted ? 2 : 1}
                  markerEnd="url(#arrowhead)"
                />
              );
            }),
          )}
        </svg>

        {/* Nodes */}
        {services.map((svc) => {
          const pos = nodePositions.get(svc.id);
          if (!pos) return null;
          const isSelected = selectedService === svc.id;
          const isHighlighted = highlightedService === svc.id;

          return (
            <div
              key={svc.id}
              style={{
                ...styles.serviceNode,
                left: pos.x,
                top: pos.y,
                ...(isSelected || isHighlighted ? styles.nodeSelected : {}),
              }}
              onClick={() => setSelectedService(isSelected ? null : svc.id)}
              onMouseEnter={() => setHighlightedService(svc.id)}
              onMouseLeave={() => setHighlightedService(null)}
            >
              <div
                style={{
                  ...styles.healthDot,
                  backgroundColor: healthColors[svc.health],
                }}
                title={svc.health}
              />
              <span style={styles.nodeName}>{svc.name}</span>
              <span style={styles.nodeTeam}>{svc.team}</span>
            </div>
          );
        })}
      </div>

      {/* Node detail panel */}
      {selectedNode && (
        <div style={styles.nodeDetail}>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>Service</span>
            <span style={styles.detailValue}>{selectedNode.name}</span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>Team</span>
            <span style={styles.detailValue}>{selectedNode.team}</span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>Owners</span>
            <span style={styles.detailValue}>{selectedNode.owners.join(', ')}</span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>Health</span>
            <span style={{ ...styles.detailValue, color: healthColors[selectedNode.health] }}>
              {selectedNode.health}
            </span>
          </div>
          {selectedNode.slackChannel && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Slack</span>
              <span style={{ ...styles.detailValue, color: '#007acc' }}>
                {selectedNode.slackChannel}
              </span>
            </div>
          )}
          {selectedNode.lastIncident && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Last Incident</span>
              <span style={styles.detailValue}>{selectedNode.lastIncident}</span>
            </div>
          )}
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>Dependencies</span>
            <span style={styles.detailValue}>
              {selectedNode.dependencies.length > 0
                ? selectedNode.dependencies.join(', ')
                : 'None'}
            </span>
          </div>
        </div>
      )}

      {/* Ownership Table */}
      <div style={{ padding: '10px 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#858585', textTransform: 'uppercase' as const, letterSpacing: 0.6 }}>
          Ownership Table
        </span>
      </div>
      <div style={styles.searchWrapper}>
        <input
          style={{ ...styles.searchInput, margin: 0, width: '100%' }}
          placeholder="Filter services, teams, owners..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <div style={{ overflowX: 'auto' as const }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th} onClick={() => handleSort('service')}>
                Service {sortColumn === 'service' ? (sortAsc ? '\u25B2' : '\u25BC') : ''}
              </th>
              <th style={styles.th} onClick={() => handleSort('team')}>
                Team {sortColumn === 'team' ? (sortAsc ? '\u25B2' : '\u25BC') : ''}
              </th>
              <th style={styles.th} onClick={() => handleSort('owners')}>
                Owners {sortColumn === 'owners' ? (sortAsc ? '\u25B2' : '\u25BC') : ''}
              </th>
              <th style={styles.th}>Slack</th>
              <th style={styles.th} onClick={() => handleSort('lastIncident')}>
                Last Incident {sortColumn === 'lastIncident' ? (sortAsc ? '\u25B2' : '\u25BC') : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredServices.map((svc) => (
              <tr
                key={svc.id}
                style={{
                  ...styles.tableRow,
                  backgroundColor: highlightedService === svc.id ? '#2d2d2d' : 'transparent',
                }}
                onClick={() => {
                  setSelectedService(svc.id);
                  setHighlightedService(svc.id);
                }}
                onMouseEnter={() => setHighlightedService(svc.id)}
                onMouseLeave={() => setHighlightedService(null)}
              >
                <td style={styles.td}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: healthColors[svc.health],
                        flexShrink: 0,
                      }}
                    />
                    {svc.name}
                  </span>
                </td>
                <td style={styles.td}>{svc.team}</td>
                <td style={styles.td}>{svc.owners.join(', ')}</td>
                <td style={{ ...styles.td, color: '#007acc', fontSize: 11 }}>
                  {svc.slackChannel || '-'}
                </td>
                <td style={{ ...styles.td, color: svc.lastIncident ? '#cca700' : '#585858', fontSize: 11 }}>
                  {svc.lastIncident || 'None'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  const renderExpertise = () => (
    <>
      <div style={styles.searchWrapper}>
        <input
          style={{ ...styles.searchInput, margin: 0, width: '100%' }}
          placeholder="Who knows about... (search by person or file path)"
          value={expertiseQuery}
          onChange={(e) => setExpertiseQuery(e.target.value)}
        />
      </div>

      {filteredExperts.length === 0 ? (
        <div style={styles.emptyState}>
          <div>No expertise data found</div>
          <div style={styles.emptyHint}>
            Expertise is indexed from git history. Ensure the runtime has access to the repository.
          </div>
        </div>
      ) : (
        filteredExperts.map((expert, idx) => {
          const isExpanded = expandedExpert === expert.person;
          return (
            <div key={expert.person}>
              <div
                style={{
                  ...styles.expertItem,
                  backgroundColor: isExpanded ? '#252526' : 'transparent',
                }}
                onClick={() => setExpandedExpert(isExpanded ? null : expert.person)}
              >
                <span style={styles.expertRank}>{idx + 1}</span>
                <span style={styles.expertName}>{expert.person}</span>
                <div style={styles.confidenceBar}>
                  <div
                    style={{
                      ...styles.confidenceFill,
                      width: `${Math.round(expert.confidence * 100)}%`,
                    }}
                  />
                </div>
                <span style={{ fontSize: 10, color: '#858585', marginRight: 10 }}>
                  {(expert.confidence * 100).toFixed(0)}%
                </span>
                <div style={styles.expertMeta as React.CSSProperties}>
                  <div>{expert.commitCount} commits</div>
                  <div>{expert.lastCommit}</div>
                </div>
              </div>
              {isExpanded && expert.areas && (
                <div style={styles.expertAreas}>
                  {expert.areas.map((area) => (
                    <span key={area} style={styles.areaTag}>
                      {area}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );

  const renderADRs = () => (
    <>
      {adrs.length === 0 ? (
        <div style={styles.emptyState}>
          <div>No architectural decisions recorded</div>
          <div style={styles.emptyHint}>
            ADRs can be added via the runtime or detected from ADR markdown files in your repository.
          </div>
        </div>
      ) : (
        adrs.map((adr) => {
          const isExpanded = expandedAdr === adr.id;
          const statusColor = adrStatusColors[adr.status] || '#858585';

          return (
            <div
              key={adr.id}
              style={{
                ...styles.adrItem,
                backgroundColor: isExpanded ? '#252526' : 'transparent',
              }}
              onClick={() => setExpandedAdr(isExpanded ? null : adr.id)}
            >
              <div style={styles.adrHeader}>
                <span style={styles.adrTitle}>{adr.title}</span>
                <span
                  style={{
                    ...styles.adrStatusBadge,
                    backgroundColor: statusColor + '22',
                    color: statusColor,
                    border: `1px solid ${statusColor}44`,
                  }}
                >
                  {adr.status}
                </span>
              </div>
              <div style={styles.adrMeta}>
                <span>{adr.date}</span>
                <span>by {adr.authors.join(', ')}</span>
              </div>

              {isExpanded && (
                <div style={styles.adrExpanded}>
                  <div style={styles.adrSection}>
                    <div style={styles.adrSectionLabel}>Context</div>
                    <div style={styles.adrSectionText}>{adr.context}</div>
                  </div>
                  <div style={styles.adrSection}>
                    <div style={styles.adrSectionLabel}>Decision</div>
                    <div style={styles.adrSectionText}>{adr.decision}</div>
                  </div>
                  <div style={styles.adrSection}>
                    <div style={styles.adrSectionLabel}>Consequences</div>
                    <div style={styles.adrSectionText}>{adr.consequences}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Knowledge Graph</span>
      </div>

      {/* Tab Bar */}
      <div style={styles.tabBar}>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'service-map' ? styles.tabActive : {}),
          }}
          onClick={() => setActiveTab('service-map')}
        >
          Service Map
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'expertise' ? styles.tabActive : {}),
          }}
          onClick={() => setActiveTab('expertise')}
        >
          Expertise
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'adrs' ? styles.tabActive : {}),
          }}
          onClick={() => setActiveTab('adrs')}
        >
          ADRs
        </button>
      </div>

      {/* Tab Content */}
      <div style={styles.scrollBody}>
        {activeTab === 'service-map' && renderServiceMap()}
        {activeTab === 'expertise' && renderExpertise()}
        {activeTab === 'adrs' && renderADRs()}
      </div>
    </div>
  );
};
