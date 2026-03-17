import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRuntimeStore } from '../../store/runtime-store';
import { isTauri } from '../../bridge/tauri-bridge';

interface SearchResult {
  filePath: string;
  line: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

interface GroupedResults {
  [filePath: string]: SearchResult[];
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#252526',
    color: '#cccccc',
    fontSize: 13,
    overflow: 'hidden',
  },
  header: {
    padding: '10px 12px',
    fontSize: 11,
    fontWeight: 600,
    color: '#858585',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    borderBottom: '1px solid #3e3e42',
  },
  inputArea: {
    padding: '8px 12px',
    borderBottom: '1px solid #3e3e42',
  },
  inputRow: {
    display: 'flex',
    gap: 4,
    marginBottom: 4,
  },
  input: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    color: '#cccccc',
    fontSize: 12,
    fontFamily: 'inherit',
    padding: '4px 8px',
    outline: 'none',
  },
  toggleBtn: {
    padding: '2px 6px',
    fontSize: 11,
    fontWeight: 500,
    backgroundColor: 'transparent',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: "'Menlo', 'Monaco', monospace",
    color: '#858585',
    minWidth: 24,
    textAlign: 'center' as const,
  },
  toggleBtnActive: {
    backgroundColor: '#007acc',
    borderColor: '#007acc',
    color: '#ffffff',
  },
  replaceRow: {
    display: 'flex',
    gap: 4,
    marginTop: 4,
  },
  replaceBtn: {
    padding: '3px 8px',
    fontSize: 11,
    backgroundColor: '#3e3e42',
    border: 'none',
    borderRadius: 3,
    color: '#cccccc',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  resultArea: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 0,
  },
  resultCount: {
    padding: '6px 12px',
    fontSize: 11,
    color: '#858585',
    borderBottom: '1px solid #3e3e42',
  },
  fileGroup: {
    borderBottom: '1px solid #3e3e4233',
  },
  fileHeader: {
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 500,
    color: '#cccccc',
    backgroundColor: '#2d2d2d',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  fileCount: {
    fontSize: 10,
    color: '#858585',
    backgroundColor: '#3e3e42',
    borderRadius: 8,
    padding: '0 5px',
  },
  resultLine: {
    padding: '2px 12px 2px 24px',
    fontSize: 12,
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
  },
  lineNumber: {
    color: '#858585',
    minWidth: 30,
    textAlign: 'right' as const,
    flexShrink: 0,
  },
  matchHighlight: {
    backgroundColor: '#613214',
    color: '#e8912d',
    borderRadius: 1,
  },
  noResults: {
    padding: '24px 12px',
    textAlign: 'center' as const,
    color: '#858585',
    fontSize: 12,
  },
};

const MAX_RESULTS = 500;

export const SearchPanel: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [results, setResults] = useState<GroupedResults>({});
  const [totalCount, setTotalCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openFile = useRuntimeStore((s) => s.openFile);
  const openFiles = useRuntimeStore((s) => s.openFiles);

  const performSearch = useCallback(
    (query: string) => {
      if (!query.trim()) {
        setResults({});
        setTotalCount(0);
        return;
      }

      setSearching(true);

      // Search in currently open files (works in both browser and Tauri mode)
      const grouped: GroupedResults = {};
      let count = 0;

      const flags = caseSensitive ? 'g' : 'gi';
      let pattern: RegExp;
      try {
        if (useRegex) {
          pattern = new RegExp(query, flags);
        } else {
          const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const finalPattern = wholeWord ? `\\b${escaped}\\b` : escaped;
          pattern = new RegExp(finalPattern, flags);
        }
      } catch {
        setSearching(false);
        return;
      }

      openFiles.forEach((file, filePath) => {
        const lines = file.content.split('\n');
        for (let i = 0; i < lines.length && count < MAX_RESULTS; i++) {
          const line = lines[i];
          pattern.lastIndex = 0;
          const match = pattern.exec(line);
          if (match) {
            if (!grouped[filePath]) grouped[filePath] = [];
            grouped[filePath].push({
              filePath,
              line: i + 1,
              text: line,
              matchStart: match.index,
              matchEnd: match.index + match[0].length,
            });
            count++;
          }
        }
      });

      setResults(grouped);
      setTotalCount(count);
      setSearching(false);
    },
    [caseSensitive, wholeWord, useRegex, openFiles],
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, performSearch]);

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      openFile(result.filePath);
    },
    [openFile],
  );

  const toggleFileCollapse = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  const renderHighlightedText = useCallback((result: SearchResult) => {
    const { text, matchStart, matchEnd } = result;
    const before = text.substring(0, matchStart);
    const match = text.substring(matchStart, matchEnd);
    const after = text.substring(matchEnd);
    return (
      <span>
        {before}
        <span style={styles.matchHighlight}>{match}</span>
        {after}
      </span>
    );
  }, []);

  const fileGroups = Object.entries(results);

  return (
    <div style={styles.container}>
      <div style={styles.header}>Search</div>
      <div style={styles.inputArea}>
        <div style={styles.inputRow}>
          <input
            style={styles.input}
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          <button
            style={{
              ...styles.toggleBtn,
              ...(caseSensitive ? styles.toggleBtnActive : {}),
            }}
            onClick={() => setCaseSensitive((v) => !v)}
            title="Case Sensitive"
          >
            Aa
          </button>
          <button
            style={{
              ...styles.toggleBtn,
              ...(wholeWord ? styles.toggleBtnActive : {}),
            }}
            onClick={() => setWholeWord((v) => !v)}
            title="Whole Word"
          >
            ab
          </button>
          <button
            style={{
              ...styles.toggleBtn,
              ...(useRegex ? styles.toggleBtnActive : {}),
            }}
            onClick={() => setUseRegex((v) => !v)}
            title="Regex"
          >
            .*
          </button>
          <button
            style={styles.toggleBtn}
            onClick={() => setShowReplace((v) => !v)}
            title="Toggle Replace"
          >
            {showReplace ? '\u25B4' : '\u25BE'}
          </button>
        </div>
        {showReplace && (
          <div style={styles.replaceRow}>
            <input
              style={styles.input}
              placeholder="Replace..."
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
            />
            <button style={styles.replaceBtn} title="Replace All (in open files)">
              All
            </button>
          </div>
        )}
      </div>

      {searchQuery.trim() && (
        <div style={styles.resultCount}>
          {searching
            ? 'Searching...'
            : `${totalCount} result${totalCount !== 1 ? 's' : ''} in ${fileGroups.length} file${fileGroups.length !== 1 ? 's' : ''}`}
          {totalCount >= MAX_RESULTS && ' (limited)'}
        </div>
      )}

      <div style={styles.resultArea}>
        {fileGroups.length === 0 && searchQuery.trim() && !searching && (
          <div style={styles.noResults}>
            No results found.
            {!isTauri() && (
              <>
                <br />
                In browser mode, search is limited to open files.
              </>
            )}
          </div>
        )}
        {fileGroups.map(([filePath, fileResults]) => {
          const collapsed = collapsedFiles.has(filePath);
          const shortPath = filePath.split('/').slice(-2).join('/');
          return (
            <div key={filePath} style={styles.fileGroup}>
              <div
                style={styles.fileHeader}
                onClick={() => toggleFileCollapse(filePath)}
              >
                <span>{collapsed ? '\u25B6' : '\u25BC'}</span>
                <span>{shortPath}</span>
                <span style={styles.fileCount}>{fileResults.length}</span>
              </div>
              {!collapsed &&
                fileResults.map((result, i) => (
                  <div
                    key={`${result.line}-${i}`}
                    style={styles.resultLine}
                    onClick={() => handleResultClick(result)}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor = '#2a2d2e';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    <span style={styles.lineNumber}>{result.line}</span>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {renderHighlightedText(result)}
                    </span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
