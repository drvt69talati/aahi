import React, { useState, useRef, useEffect, useCallback } from 'react';
import { isTauri } from '../../bridge/tauri-bridge';

interface HistoryEntry {
  type: 'input' | 'output' | 'error';
  text: string;
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    fontSize: 13,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '2px 8px',
    borderBottom: '1px solid #3e3e42',
    backgroundColor: '#252526',
  },
  clearBtn: {
    padding: '2px 8px',
    fontSize: 11,
    color: '#858585',
    backgroundColor: 'transparent',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  outputArea: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 12px',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 12px 8px',
    gap: 6,
  },
  prompt: {
    color: '#4ec9b0',
    fontWeight: 600,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#cccccc',
    fontSize: 13,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    padding: 0,
  },
  outputLine: {
    padding: '1px 0',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
};

export const Terminal: React.FC = () => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdHistoryIndex, setCmdHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const executeCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    // Add input to history display
    setHistory((prev) => [...prev, { type: 'input', text: `$ ${trimmed}` }]);
    setCmdHistory((prev) => [...prev, trimmed]);
    setCmdHistoryIndex(-1);
    setInputValue('');

    if (!isTauri()) {
      setHistory((prev) => [
        ...prev,
        {
          type: 'error',
          text: 'Terminal requires Tauri desktop mode. Start the app with `cargo tauri dev` to enable shell access.',
        },
      ]);
      return;
    }

    try {
      const result = await window.__TAURI__!.core.invoke('plugin:shell|execute', {
        program: trimmed.split(' ')[0],
        args: trimmed.split(' ').slice(1),
      });
      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      if (output) {
        setHistory((prev) => [...prev, { type: 'output', text: output }]);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setHistory((prev) => [...prev, { type: 'error', text: errMsg }]);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeCommand(inputValue);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (cmdHistory.length === 0) return;
        const newIndex =
          cmdHistoryIndex === -1
            ? cmdHistory.length - 1
            : Math.max(0, cmdHistoryIndex - 1);
        setCmdHistoryIndex(newIndex);
        setInputValue(cmdHistory[newIndex]);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (cmdHistoryIndex === -1) return;
        const newIndex = cmdHistoryIndex + 1;
        if (newIndex >= cmdHistory.length) {
          setCmdHistoryIndex(-1);
          setInputValue('');
        } else {
          setCmdHistoryIndex(newIndex);
          setInputValue(cmdHistory[newIndex]);
        }
      } else if (e.key === 'c' && e.ctrlKey) {
        e.preventDefault();
        setHistory((prev) => [...prev, { type: 'input', text: `$ ${inputValue}^C` }]);
        setInputValue('');
      }
    },
    [inputValue, cmdHistory, cmdHistoryIndex, executeCommand],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return (
    <div style={styles.container} onClick={() => inputRef.current?.focus()}>
      <div style={styles.toolbar}>
        <button style={styles.clearBtn} onClick={clearHistory}>
          Clear
        </button>
      </div>
      <div style={styles.outputArea} ref={outputRef}>
        {history.map((entry, i) => (
          <div
            key={i}
            style={{
              ...styles.outputLine,
              color:
                entry.type === 'input'
                  ? '#4ec9b0'
                  : entry.type === 'error'
                    ? '#f44747'
                    : '#cccccc',
            }}
          >
            {entry.text}
          </div>
        ))}
      </div>
      <div style={styles.inputRow}>
        <span style={styles.prompt}>$</span>
        <input
          ref={inputRef}
          style={styles.input}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
};
