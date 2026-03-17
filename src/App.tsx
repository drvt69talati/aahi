import React, { useState, useCallback } from 'react';
import { useAppStore } from './store/app-store';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { BottomPanel } from './components/BottomPanel';
import { MonacoCore } from './editor/MonacoCore';
import { InlinePromptBar, useInlinePrompt } from './editor/InlinePromptBar';
import { ChatPanel } from './panels/ChatPanel/ChatPanel';
import type { editor } from 'monaco-editor';

const SAMPLE_CODE = `// Welcome to Aahi — AI-native Software Operations Platform
// The IDE that sees your living system.
//
// Key shortcuts:
//   Cmd+K — Inline AI prompt
//   Cmd+L — Focus AI chat
//   Cmd+B — Toggle sidebar
//   Cmd+J — Toggle bottom panel

import { TimelineStore } from './runtime/intelligence/timeline';
import { AgentRuntime } from './runtime/agents/runtime';
import { IntegrationRegistry } from './runtime/integrations/registry';

async function main() {
  // Initialize the Aahi runtime
  const timeline = new TimelineStore();
  const agents = new AgentRuntime();
  const integrations = new IntegrationRegistry();

  // Register built-in integrations
  await integrations.register('github', {
    type: 'devops',
    capabilities: ['pr', 'issues', 'actions'],
  });

  await integrations.register('kubernetes', {
    type: 'infrastructure',
    capabilities: ['pods', 'deployments', 'logs'],
  });

  // Start the proactive monitoring agent
  agents.spawn('proactive', {
    interval: 30_000,
    sources: ['github', 'kubernetes', 'datadog'],
    onInsight: (insight) => {
      timeline.addEvent({
        type: 'proactive',
        source: insight.source,
        summary: insight.message,
        severity: insight.severity,
      });
    },
  });

  console.log('Aahi runtime initialized');
}

main().catch(console.error);
`;

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    width: '100%',
    height: '100%',
    backgroundColor: '#1e1e1e',
    color: '#cccccc',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  center: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    overflow: 'hidden',
    position: 'relative' as const,
  },
  editorArea: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative' as const,
  },
  rightPanel: {
    width: 360,
    minWidth: 280,
    maxWidth: 500,
    overflow: 'hidden',
  },
  bottomPanel: {
    height: 200,
    minHeight: 100,
  },
  editorTabs: {
    display: 'flex',
    alignItems: 'center',
    height: 35,
    backgroundColor: '#252526',
    borderBottom: '1px solid #3e3e42',
    paddingLeft: 4,
  },
  editorTab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 12px',
    height: 35,
    fontSize: 12,
    color: '#cccccc',
    backgroundColor: '#1e1e1e',
    borderRight: '1px solid #3e3e42',
    borderTop: '1px solid #007acc',
    cursor: 'pointer',
  },
  editorTabInactive: {
    backgroundColor: '#2d2d2d',
    borderTop: '1px solid transparent',
    color: '#858585',
  },
};

export const App: React.FC = () => {
  const {
    leftSidebarOpen,
    rightPanelOpen,
    bottomPanelOpen,
    toggleLeftSidebar,
    toggleRightPanel,
    toggleBottomPanel,
  } = useAppStore();

  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor | null>(null);
  const inlinePrompt = useInlinePrompt();

  const handleEditorMount = useCallback((editor: editor.IStandaloneCodeEditor) => {
    setEditorInstance(editor);
  }, []);

  // Global keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'b') {
        e.preventDefault();
        toggleLeftSidebar();
      }
      if (mod && e.key === 'j') {
        e.preventDefault();
        toggleBottomPanel();
      }
      if (mod && e.shiftKey && e.key === 'l') {
        e.preventDefault();
        toggleRightPanel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLeftSidebar, toggleBottomPanel, toggleRightPanel]);

  return (
    <div style={styles.root}>
      <TopBar />

      <div style={styles.body}>
        {/* Left Sidebar */}
        <Sidebar />

        {/* Center: Editor + Bottom Panel */}
        <div style={styles.center}>
          {/* Editor Tab Bar */}
          <div style={styles.editorTabs}>
            <div style={styles.editorTab}>
              <span style={{ fontSize: 11 }}>TS</span>
              main.ts
              <span style={{ color: '#858585', fontSize: 11, cursor: 'pointer' }}>x</span>
            </div>
            <div style={{ ...styles.editorTab, ...styles.editorTabInactive }}>
              <span style={{ fontSize: 11 }}>TS</span>
              App.tsx
              <span style={{ color: '#585858', fontSize: 11, cursor: 'pointer' }}>x</span>
            </div>
          </div>

          {/* Monaco Editor */}
          <div style={styles.editorArea}>
            <MonacoCore
              content={SAMPLE_CODE}
              language="typescript"
              onEditorMount={handleEditorMount}
            />

            {/* Inline Prompt Bar (Cmd+K) */}
            {inlinePrompt.isOpen && (
              <InlinePromptBar
                anchorTop={inlinePrompt.position.top}
                anchorLeft={inlinePrompt.position.left}
                onSubmit={inlinePrompt.submit}
                onClose={inlinePrompt.close}
                isLoading={inlinePrompt.isLoading}
              />
            )}
          </div>

          {/* Bottom Panel */}
          {bottomPanelOpen && (
            <div style={styles.bottomPanel}>
              <BottomPanel />
            </div>
          )}
        </div>

        {/* Right Panel: AI Chat */}
        {rightPanelOpen && (
          <div style={styles.rightPanel}>
            <ChatPanel />
          </div>
        )}
      </div>
    </div>
  );
};
