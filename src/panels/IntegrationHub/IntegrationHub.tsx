import React, { useState, useEffect } from 'react';
import { useRuntimeStore } from '../../store/runtime-store';

type IntegrationCategory = 'DevOps' | 'Observability' | 'Collaboration' | 'Infrastructure' | 'Security' | 'Other';
type IntegrationStatus = 'connected' | 'disconnected' | 'error';
type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

const statusColors: Record<IntegrationStatus, string> = {
  connected: '#4ec9b0',
  disconnected: '#858585',
  error: '#f44747',
};

const healthColors: Record<HealthStatus, string> = {
  healthy: '#4ec9b0',
  degraded: '#cca700',
  down: '#f44747',
  unknown: '#858585',
};

const healthLabels: Record<HealthStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Unknown',
};

const categories: IntegrationCategory[] = [
  'DevOps',
  'Observability',
  'Collaboration',
  'Infrastructure',
  'Security',
  'Other',
];

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
  searchBar: {
    padding: '8px 12px',
    borderBottom: '1px solid #3e3e42',
  },
  searchInput: {
    width: '100%',
    padding: '6px 10px',
    backgroundColor: '#2d2d2d',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    color: '#cccccc',
    fontSize: 12,
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  filters: {
    display: 'flex',
    gap: 6,
    padding: '8px 12px',
    borderBottom: '1px solid #3e3e42',
    flexWrap: 'wrap' as const,
  },
  filterChip: {
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 11,
    cursor: 'pointer',
    border: '1px solid #3e3e42',
    backgroundColor: 'transparent',
    color: '#858585',
    fontFamily: 'inherit',
  },
  filterChipActive: {
    backgroundColor: '#007acc22',
    borderColor: '#007acc',
    color: '#007acc',
  },
  grid: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 12,
    alignContent: 'start' as const,
  },
  card: {
    backgroundColor: '#2d2d2d',
    border: '1px solid #3e3e42',
    borderRadius: 6,
    padding: 14,
    cursor: 'pointer',
    transition: 'border-color 0.15s ease',
    minWidth: 200,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  cardIcon: {
    fontSize: 20,
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e1e1e',
    borderRadius: 6,
  },
  cardName: {
    fontSize: 13,
    fontWeight: 600 as const,
    color: '#cccccc',
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  cardCategory: {
    fontSize: 10,
    color: '#858585',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  cardDescription: {
    fontSize: 11,
    color: '#858585',
    lineHeight: '1.5',
    marginBottom: 10,
  },
  cardFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  healthBadge: {
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 3,
  },
  connectBtn: {
    padding: '4px 10px',
    borderRadius: 3,
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit',
    border: 'none',
    fontWeight: 500 as const,
  },
  modal: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#00000088',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: '#252526',
    border: '1px solid #3e3e42',
    borderRadius: 8,
    padding: 24,
    minWidth: 340,
    maxWidth: 480,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 600 as const,
    color: '#cccccc',
    marginBottom: 16,
  },
  modalText: {
    fontSize: 13,
    color: '#858585',
    marginBottom: 20,
    lineHeight: '1.6',
  },
  modalInput: {
    width: '100%',
    padding: '8px 10px',
    backgroundColor: '#1e1e1e',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    color: '#cccccc',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box' as const,
    marginBottom: 12,
  },
  modalLabel: {
    fontSize: 12,
    color: '#858585',
    marginBottom: 6,
    display: 'block' as const,
  },
  modalActions: {
    display: 'flex',
    gap: 8,
    marginTop: 8,
  },
  modalConnectBtn: {
    padding: '6px 20px',
    backgroundColor: '#007acc',
    color: '#ffffff',
    border: 'none',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600 as const,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  modalCloseBtn: {
    padding: '6px 16px',
    backgroundColor: '#3e3e42',
    color: '#cccccc',
    border: 'none',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  loadingState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: '#858585',
    fontSize: 13,
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
  },
};

export const IntegrationHub: React.FC = () => {
  const integrations = useRuntimeStore((s) => s.integrations);
  const connectIntegration = useRuntimeStore((s) => s.connectIntegration);
  const loadIntegrations = useRuntimeStore((s) => s.loadIntegrations);
  const connected = useRuntimeStore((s) => s.connected);

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<IntegrationCategory | 'All'>('All');
  const [connectModal, setConnectModal] = useState<string | null>(null);
  const [tokenValue, setTokenValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  // Load integrations on mount
  useEffect(() => {
    if (connected) {
      setLoading(true);
      loadIntegrations().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [connected, loadIntegrations]);

  // Map IntegrationInfo (connected: boolean) to display-friendly status
  const integrationItems = (integrations || []).map((integ) => ({
    ...integ,
    status: (integ.connected ? 'connected' : 'disconnected') as IntegrationStatus,
    category: ((integ as Record<string, unknown>).category || 'Other') as IntegrationCategory,
    description: ((integ as Record<string, unknown>).description || '') as string,
    icon: ((integ as Record<string, unknown>).icon || '\u2699') as string,
  }));

  const filtered = integrationItems.filter((integ) => {
    const matchesSearch =
      integ.name.toLowerCase().includes(search.toLowerCase()) ||
      integ.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = activeCategory === 'All' || integ.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const modalIntegration = integrationItems.find((i) => i.id === connectModal);

  const handleConnect = async () => {
    if (!connectModal || !tokenValue.trim()) return;
    setConnecting(true);
    try {
      await connectIntegration(connectModal, { token: tokenValue.trim() });
      setConnectModal(null);
      setTokenValue('');
    } catch (err) {
      console.error('Failed to connect integration:', err);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (integrationId: string) => {
    try {
      // Use runtime request for disconnect if available
      const store = useRuntimeStore.getState();
      if ('disconnectIntegration' in store && typeof (store as Record<string, unknown>).disconnectIntegration === 'function') {
        await ((store as Record<string, unknown>).disconnectIntegration as (id: string) => Promise<void>)(integrationId);
      }
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>Integration Hub</span>
        </div>
        <div style={styles.loadingState}>Loading integrations...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Integration Hub</span>
        <span style={{ fontSize: 11, color: '#858585' }}>
          {integrationItems.filter((i) => i.status === 'connected').length}/
          {integrationItems.length} connected
        </span>
      </div>

      <div style={styles.searchBar}>
        <input
          style={styles.searchInput}
          placeholder="Search integrations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={styles.filters}>
        <button
          style={{
            ...styles.filterChip,
            ...(activeCategory === 'All' ? styles.filterChipActive : {}),
          }}
          onClick={() => setActiveCategory('All')}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            style={{
              ...styles.filterChip,
              ...(activeCategory === cat ? styles.filterChipActive : {}),
            }}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={styles.emptyState}>
          <span>No integrations found</span>
          {!connected && (
            <span style={{ fontSize: 11 }}>Connect to runtime to load integrations</span>
          )}
        </div>
      ) : (
        <div style={styles.grid}>
          {filtered.map((integ) => (
            <div
              key={integ.id}
              style={styles.card}
              onClick={() => {
                if (integ.status !== 'connected') {
                  setConnectModal(integ.id);
                }
              }}
            >
              <div style={styles.cardHeader}>
                <div style={styles.cardIcon}>{integ.icon || '\u2699'}</div>
                <span style={styles.cardName}>{integ.name}</span>
                <div
                  style={{
                    ...styles.statusDot,
                    backgroundColor: statusColors[integ.status as IntegrationStatus] || '#858585',
                  }}
                />
              </div>
              <div style={styles.cardCategory}>{integ.category}</div>
              <div style={styles.cardDescription}>{integ.description}</div>
              <div style={styles.cardFooter}>
                {integ.status === 'connected' ? (
                  <span
                    style={{
                      ...styles.healthBadge,
                      backgroundColor: healthColors[(integ.health as HealthStatus) || 'unknown'] + '22',
                      color: healthColors[(integ.health as HealthStatus) || 'unknown'],
                    }}
                  >
                    {healthLabels[(integ.health as HealthStatus) || 'unknown']}
                  </span>
                ) : (
                  <span />
                )}
                <button
                  style={{
                    ...styles.connectBtn,
                    backgroundColor:
                      integ.status === 'connected' ? '#3e3e42' : '#007acc',
                    color: integ.status === 'connected' ? '#cccccc' : '#ffffff',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (integ.status === 'connected') {
                      handleDisconnect(integ.id);
                    } else {
                      setConnectModal(integ.id);
                    }
                  }}
                >
                  {integ.status === 'connected' ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Connect Modal */}
      {connectModal && modalIntegration && (
        <div style={styles.modal} onClick={() => setConnectModal(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>
              Connect {modalIntegration.name}
            </div>
            <div style={styles.modalText}>
              Enter your API key or token to connect {modalIntegration.name}.
            </div>
            <label style={styles.modalLabel}>API Key / Token</label>
            <input
              style={styles.modalInput}
              type="password"
              placeholder="Enter API key or token..."
              value={tokenValue}
              onChange={(e) => setTokenValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              autoFocus
            />
            <div style={styles.modalActions}>
              <button
                style={{
                  ...styles.modalConnectBtn,
                  opacity: connecting || !tokenValue.trim() ? 0.5 : 1,
                }}
                onClick={handleConnect}
                disabled={connecting || !tokenValue.trim()}
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
              <button
                style={styles.modalCloseBtn}
                onClick={() => {
                  setConnectModal(null);
                  setTokenValue('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
