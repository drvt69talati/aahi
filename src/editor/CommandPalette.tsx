import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAppStore } from '../store/app-store';
import { useRuntimeStore } from '../store/runtime-store';

/* ── Command definition ── */
interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category: 'slash' | 'editor' | 'file' | 'view';
  action: () => void;
}

/* ── Fuzzy match ── */
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // Exact prefix is best
  if (t.startsWith(q)) return 3;
  // Contains substring
  if (t.includes(q)) return 2;
  // Fuzzy match
  return 1;
}

/* ── Styles ── */
const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    display: 'flex',
    justifyContent: 'center',
    paddingTop: 80,
  },
  container: {
    width: 560,
    maxHeight: 420,
    backgroundColor: '#252526',
    border: '1px solid #3e3e42',
    borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  inputContainer: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid #3e3e42',
    gap: 8,
  },
  inputIcon: {
    color: '#858585',
    fontSize: 14,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#cccccc',
    fontSize: 14,
    fontFamily: 'inherit',
    padding: '4px 0',
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 16px',
    cursor: 'pointer',
    fontSize: 13,
    color: '#cccccc',
  },
  itemActive: {
    backgroundColor: '#04395e',
  },
  itemLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  categoryBadge: {
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 3,
    fontWeight: 500,
  },
  shortcut: {
    fontSize: 11,
    color: '#858585',
    fontFamily: "'Menlo', 'Monaco', monospace",
  },
  noResults: {
    padding: '24px 16px',
    textAlign: 'center' as const,
    color: '#585858',
    fontSize: 13,
  },
};

const categoryColors: Record<string, string> = {
  slash: '#4ec9b0',
  editor: '#569cd6',
  file: '#dcdcaa',
  view: '#c586c0',
};

/* ── Main component ── */
interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const appStore = useAppStore();

  /* ── Build command list ── */
  const commands: Command[] = useMemo(
    () => [
      // Slash commands
      { id: '/debug', label: '/debug', category: 'slash' as const, action: () => console.log('[Aahi] /debug') },
      { id: '/deploy', label: '/deploy', category: 'slash' as const, action: () => console.log('[Aahi] /deploy') },
      { id: '/review', label: '/review', category: 'slash' as const, action: () => console.log('[Aahi] /review') },
      { id: '/security', label: '/security', category: 'slash' as const, action: () => console.log('[Aahi] /security') },
      { id: '/incident', label: '/incident', category: 'slash' as const, action: () => console.log('[Aahi] /incident') },
      { id: '/cost', label: '/cost', category: 'slash' as const, action: () => console.log('[Aahi] /cost') },
      { id: '/query', label: '/query', category: 'slash' as const, action: () => console.log('[Aahi] /query') },
      { id: '/impact', label: '/impact', category: 'slash' as const, action: () => console.log('[Aahi] /impact') },
      { id: '/timeline', label: '/timeline', category: 'slash' as const, action: () => console.log('[Aahi] /timeline') },
      { id: '/who-owns', label: '/who-owns', category: 'slash' as const, action: () => console.log('[Aahi] /who-owns') },
      { id: '/onboard', label: '/onboard', category: 'slash' as const, action: () => console.log('[Aahi] /onboard') },
      { id: '/flag', label: '/flag', category: 'slash' as const, action: () => console.log('[Aahi] /flag') },
      { id: '/release', label: '/release', category: 'slash' as const, action: () => console.log('[Aahi] /release') },
      { id: '/oncall', label: '/oncall', category: 'slash' as const, action: () => console.log('[Aahi] /oncall') },
      { id: '/scaffold', label: '/scaffold', category: 'slash' as const, action: () => console.log('[Aahi] /scaffold') },

      // Editor commands
      {
        id: 'editor.save',
        label: 'Save',
        shortcut: 'Cmd+S',
        category: 'editor' as const,
        action: () => {
          const state = useRuntimeStore.getState();
          if (state.activeFilePath) {
            const file = state.openFiles.get(state.activeFilePath);
            if (file) state.saveFile(state.activeFilePath, file.content);
          }
        },
      },
      {
        id: 'editor.saveAll',
        label: 'Save All',
        shortcut: 'Cmd+Shift+S',
        category: 'editor' as const,
        action: () => {
          const state = useRuntimeStore.getState();
          state.openFiles.forEach((file, path) => {
            if (file.dirty) state.saveFile(path, file.content);
          });
        },
      },
      { id: 'editor.format', label: 'Format Document', shortcut: 'Shift+Alt+F', category: 'editor' as const, action: () => console.log('[Aahi] Format') },
      {
        id: 'editor.toggleSidebar',
        label: 'Toggle Sidebar',
        shortcut: 'Cmd+B',
        category: 'editor' as const,
        action: () => appStore.toggleLeftSidebar(),
      },
      {
        id: 'editor.toggleChat',
        label: 'Toggle Chat',
        shortcut: 'Cmd+Shift+L',
        category: 'editor' as const,
        action: () => appStore.toggleRightPanel(),
      },
      {
        id: 'editor.toggleBottomPanel',
        label: 'Toggle Bottom Panel',
        shortcut: 'Cmd+J',
        category: 'editor' as const,
        action: () => appStore.toggleBottomPanel(),
      },

      // File commands
      { id: 'file.open', label: 'Open File', shortcut: 'Cmd+O', category: 'file' as const, action: () => console.log('[Aahi] Open File') },
      { id: 'file.new', label: 'New File', shortcut: 'Cmd+N', category: 'file' as const, action: () => console.log('[Aahi] New File') },
      {
        id: 'file.close',
        label: 'Close File',
        shortcut: 'Cmd+W',
        category: 'file' as const,
        action: () => {
          const state = useRuntimeStore.getState();
          if (state.activeFilePath) {
            const files = new Map(state.openFiles);
            files.delete(state.activeFilePath);
            const remaining = Array.from(files.keys());
            useRuntimeStore.setState({
              openFiles: files,
              activeFilePath: remaining.length > 0 ? remaining[remaining.length - 1] : null,
            });
          }
        },
      },
      {
        id: 'file.closeAll',
        label: 'Close All',
        category: 'file' as const,
        action: () => {
          useRuntimeStore.setState({ openFiles: new Map(), activeFilePath: null });
        },
      },

      // View commands
      {
        id: 'view.focusMode',
        label: 'Focus Mode',
        category: 'view' as const,
        action: () => appStore.toggleFocusMode(),
      },
      { id: 'view.settings', label: 'Settings', shortcut: 'Cmd+,', category: 'view' as const, action: () => console.log('[Aahi] Settings') },
    ],
    [appStore]
  );

  /* ── Filter commands ── */
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    return commands
      .filter((cmd) => fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.id))
      .sort((a, b) => {
        const scoreA = Math.max(fuzzyScore(query, a.label), fuzzyScore(query, a.id));
        const scoreB = Math.max(fuzzyScore(query, b.label), fuzzyScore(query, b.id));
        return scoreB - scoreA;
      });
  }, [commands, query]);

  /* ── Reset on open ── */
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  /* ── Keep active index in bounds ── */
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIndex]);

  /* ── Scroll active into view ── */
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const activeEl = list.children[activeIndex] as HTMLElement;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  /* ── Execute command ── */
  const executeCommand = useCallback(
    (cmd: Command) => {
      onClose();
      cmd.action();
    },
    [onClose]
  );

  /* ── Keyboard navigation ── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[activeIndex]) {
          executeCommand(filtered[activeIndex]);
        }
      }
    },
    [filtered, activeIndex, onClose, executeCommand]
  );

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div
        style={styles.container}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div style={styles.inputContainer}>
          <span style={styles.inputIcon}>&gt;</span>
          <input
            ref={inputRef}
            style={styles.input}
            placeholder="Type a command..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
          />
        </div>
        <div style={styles.list} ref={listRef}>
          {filtered.length === 0 ? (
            <div style={styles.noResults}>No matching commands</div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.id}
                style={{
                  ...styles.item,
                  ...(i === activeIndex ? styles.itemActive : {}),
                }}
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <div style={styles.itemLabel}>
                  <span
                    style={{
                      ...styles.categoryBadge,
                      color: categoryColors[cmd.category],
                      backgroundColor: `${categoryColors[cmd.category]}18`,
                    }}
                  >
                    {cmd.category}
                  </span>
                  <span>{cmd.label}</span>
                </div>
                {cmd.shortcut && <span style={styles.shortcut}>{cmd.shortcut}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
