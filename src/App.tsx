import React, { useState, useEffect } from 'react';
import { useAppStore } from './store/app-store';
import { useRuntimeStore } from './store/runtime-store';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { BottomPanel } from './components/BottomPanel';
import { MonacoCore } from './editor/MonacoCore';
import { TabBar } from './editor/TabBar';
import { CommandPalette } from './editor/CommandPalette';
import { InlinePromptBar, useInlinePrompt } from './editor/InlinePromptBar';
import { ChatPanel } from './panels/ChatPanel/ChatPanel';
import { StatusBar } from './components/StatusBar';
import { getSessionManager } from './store/session-manager';

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

  const initialize = useRuntimeStore((s) => s.initialize);

  const inlinePrompt = useInlinePrompt();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  /* ── Initialize runtime on mount + restore last session ── */
  useEffect(() => {
    const init = async () => {
      await initialize?.();
      // Restore last session
      const sessionManager = getSessionManager();
      const lastSession = await sessionManager.getLastSession();
      if (lastSession) {
        await sessionManager.loadSession(lastSession);
      }
      // Start auto-save
      sessionManager.autoSave();
    };
    init();
  }, [initialize]);

  /* ── Save session before page unload ── */
  useEffect(() => {
    const handleBeforeUnload = () => {
      const sessionManager = getSessionManager();
      sessionManager.saveSessionSync();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  /* ── Global keyboard shortcuts ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd+B — toggle sidebar
      if (mod && e.key === 'b') {
        e.preventDefault();
        toggleLeftSidebar();
      }

      // Cmd+J — toggle bottom panel
      if (mod && e.key === 'j') {
        e.preventDefault();
        toggleBottomPanel();
      }

      // Cmd+Shift+L — toggle chat panel
      if (mod && e.shiftKey && e.key === 'l') {
        e.preventDefault();
        toggleRightPanel();
      }

      // Cmd+Shift+P — command palette
      if (mod && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }

      // Cmd+Shift+I — toggle Composer / right panel
      if (mod && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
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

        {/* Center: TabBar + Editor + Bottom Panel */}
        <div style={styles.center}>
          {/* Tab Bar */}
          <TabBar />

          {/* Monaco Editor */}
          <div style={styles.editorArea}>
            <MonacoCore />

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

      {/* Status Bar */}
      <StatusBar />

      {/* Command Palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  );
};
