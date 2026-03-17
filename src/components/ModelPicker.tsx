import React from 'react';
import { useAppStore } from '../store/app-store';

interface ModelInfo {
  id: string;
  name: string;
  capabilities: string[];
}

interface ProviderGroup {
  provider: string;
  models: ModelInfo[];
}

const MODEL_GROUPS: ProviderGroup[] = [
  {
    provider: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', capabilities: ['chat', 'vision', 'reasoning'] },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', capabilities: ['chat', 'vision', 'reasoning'] },
      { id: 'claude-haiku-3-5', name: 'Claude Haiku 3.5', capabilities: ['chat', 'vision'] },
    ],
  },
  {
    provider: 'OpenAI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', capabilities: ['chat', 'vision'] },
      { id: 'o3', name: 'o3', capabilities: ['chat', 'reasoning'] },
      { id: 'o4-mini', name: 'o4-mini', capabilities: ['chat', 'reasoning'] },
    ],
  },
  {
    provider: 'Ollama (Local)',
    models: [
      { id: 'ollama/llama3', name: 'Llama 3', capabilities: ['chat'] },
      { id: 'ollama/codellama', name: 'Code Llama', capabilities: ['chat'] },
      { id: 'ollama/deepseek-coder', name: 'DeepSeek Coder', capabilities: ['chat'] },
    ],
  },
  {
    provider: 'Google',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', capabilities: ['chat', 'vision', 'reasoning'] },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', capabilities: ['chat', 'vision'] },
    ],
  },
];

const capabilityColors: Record<string, string> = {
  chat: '#4ec9b0',
  vision: '#569cd6',
  reasoning: '#dcdcaa',
};

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    marginTop: 4,
    width: 320,
    backgroundColor: '#252526',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    zIndex: 1000,
    maxHeight: 400,
    overflowY: 'auto' as const,
  },
  providerHeader: {
    padding: '8px 12px 4px',
    fontSize: 11,
    fontWeight: 600,
    color: '#858585',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  modelItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: 13,
    color: '#cccccc',
  },
  modelName: {
    flex: 1,
  },
  badges: {
    display: 'flex',
    gap: 4,
  },
  badge: {
    padding: '1px 5px',
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 500,
  },
  selected: {
    backgroundColor: '#007acc33',
  },
  separator: {
    height: 1,
    backgroundColor: '#3e3e42',
    margin: '4px 0',
  },
};

interface ModelPickerProps {
  onClose: () => void;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({ onClose }) => {
  const { currentModel, setModel } = useAppStore();

  const handleSelect = (modelId: string) => {
    setModel(modelId);
    onClose();
  };

  return (
    <>
      <div style={styles.overlay} onClick={onClose} />
      <div style={styles.dropdown}>
        {MODEL_GROUPS.map((group, gi) => (
          <div key={group.provider}>
            {gi > 0 && <div style={styles.separator} />}
            <div style={styles.providerHeader}>{group.provider}</div>
            {group.models.map((model) => (
              <div
                key={model.id}
                style={{
                  ...styles.modelItem,
                  ...(currentModel === model.id ? styles.selected : {}),
                }}
                onClick={() => handleSelect(model.id)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    currentModel === model.id ? '#007acc44' : '#2a2d2e';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    currentModel === model.id ? '#007acc33' : 'transparent';
                }}
              >
                <span style={styles.modelName}>
                  {currentModel === model.id && '✓ '}
                  {model.name}
                </span>
                <div style={styles.badges}>
                  {model.capabilities.map((cap) => (
                    <span
                      key={cap}
                      style={{
                        ...styles.badge,
                        backgroundColor: (capabilityColors[cap] || '#858585') + '22',
                        color: capabilityColors[cap] || '#858585',
                      }}
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
};
