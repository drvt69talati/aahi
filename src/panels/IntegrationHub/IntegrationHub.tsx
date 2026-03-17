import React, { useState } from 'react';

type IntegrationCategory = 'DevOps' | 'Observability' | 'Collaboration' | 'Infrastructure' | 'Security' | 'Other';
type IntegrationStatus = 'connected' | 'disconnected' | 'error';
type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

interface Integration {
  id: string;
  name: string;
  icon: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  health: HealthStatus;
  description: string;
}

interface IntegrationHubProps {
  integrations: Integration[];
  onConnect: (integrationId: string) => void;
  onDisconnect: (integrationId: string) => void;
  onConfigure: (integrationId: string) => void;
}

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
    gridTemplateColumns: 'repeat(auto-fill, minmax(220, 1fr))',
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
};

export const IntegrationHub: React.FC<IntegrationHubProps> = ({
  integrations,
  onConnect,
  onDisconnect,
  onConfigure,
}) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<IntegrationCategory | 'All'>('All');
  const [configModal, setConfigModal] = useState<string | null>(null);

  const filtered = integrations.filter((integ) => {
    const matchesSearch =
      integ.name.toLowerCase().includes(search.toLowerCase()) ||
      integ.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = activeCategory === 'All' || integ.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const modalIntegration = integrations.find((i) => i.id === configModal);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Integration Hub</span>
        <span style={{ fontSize: 11, color: '#858585' }}>
          {integrations.filter((i) => i.status === 'connected').length}/{integrations.length}{' '}
          connected
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

      <div style={styles.grid}>
        {filtered.map((integ) => (
          <div
            key={integ.id}
            style={{
              ...styles.card,
              borderColor: integ.status === 'connected' ? '#3e3e42' : '#3e3e42',
            }}
            onClick={() => {
              setConfigModal(integ.id);
              onConfigure(integ.id);
            }}
          >
            <div style={styles.cardHeader}>
              <div style={styles.cardIcon}>{integ.icon}</div>
              <span style={styles.cardName}>{integ.name}</span>
              <div
                style={{
                  ...styles.statusDot,
                  backgroundColor: statusColors[integ.status],
                }}
              />
            </div>
            <div style={styles.cardCategory}>{integ.category}</div>
            <div style={styles.cardDescription}>{integ.description}</div>
            <div style={styles.cardFooter}>
              {integ.status === 'connected' && (
                <span
                  style={{
                    ...styles.healthBadge,
                    backgroundColor: healthColors[integ.health] + '22',
                    color: healthColors[integ.health],
                  }}
                >
                  {healthLabels[integ.health]}
                </span>
              )}
              {integ.status !== 'connected' && <span />}
              <button
                style={{
                  ...styles.connectBtn,
                  backgroundColor:
                    integ.status === 'connected' ? '#3e3e42' : '#007acc',
                  color: integ.status === 'connected' ? '#cccccc' : '#ffffff',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  integ.status === 'connected'
                    ? onDisconnect(integ.id)
                    : onConnect(integ.id);
                }}
              >
                {integ.status === 'connected' ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {configModal && modalIntegration && (
        <div style={styles.modal} onClick={() => setConfigModal(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>
              {modalIntegration.icon} {modalIntegration.name}
            </div>
            <div style={styles.modalText}>
              Configure your {modalIntegration.name} integration settings here. This is a
              placeholder for the configuration form.
            </div>
            <button style={styles.modalCloseBtn} onClick={() => setConfigModal(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
