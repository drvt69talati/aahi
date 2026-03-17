import React, { useState } from 'react';
import { useAppStore } from '../store/app-store';
import { ModelPicker } from './ModelPicker';

const styles = {
  topBar: {
    display: 'flex',
    alignItems: 'center',
    height: 38,
    backgroundColor: '#2d2d2d',
    borderBottom: '1px solid #3e3e42',
    padding: '0 12px',
    gap: 12,
    userSelect: 'none' as const,
    WebkitAppRegion: 'drag' as const,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    fontWeight: 700,
    color: '#4ec9b0',
    letterSpacing: 1.5,
    WebkitAppRegion: 'no-drag' as const,
  },
  hexIcon: {
    fontSize: 16,
  },
  spacer: {
    flex: 1,
  },
  workspaceBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    backgroundColor: 'transparent',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    color: '#cccccc',
    fontSize: 12,
    cursor: 'pointer',
    WebkitAppRegion: 'no-drag' as const,
  },
  incidentBadge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    height: 20,
    padding: '0 6px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    WebkitAppRegion: 'no-drag' as const,
  },
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 3,
    color: '#858585',
    fontSize: 14,
    cursor: 'pointer',
    WebkitAppRegion: 'no-drag' as const,
  },
  focusToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    fontSize: 11,
    cursor: 'pointer',
    WebkitAppRegion: 'no-drag' as const,
  },
};

export const TopBar: React.FC = () => {
  const {
    currentWorkspace,
    activeIncidentCount,
    focusMode,
    toggleFocusMode,
  } = useAppStore();
  const [showModelPicker, setShowModelPicker] = useState(false);

  return (
    <div style={styles.topBar}>
      <div style={styles.logo}>
        <span style={styles.hexIcon}>⬡</span>
        <span>AAHI</span>
      </div>

      <div style={{ position: 'relative', WebkitAppRegion: 'no-drag' as const }}>
        <button
          style={styles.workspaceBtn}
          onClick={() => setShowModelPicker(!showModelPicker)}
        >
          <span style={{ color: '#858585', fontSize: 11 }}>Model:</span>
          <span>{useAppStore.getState().currentModel}</span>
          <span style={{ color: '#858585' }}>▾</span>
        </button>
        {showModelPicker && (
          <ModelPicker onClose={() => setShowModelPicker(false)} />
        )}
      </div>

      <button style={styles.workspaceBtn}>
        <span style={{ color: '#858585', fontSize: 11 }}>Workspace:</span>
        <span>{currentWorkspace}</span>
        <span style={{ color: '#858585' }}>▾</span>
      </button>

      <div style={styles.spacer} />

      <div
        style={{
          ...styles.incidentBadge,
          backgroundColor: activeIncidentCount > 0 ? '#f44747' : '#3e3e42',
          color: activeIncidentCount > 0 ? '#ffffff' : '#858585',
        }}
        title="Active incidents"
      >
        {activeIncidentCount > 0 ? `${activeIncidentCount} incidents` : '0'}
      </div>

      <button
        style={{
          ...styles.focusToggle,
          backgroundColor: focusMode ? '#007acc33' : 'transparent',
          color: focusMode ? '#007acc' : '#858585',
        }}
        onClick={toggleFocusMode}
        title="Focus Mode — suppress proactive alerts"
      >
        {focusMode ? '◉' : '○'} Focus
      </button>

      <button style={styles.iconBtn} title="Settings">
        ⚙
      </button>
    </div>
  );
};
