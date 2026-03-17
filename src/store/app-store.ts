import { create } from 'zustand';

export type SidebarPanel = 'explorer' | 'integrations' | 'agent-log' | 'proactive';
export type BottomPanel = 'timeline' | 'logs' | 'traces' | 'metrics' | 'terminal';

interface AppState {
  // Layout
  leftSidebarOpen: boolean;
  rightPanelOpen: boolean;
  bottomPanelOpen: boolean;
  activeSidebarPanel: SidebarPanel;
  activeBottomPanel: BottomPanel;

  // Model
  currentModel: string;

  // Workspace
  currentWorkspace: string;

  // Incidents
  activeIncidentCount: number;

  // Focus mode (suppresses proactive alerts)
  focusMode: boolean;

  // Actions
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  toggleBottomPanel: () => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  setBottomPanel: (panel: BottomPanel) => void;
  setModel: (model: string) => void;
  setWorkspace: (workspace: string) => void;
  toggleFocusMode: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  leftSidebarOpen: true,
  rightPanelOpen: true,
  bottomPanelOpen: true,
  activeSidebarPanel: 'explorer',
  activeBottomPanel: 'timeline',
  currentModel: 'claude-sonnet-4-6',
  currentWorkspace: 'my-project',
  activeIncidentCount: 0,
  focusMode: false,

  toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setSidebarPanel: (panel) => set({ activeSidebarPanel: panel, leftSidebarOpen: true }),
  setBottomPanel: (panel) => set({ activeBottomPanel: panel, bottomPanelOpen: true }),
  setModel: (model) => set({ currentModel: model }),
  setWorkspace: (workspace) => set({ currentWorkspace: workspace }),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
}));
