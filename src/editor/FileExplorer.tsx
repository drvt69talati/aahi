import React, { useState, useMemo, useCallback } from 'react';
import { useRuntimeStore } from '../store/runtime-store';

/* ── Types ── */
interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

/* ── Icons ── */
const FILE_ICONS: Record<string, string> = {
  ts: 'TS',
  tsx: 'TX',
  js: 'JS',
  jsx: 'JX',
  py: 'PY',
  rs: 'RS',
  go: 'GO',
  json: '{}',
  md: 'MD',
  html: '<>',
  css: 'CS',
  yaml: 'YM',
  yml: 'YM',
  toml: 'TM',
  lock: 'LK',
  gitignore: 'GI',
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return FILE_ICONS[ext] ?? '';
}

/* ── Styles ── */
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#252526',
    color: '#cccccc',
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
  searchContainer: {
    padding: '6px 8px',
    borderBottom: '1px solid #3e3e42',
  },
  searchInput: {
    width: '100%',
    backgroundColor: '#3c3c3c',
    border: '1px solid #3e3e42',
    borderRadius: 3,
    padding: '4px 8px',
    fontSize: 12,
    color: '#cccccc',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  },
  treeContainer: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    fontSize: 13,
    cursor: 'pointer',
    userSelect: 'none' as const,
    lineHeight: '22px',
  },
  itemHover: {
    backgroundColor: '#2a2d2e',
  },
  itemActive: {
    backgroundColor: '#37373d',
  },
  chevron: {
    display: 'inline-block',
    width: 16,
    textAlign: 'center' as const,
    fontSize: 10,
    color: '#858585',
    flexShrink: 0,
  },
  icon: {
    fontSize: 10,
    fontWeight: 600,
    width: 18,
    textAlign: 'center' as const,
    flexShrink: 0,
    color: '#858585',
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  emptyState: {
    padding: '24px 12px',
    textAlign: 'center' as const,
    color: '#585858',
    fontSize: 12,
  },
};

/* ── Tree node component ── */
const TreeNode: React.FC<{
  node: FileTreeNode;
  depth: number;
  activeFilePath: string | null;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
  onFileClick: (path: string) => void;
  filter: string;
}> = ({ node, depth, activeFilePath, expandedDirs, toggleDir, onFileClick, filter }) => {
  const [hovered, setHovered] = useState(false);

  const isDir = node.type === 'directory';
  const isExpanded = expandedDirs.has(node.path);
  const isActive = node.path === activeFilePath;

  // Filter: if filter is set, only show matching items (and directories containing matches)
  const matchesFilter = filter
    ? node.name.toLowerCase().includes(filter.toLowerCase())
    : true;

  const hasMatchingChildren = useMemo(() => {
    if (!filter || !isDir || !node.children) return true;
    const checkChildren = (children: FileTreeNode[]): boolean => {
      return children.some(
        (c) =>
          c.name.toLowerCase().includes(filter.toLowerCase()) ||
          (c.children && checkChildren(c.children))
      );
    };
    return checkChildren(node.children);
  }, [filter, isDir, node.children, node.name]);

  if (filter && !matchesFilter && !hasMatchingChildren) return null;

  const handleClick = () => {
    if (isDir) {
      toggleDir(node.path);
    } else {
      onFileClick(node.path);
    }
  };

  const paddingLeft = 8 + depth * 16;

  return (
    <>
      <div
        style={{
          ...styles.item,
          paddingLeft,
          ...(isActive ? styles.itemActive : {}),
          ...(hovered && !isActive ? styles.itemHover : {}),
        }}
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={node.path}
      >
        <span style={styles.chevron}>
          {isDir ? (isExpanded ? '\u25BE' : '\u25B8') : ''}
        </span>
        <span style={styles.icon}>
          {isDir ? (isExpanded ? '\uD83D\uDCC2' : '\uD83D\uDCC1') : getFileIcon(node.name) || '\uD83D\uDCC4'}
        </span>
        <span style={styles.name}>{node.name}</span>
      </div>
      {isDir && isExpanded && node.children && (
        <>
          {[...node.children]
            .sort((a, b) => {
              // Directories first, then alphabetical
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
            .map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                activeFilePath={activeFilePath}
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
                onFileClick={onFileClick}
                filter={filter}
              />
            ))}
        </>
      )}
    </>
  );
};

/* ── Main component ── */
export const FileExplorer: React.FC = () => {
  const fileTree = useRuntimeStore((s) => s.fileTree);
  const activeFilePath = useRuntimeStore((s) => s.activeFilePath);
  const openFile = useRuntimeStore((s) => s.openFile);

  const [filter, setFilter] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleFileClick = useCallback(
    (path: string) => {
      openFile(path);
    },
    [openFile]
  );

  const treeNodes: FileTreeNode[] = useMemo(() => {
    if (!fileTree || (Array.isArray(fileTree) && fileTree.length === 0)) return [];
    if (Array.isArray(fileTree)) return fileTree as FileTreeNode[];
    // If it is a single root node
    if ((fileTree as any).children) return (fileTree as any).children as FileTreeNode[];
    return [fileTree as FileTreeNode];
  }, [fileTree]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>Explorer</div>
      <div style={styles.searchContainer}>
        <input
          style={styles.searchInput}
          placeholder="Filter files..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onFocus={(e) => {
            (e.target as HTMLInputElement).style.borderColor = '#007acc';
          }}
          onBlur={(e) => {
            (e.target as HTMLInputElement).style.borderColor = '#3e3e42';
          }}
        />
      </div>
      <div style={styles.treeContainer}>
        {treeNodes.length === 0 ? (
          <div style={styles.emptyState}>No workspace open</div>
        ) : (
          treeNodes
            .sort((a, b) => {
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
            .map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                activeFilePath={activeFilePath}
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
                onFileClick={handleFileClick}
                filter={filter}
              />
            ))
        )}
      </div>
    </div>
  );
};
