import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../../store/app-store';
import { useRuntimeStore } from '../../store/runtime-store';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

const SLASH_COMMANDS = [
  { command: '/explain', description: 'Explain selected code' },
  { command: '/fix', description: 'Fix errors in selection' },
  { command: '/refactor', description: 'Refactor selected code' },
  { command: '/test', description: 'Generate tests' },
  { command: '/doc', description: 'Generate documentation' },
  { command: '/deploy', description: 'Deploy to environment' },
  { command: '/debug', description: 'Start debug agent' },
  { command: '/timeline', description: 'Show event timeline' },
];

const AT_MENTIONS = [
  { name: '@file', description: 'Reference a file' },
  { name: '@selection', description: 'Current editor selection' },
  { name: '@terminal', description: 'Terminal output' },
  { name: '@git', description: 'Git context' },
  { name: '@logs', description: 'Application logs' },
  { name: '@traces', description: 'Distributed traces' },
  { name: '@metrics', description: 'System metrics' },
  { name: '@incident', description: 'Active incident' },
];

const styles = {
  container: {
    borderTop: '1px solid #3e3e42',
    padding: 12,
    position: 'relative' as const,
  },
  inputWrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    backgroundColor: '#1e1e1e',
    border: '1px solid #3e3e42',
    borderRadius: 6,
    overflow: 'hidden',
  },
  textarea: {
    width: '100%',
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#cccccc',
    fontSize: 13,
    fontFamily: 'inherit',
    padding: '10px 12px',
    resize: 'none' as const,
    minHeight: 38,
    maxHeight: 160,
    lineHeight: '1.5',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 8px 6px',
  },
  modelBadge: {
    fontSize: 10,
    color: '#858585',
    backgroundColor: '#2d2d2d',
    padding: '2px 6px',
    borderRadius: 3,
  },
  hint: {
    fontSize: 11,
    color: '#585858',
  },
  streamingHint: {
    fontSize: 11,
    color: '#cca700',
  },
  autocomplete: {
    position: 'absolute' as const,
    bottom: '100%',
    left: 12,
    right: 12,
    marginBottom: 4,
    backgroundColor: '#252526',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    boxShadow: '0 -4px 16px rgba(0,0,0,0.3)',
    maxHeight: 200,
    overflowY: 'auto' as const,
    zIndex: 10,
  },
  autocompleteItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 13,
    color: '#cccccc',
  },
  autocompleteDesc: {
    fontSize: 11,
    color: '#858585',
  },
};

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled = false }) => {
  const [value, setValue] = useState('');
  const [showSlash, setShowSlash] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [showFileList, setShowFileList] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentModel = useAppStore((s) => s.currentModel);
  const chatStreaming = useRuntimeStore((s) => s.chatStreaming);

  // File tree for @file: autocomplete — flatten tree entries for search
  const fileTree = useRuntimeStore((s) => s.fileTree) as Array<{ path: string; name: string; isDir?: boolean }> | undefined;

  // Filter autocomplete items
  const slashFiltered = SLASH_COMMANDS.filter((c) =>
    c.command.startsWith(value.toLowerCase())
  );
  const mentionFiltered = AT_MENTIONS.filter((m) => {
    const lastAt = value.lastIndexOf('@');
    if (lastAt === -1) return true;
    const query = value.slice(lastAt).toLowerCase();
    return m.name.toLowerCase().startsWith(query);
  });

  // File list filtering for @file:
  const fileFiltered = (fileTree || []).filter((f) => {
    const lastAt = value.lastIndexOf('@file:');
    if (lastAt === -1) return true;
    const query = value.slice(lastAt + 6).toLowerCase();
    return f.path.toLowerCase().includes(query) || f.name.toLowerCase().includes(query);
  }).slice(0, 15);

  const activeItems = showSlash
    ? slashFiltered
    : showFileList
      ? fileFiltered.map((f) => ({ name: `@file:${f.path}`, description: f.name }))
      : showMentions
        ? mentionFiltered
        : [];

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);

    // Detect @file: for file autocomplete
    if (v.includes('@file:')) {
      setShowFileList(true);
      setShowSlash(false);
      setShowMentions(false);
      setSelectedIndex(0);
      return;
    } else {
      setShowFileList(false);
    }

    // Detect slash commands at the beginning
    if (v.startsWith('/')) {
      setShowSlash(true);
      setShowMentions(false);
      setSelectedIndex(0);
    } else {
      setShowSlash(false);
    }

    // Detect @ mentions
    const lastChar = v[v.length - 1];
    if (lastChar === '@') {
      setShowMentions(true);
      setShowSlash(false);
      setSelectedIndex(0);
    } else if (showMentions && (lastChar === ' ' || !v.includes('@'))) {
      setShowMentions(false);
    }
  };

  const insertAutocomplete = useCallback(
    (text: string) => {
      if (showSlash) {
        setValue(text + ' ');
        setShowSlash(false);
      } else if (showFileList) {
        const lastAt = value.lastIndexOf('@file:');
        const before = value.slice(0, lastAt);
        setValue(before + text + ' ');
        setShowFileList(false);
      } else if (showMentions) {
        const lastAt = value.lastIndexOf('@');
        const before = value.slice(0, lastAt);
        setValue(before + text + ' ');
        setShowMentions(false);
      }
      textareaRef.current?.focus();
    },
    [showSlash, showMentions, showFileList, value]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Autocomplete navigation
      if (activeItems.length > 0 && (showSlash || showMentions || showFileList)) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((i) => (i > 0 ? i - 1 : activeItems.length - 1));
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((i) => (i < activeItems.length - 1 ? i + 1 : 0));
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          const item = activeItems[selectedIndex];
          if (item) {
            insertAutocomplete('command' in item ? item.command : item.name);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowSlash(false);
          setShowMentions(false);
          setShowFileList(false);
          return;
        }
      }

      // Send message on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (value.trim() && !disabled) {
          onSend(value.trim());
          setValue('');
          setShowSlash(false);
          setShowMentions(false);
          setShowFileList(false);
        }
      }
    },
    [value, disabled, onSend, activeItems, selectedIndex, showSlash, showMentions, showFileList, insertAutocomplete]
  );

  const isDisabled = disabled || chatStreaming;

  return (
    <div style={styles.container}>
      {/* Autocomplete dropdown */}
      {activeItems.length > 0 && (showSlash || showMentions || showFileList) && (
        <div style={styles.autocomplete}>
          {activeItems.map((item, i) => {
            const label = 'command' in item ? item.command : item.name;
            return (
              <div
                key={label}
                style={{
                  ...styles.autocompleteItem,
                  backgroundColor: i === selectedIndex ? '#007acc33' : 'transparent',
                }}
                onClick={() => insertAutocomplete(label)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span>{label}</span>
                <span style={styles.autocompleteDesc}>{item.description}</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={styles.inputWrapper}>
        <textarea
          ref={textareaRef}
          style={{
            ...styles.textarea,
            opacity: isDisabled ? 0.6 : 1,
          }}
          placeholder={
            isDisabled
              ? 'Waiting for response...'
              : 'Ask Aahi anything... (@ to mention, / for commands)'
          }
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          rows={1}
        />
        <div style={styles.footer}>
          <span style={styles.modelBadge}>{currentModel}</span>
          {chatStreaming ? (
            <span style={styles.streamingHint}>Streaming...</span>
          ) : (
            <span style={styles.hint}>Enter to send, Shift+Enter for newline</span>
          )}
        </div>
      </div>
    </div>
  );
};
