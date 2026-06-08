import { create } from 'zustand';
import type { Tab, Phrase, LaunchConfig, Settings, AttachedFile, LaunchHistoryEntry } from './types';

type ActivePanel = 'launches' | 'phrases' | 'settings' | 'history' | 'statistics' | null;

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function createTab(title?: string): Tab {
  return { id: uid(), title: title || 'Untitled', path: null, content: '', dirty: false, lastSavedAt: null, attachedFiles: [], phraseRanges: [] };
}

interface AppState {
  tabs: Tab[];
  activeTabId: string;
  addTab: () => void;
  createTabWithContent: (content: string, title?: string) => void;
  closeTab: (id: string) => void;
  closeTabsLeft: (id: string) => void;
  closeTabsRight: (id: string) => void;
  closeAllTabs: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabContent: (id: string, content: string) => void;
  setTabPhraseRanges: (id: string, ranges: { start: number; end: number }[]) => void;
  markTabSaved: (id: string, path: string | null, title: string) => void;
  loadFileIntoTab: (id: string, path: string, content: string, title: string) => void;
  restoreSession: (tabs: Tab[], activeTabId: string) => void;
  attachFileToTab: (tabId: string, file: AttachedFile) => void;
  removeFileFromTab: (tabId: string, fileId: string) => void;
  phrases: Phrase[];
  setPhrases: (p: Phrase[]) => void;
  addPhrase: (p: Phrase) => void;
  updatePhrase: (p: Phrase) => void;
  deletePhrase: (id: string) => void;
  launches: LaunchConfig[];
  setLaunches: (l: LaunchConfig[]) => void;
  selectedLaunchId: string | null;
  setSelectedLaunchId: (id: string | null) => void;
  addLaunch: (l: LaunchConfig) => void;
  updateLaunch: (l: LaunchConfig) => void;
  deleteLaunch: (id: string) => void;
  launchHistory: LaunchHistoryEntry[];
  setLaunchHistory: (h: LaunchHistoryEntry[]) => void;
  addLaunchHistoryEntry: (entry: LaunchHistoryEntry) => void;
  deleteLaunchHistoryByLaunchId: (launchId: string) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  activePanel: ActivePanel;
  setActivePanel: (panel: ActivePanel) => void;
  togglePanel: (panel: Exclude<ActivePanel, null>) => void;
  toasts: { id: string; message: string }[];
  addToast: (message: string) => void;
  removeToast: (id: string) => void;
  insertionSignal: { tabId: string; text: string; source: 'catalog' | 'shortcut' } | null;
  requestInsertion: (tabId: string, text: string, source?: 'catalog' | 'shortcut') => void;
  clearInsertion: () => void;
  pendingLaunch: { launch: LaunchConfig; prompt: string; attachedFilePaths: string[] } | null;
  setPendingLaunch: (data: { launch: LaunchConfig; prompt: string; attachedFilePaths: string[] } | null) => void;
  launchSplash: number;
  triggerLaunchSplash: () => void;
}

const initialTab = createTab();
export const useStore = create<AppState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  addTab: () => { const tab = createTab(); set(s => ({ tabs: [...s.tabs, tab], activeTabId: tab.id })); },
  createTabWithContent: (content, title) => {
    const tab = createTab(title);
    tab.content = content;
    tab.dirty = true;
    set(s => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },
  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex(t => t.id === id);
    const next = tabs.filter(t => t.id !== id);
    set({ tabs: next, activeTabId: activeTabId === id ? next[Math.min(idx, next.length - 1)].id : activeTabId });
  },
  closeTabsLeft: (id) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex(t => t.id === id);
    if (idx <= 0) return;
    const keep = tabs.slice(idx);
    set({ tabs: keep, activeTabId: id });
  },
  closeTabsRight: (id) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex(t => t.id === id);
    if (idx >= tabs.length - 1) return;
    const keep = tabs.slice(0, idx + 1);
    set({ tabs: keep, activeTabId: activeTabId === id || idx < tabs.findIndex(t => t.id === activeTabId) ? id : activeTabId });
  },
  closeAllTabs: (id) => {
    const { tabs } = get();
    const keep = tabs.filter(t => t.id === id);
    set({ tabs: keep.length > 0 ? keep : [createTab()], activeTabId: id });
  },
  closeOtherTabs: (id) => {
    const { tabs } = get();
    const keep = tabs.filter(t => t.id === id);
    if (keep.length === 0) return;
    set({ tabs: keep, activeTabId: id });
  },
  setActiveTab: (id) => set({ activeTabId: id }),
  updateTabContent: (id, content) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, content, dirty: true } : t) })),
  setTabPhraseRanges: (id, phraseRanges) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, phraseRanges } : t) })),
  markTabSaved: (id, path, title) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, path, title, dirty: false, lastSavedAt: Date.now() } : t) })),
  loadFileIntoTab: (id, path, content, title) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, path, content, title, dirty: false, lastSavedAt: Date.now() } : t) })),
  restoreSession: (tabs, activeTabId) => set({ tabs, activeTabId }),
  attachFileToTab: (tabId, file) => set(s => ({
    tabs: s.tabs.map(t => {
      if (t.id !== tabId) return t;
      const existing = t.attachedFiles ?? [];
      if (existing.some(f => f.path === file.path)) return t;
      return { ...t, attachedFiles: [...existing, file] };
    }),
  })),
  removeFileFromTab: (tabId, fileId) => set(s => ({
    tabs: s.tabs.map(t => t.id !== tabId ? t : { ...t, attachedFiles: (t.attachedFiles ?? []).filter(f => f.id !== fileId) }),
  })),
  phrases: [],
  setPhrases: (phrases) => set({ phrases }),
  addPhrase: (p) => set(s => ({ phrases: [...s.phrases, p] })),
  updatePhrase: (p) => set(s => ({ phrases: s.phrases.map(x => x.id === p.id ? p : x) })),
  deletePhrase: (id) => set(s => ({ phrases: s.phrases.filter(x => x.id !== id) })),
  launches: [],
  setLaunches: (launches) => set({ launches }),
  selectedLaunchId: null,
  setSelectedLaunchId: (id) => set({ selectedLaunchId: id }),
  addLaunch: (l) => set(s => ({ launches: [...s.launches, l] })),
  updateLaunch: (l) => set(s => ({ launches: s.launches.map(x => x.id === l.id ? l : x) })),
  deleteLaunch: (id) => set(s => ({ launches: s.launches.filter(x => x.id !== id) })),
  launchHistory: [],
  setLaunchHistory: (launchHistory) => set({ launchHistory }),
  addLaunchHistoryEntry: (entry) => set(s => {
    const updated = [entry, ...s.launchHistory].slice(0, 100);
    return { launchHistory: updated };
  }),
  deleteLaunchHistoryByLaunchId: (launchId) => set(s => ({
    launchHistory: s.launchHistory.filter(e => e.launchId !== launchId),
  })),
  settings: { theme: 'dark', language: 'auto', useOneDrive: true, phraseShortcutModifier: 'ctrl', launchShortcutModifier: 'ctrl+shift', openVsCodeShortcutModifier: 'ctrl+alt+shift' },
  setSettings: (settings) => set({ settings }),
  activePanel: null,
  setActivePanel: (panel) => set({ activePanel: panel }),
  togglePanel: (panel) => set(s => ({ activePanel: s.activePanel === panel ? null : panel })),
  toasts: [],
  addToast: (message) => {
    const id = uid();
    set(s => ({ toasts: [...s.toasts, { id, message }] }));
    setTimeout(() => get().removeToast(id), 3000);
  },
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  insertionSignal: null,
  requestInsertion: (tabId, text, source = 'shortcut') => set({ insertionSignal: { tabId, text, source } }),
  clearInsertion: () => set({ insertionSignal: null }),
  pendingLaunch: null,
  setPendingLaunch: (data) => set({ pendingLaunch: data }),
  launchSplash: 0,
  triggerLaunchSplash: () => set(s => ({ launchSplash: s.launchSplash + 1 })),
}));
