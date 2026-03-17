import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/app-store';
import { useRuntimeStore } from '../../store/runtime-store';
import { tauri, isTauri } from '../../bridge';

type SettingsSection = 'model' | 'integrations' | 'agents' | 'redaction' | 'privacy';

interface AgentConfig {
  name: string;
  enabled: boolean;
}

interface RedactionPattern {
  id: string;
  pattern: string;
  enabled: boolean;
  isCustom: boolean;
}

const sectionLabels: Record<SettingsSection, string> = {
  model: 'Model Config',
  integrations: 'Integrations',
  agents: 'Agents',
  redaction: 'Redaction',
  privacy: 'Privacy',
};

const sections: SettingsSection[] = ['model', 'integrations', 'agents', 'redaction', 'privacy'];

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
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden' as const,
  },
  nav: {
    width: 160,
    backgroundColor: '#252526',
    borderRight: '1px solid #3e3e42',
    padding: '8px 0',
  },
  navItem: {
    padding: '8px 16px',
    fontSize: 12,
    cursor: 'pointer',
    borderLeft: '2px solid transparent',
    color: '#858585',
  },
  navItemActive: {
    backgroundColor: '#2d2d2d',
    borderLeftColor: '#007acc',
    color: '#cccccc',
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 600 as const,
    color: '#cccccc',
    marginBottom: 16,
  },
  field: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 12,
    color: '#858585',
    marginBottom: 6,
    display: 'block' as const,
  },
  textInput: {
    width: '100%',
    maxWidth: 400,
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
  selectInput: {
    padding: '6px 10px',
    backgroundColor: '#2d2d2d',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    color: '#cccccc',
    fontSize: 12,
    fontFamily: 'inherit',
    outline: 'none',
    minWidth: 200,
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: '#2d2d2d',
    borderRadius: 4,
    border: '1px solid #3e3e42',
    marginBottom: 8,
    maxWidth: 400,
  },
  toggleLabel: {
    fontSize: 12,
    color: '#cccccc',
  },
  toggleSwitch: {
    width: 36,
    height: 18,
    borderRadius: 9,
    cursor: 'pointer',
    position: 'relative' as const,
    transition: 'background-color 0.2s ease',
  },
  toggleKnob: {
    position: 'absolute' as const,
    top: 2,
    width: 14,
    height: 14,
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    transition: 'left 0.2s ease',
  },
  description: {
    fontSize: 11,
    color: '#858585',
    marginTop: 4,
    lineHeight: '1.5',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '10px 16px',
    borderTop: '1px solid #3e3e42',
    backgroundColor: '#252526',
  },
  saveBtn: {
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
  resetBtn: {
    padding: '6px 20px',
    backgroundColor: 'transparent',
    color: '#858585',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  patternRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  patternInput: {
    flex: 1,
    padding: '4px 8px',
    backgroundColor: '#1e1e1e',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    color: '#cccccc',
    fontSize: 11,
    fontFamily: "'Menlo', monospace",
    outline: 'none',
  },
  addPatternBtn: {
    padding: '4px 10px',
    backgroundColor: '#007acc22',
    color: '#007acc',
    border: '1px solid #007acc44',
    borderRadius: 3,
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: 4,
  },
  removeBtn: {
    padding: '2px 6px',
    backgroundColor: 'transparent',
    color: '#f44747',
    border: '1px solid #f4474744',
    borderRadius: 3,
    fontSize: 10,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  connectionStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    backgroundColor: '#2d2d2d',
    borderRadius: 4,
    border: '1px solid #3e3e42',
    marginBottom: 12,
    maxWidth: 400,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  statusText: {
    fontSize: 12,
    color: '#cccccc',
  },
  saveStatus: {
    fontSize: 11,
    marginRight: 8,
  },
  integrationLink: {
    padding: '6px 12px',
    backgroundColor: '#007acc22',
    color: '#007acc',
    border: '1px solid #007acc44',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-block',
    marginTop: 8,
  },
};

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({
  value,
  onChange,
}) => (
  <div
    style={{
      ...styles.toggleSwitch,
      backgroundColor: value ? '#007acc' : '#3e3e42',
    }}
    onClick={() => onChange(!value)}
  >
    <div
      style={{
        ...styles.toggleKnob,
        left: value ? 20 : 2,
      }}
    />
  </div>
);

export const Settings: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('model');
  const { currentModel, setModel, focusMode, toggleFocusMode, setSidebarPanel } = useAppStore();
  const runtimeConnected = useRuntimeStore((s) => s.connected);
  const runtimeError = useRuntimeStore((s) => s.error);
  const integrations = useRuntimeStore((s) => s.integrations);

  // Local state for settings
  const [defaultModel, setDefaultModel] = useState(currentModel);
  const [apiKey, setApiKey] = useState('');
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [agentDir, setAgentDir] = useState('~/.aahi/agents');
  const [patterns, setPatterns] = useState<RedactionPattern[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [telemetry, setTelemetry] = useState(false);
  const [dataResidency, setDataResidency] = useState('us-east');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Sync model from app store
  useEffect(() => {
    setDefaultModel(currentModel);
  }, [currentModel]);

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      // Save model selection
      setModel(defaultModel);

      // Save API key to secure storage via Tauri
      if (apiKey && isTauri()) {
        await tauri.setSecret(`api-key-${defaultModel}`, apiKey);
      }

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleReset = () => {
    setDefaultModel(currentModel);
    setApiKey('');
    setSaveStatus('idle');
  };

  const toggleAgent = (name: string) => {
    setAgentConfigs((prev) =>
      prev.map((a) => (a.name === name ? { ...a, enabled: !a.enabled } : a))
    );
  };

  const togglePattern = (id: string) => {
    setPatterns((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
  };

  const addPattern = () => {
    if (!newPattern.trim()) return;
    setPatterns((prev) => [
      ...prev,
      { id: crypto.randomUUID(), pattern: newPattern.trim(), enabled: true, isCustom: true },
    ]);
    setNewPattern('');
  };

  const removePattern = (id: string) => {
    setPatterns((prev) => prev.filter((p) => p.id !== id));
  };

  const connectedIntegrationCount = (integrations || []).filter(
    (i) => i.connected
  ).length;

  const renderSection = () => {
    switch (activeSection) {
      case 'model':
        return (
          <>
            <div style={styles.sectionTitle}>Model Configuration</div>

            {/* Connection Status */}
            <div style={styles.connectionStatus}>
              <div
                style={{
                  ...styles.statusDot,
                  backgroundColor: runtimeConnected ? '#4ec9b0' : '#f44747',
                }}
              />
              <span style={styles.statusText}>
                Runtime: {runtimeConnected ? 'Connected' : 'Disconnected'}
              </span>
              {runtimeError && (
                <span style={{ fontSize: 11, color: '#f44747', marginLeft: 8 }}>
                  ({runtimeError})
                </span>
              )}
            </div>

            <div style={styles.field}>
              <label style={styles.fieldLabel}>Default Model</label>
              <select
                style={styles.selectInput}
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
              >
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-opus-4-6">Claude Opus 4.6</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              </select>
              <div style={styles.description}>
                Select the default model used for code generation and chat.
              </div>
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>API Key</label>
              <input
                style={styles.textInput}
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <div style={styles.description}>
                {isTauri()
                  ? 'Your API key is stored securely in the system keychain.'
                  : 'Your API key is stored locally and never sent to Aahi servers.'}
              </div>
            </div>
          </>
        );

      case 'integrations':
        return (
          <>
            <div style={styles.sectionTitle}>Integrations</div>

            <div style={styles.connectionStatus}>
              <div
                style={{
                  ...styles.statusDot,
                  backgroundColor: connectedIntegrationCount > 0 ? '#4ec9b0' : '#858585',
                }}
              />
              <span style={styles.statusText}>
                {connectedIntegrationCount} integration{connectedIntegrationCount !== 1 ? 's' : ''} connected
              </span>
            </div>

            <div style={{ fontSize: 13, color: '#858585', lineHeight: '1.6', marginBottom: 12 }}>
              Manage integrations from the Integration Hub panel. Connected integrations
              provide live data for timeline events, proactive alerts, and agent context.
            </div>

            {(integrations || [])
              .filter((i) => i.connected)
              .map((integ) => (
                <div
                  key={integ.id}
                  style={{
                    ...styles.toggle,
                    borderLeftColor: '#4ec9b0',
                    borderLeft: '3px solid #4ec9b0',
                  }}
                >
                  <span style={styles.toggleLabel}>
                    {'\u2699'} {integ.name}
                  </span>
                  <span style={{ fontSize: 10, color: '#4ec9b0' }}>Connected</span>
                </div>
              ))}

            <button
              style={styles.integrationLink}
              onClick={() => setSidebarPanel('integrations')}
            >
              Open Integration Hub
            </button>
          </>
        );

      case 'agents':
        return (
          <>
            <div style={styles.sectionTitle}>Agent Configuration</div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>Custom Agent Directory</label>
              <input
                style={styles.textInput}
                value={agentDir}
                onChange={(e) => setAgentDir(e.target.value)}
              />
              <div style={styles.description}>
                Path to directory containing custom agent definitions.
              </div>
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>Enable/Disable Agents</label>
              {agentConfigs.length === 0 ? (
                <div style={{ fontSize: 12, color: '#858585' }}>
                  No agents configured. Agents will appear here once the runtime provides them.
                </div>
              ) : (
                agentConfigs.map((agent) => (
                  <div key={agent.name} style={styles.toggle}>
                    <span style={styles.toggleLabel}>{agent.name}</span>
                    <Toggle value={agent.enabled} onChange={() => toggleAgent(agent.name)} />
                  </div>
                ))
              )}
            </div>
          </>
        );

      case 'redaction':
        return (
          <>
            <div style={styles.sectionTitle}>Redaction Rules</div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>Redaction Patterns</label>
              {patterns.map((p) => (
                <div key={p.id} style={styles.patternRow}>
                  <Toggle value={p.enabled} onChange={() => togglePattern(p.id)} />
                  <input
                    style={styles.patternInput}
                    value={p.pattern}
                    readOnly={!p.isCustom}
                    onChange={(e) => {
                      if (p.isCustom) {
                        setPatterns((prev) =>
                          prev.map((x) =>
                            x.id === p.id ? { ...x, pattern: e.target.value } : x
                          )
                        );
                      }
                    }}
                  />
                  {p.isCustom && (
                    <button style={styles.removeBtn} onClick={() => removePattern(p.id)}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input
                  style={{ ...styles.patternInput, maxWidth: 300 }}
                  placeholder="Add custom pattern (regex)..."
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPattern()}
                />
                <button style={styles.addPatternBtn} onClick={addPattern}>
                  Add
                </button>
              </div>
              <div style={styles.description}>
                Patterns matching sensitive data will be redacted before sending to AI models.
              </div>
            </div>
          </>
        );

      case 'privacy':
        return (
          <>
            <div style={styles.sectionTitle}>Privacy Settings</div>
            <div style={styles.field}>
              <div style={styles.toggle}>
                <span style={styles.toggleLabel}>Focus Mode</span>
                <Toggle value={focusMode} onChange={toggleFocusMode} />
              </div>
              <div style={styles.description}>
                Suppresses non-critical proactive alerts while you work.
              </div>
            </div>
            <div style={styles.field}>
              <div style={styles.toggle}>
                <span style={styles.toggleLabel}>Telemetry</span>
                <Toggle value={telemetry} onChange={(v) => setTelemetry(v)} />
              </div>
              <div style={styles.description}>
                Help improve Aahi by sending anonymous usage data.
              </div>
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>Data Residency</label>
              <select
                style={styles.selectInput}
                value={dataResidency}
                onChange={(e) => setDataResidency(e.target.value)}
              >
                <option value="us-east">US East</option>
                <option value="us-west">US West</option>
                <option value="eu-west">EU West</option>
                <option value="ap-southeast">AP Southeast</option>
              </select>
              <div style={styles.description}>
                Region where your data is processed and stored.
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Settings</span>
      </div>

      <div style={styles.body}>
        <div style={styles.nav}>
          {sections.map((section) => (
            <div
              key={section}
              style={{
                ...styles.navItem,
                ...(activeSection === section ? styles.navItemActive : {}),
              }}
              onClick={() => setActiveSection(section)}
            >
              {sectionLabels[section]}
            </div>
          ))}
        </div>

        <div style={styles.content}>{renderSection()}</div>
      </div>

      <div style={styles.footer}>
        {saveStatus === 'saved' && (
          <span style={{ ...styles.saveStatus, color: '#4ec9b0' }}>Settings saved</span>
        )}
        {saveStatus === 'error' && (
          <span style={{ ...styles.saveStatus, color: '#f44747' }}>Failed to save</span>
        )}
        <button style={styles.resetBtn} onClick={handleReset}>
          Reset
        </button>
        <button
          style={{
            ...styles.saveBtn,
            opacity: saveStatus === 'saving' ? 0.6 : 1,
          }}
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
        >
          {saveStatus === 'saving' ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
};
