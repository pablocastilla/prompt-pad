import React, { useEffect, useMemo, useRef } from 'react';
import { useStore } from './store';
import { setLanguage, detectLanguage, t } from './i18n';
import { Header } from './components/Header';
import { ActivityBar } from './components/ActivityBar';
import { SidePanel } from './components/SidePanel';
import { Editor } from './components/Editor';
import { GaudyToast } from './components/GaudyToast';
import { ModelPicker } from './components/ModelPicker';
import { LaunchSplash } from './components/LaunchSplash';
import type { LaunchConfig, Phrase, Settings, Tab } from './types';
import './App.css';

function shortcutKeyFromEvent(e: KeyboardEvent): string | null {
  const rawKey = e.key;
  if (rawKey && /^[0-9]$/.test(rawKey)) return rawKey;
  if (rawKey && /^[a-zA-Z]$/.test(rawKey)) return rawKey.toUpperCase();

  // Use KeyboardEvent.code so Shift+9 still resolves to "9" (not "(").
  const code = e.code || '';
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  return null;
}

export default function App() {
  const settings    = useStore(s => s.settings);
  const setSettings = useStore(s => s.setSettings);
  const setPhrases  = useStore(s => s.setPhrases);
  const setLaunches = useStore(s => s.setLaunches);
  const setLaunchHistory = useStore(s => s.setLaunchHistory);
  const phrases     = useStore(s => s.phrases);
  const launches    = useStore(s => s.launches);
  const tabs        = useStore(s => s.tabs);
  const activeTabId = useStore(s => s.activeTabId);
  const activePanel = useStore(s => s.activePanel);
  const toasts      = useStore(s => s.toasts);
  const requestInsertion  = useStore(s => s.requestInsertion);
  const addToast          = useStore(s => s.addToast);
  const restoreSession    = useStore(s => s.restoreSession);
  const setPendingLaunch  = useStore(s => s.setPendingLaunch);
  const activeTab = tabs.find(tab => tab.id === activeTabId);

  // ── Initial load: settings, phrases, launches, session ──────────────
  useEffect(() => {
    (async () => {
      const [loadedSettings, rawPhrases, rawLaunches, locale, session, launchHistory] = await Promise.all([
        window.electronAPI.loadSettings(),
        window.electronAPI.loadPhrases(),
        window.electronAPI.loadLaunches(),
        window.electronAPI.getLocale(),
        window.electronAPI.loadSession(),
        window.electronAPI.loadLaunchHistory(),
      ]);
      const s = {
        ...{
          theme: 'dark' as const,
          language: 'auto' as const,
          pinnedModels: { copilot: [], opencode: [] },
          phraseShortcutModifier: 'ctrl' as const,
          launchShortcutModifier: 'ctrl+shift' as const,
          openVsCodeShortcutModifier: 'ctrl+alt+shift' as const,
        },
        ...loadedSettings,
        pinnedModels: {
          copilot: loadedSettings?.pinnedModels?.copilot ?? [],
          opencode: loadedSettings?.pinnedModels?.opencode ?? [],
        },
      } as Settings;

      // Migrate items without shortcuts (assign positional shortcuts 1-9, 0)
      // Also migrate numeric shortcuts to strings for consistency
      let migrated = false;
      const phrases = rawPhrases.map((p, i) => {
        let p2 = p;
        if (typeof p2.shortcut === 'number') {
          p2 = { ...p2, shortcut: String(p2.shortcut) };
          migrated = true;
        } else if (p2.shortcut === undefined && i < 10) {
          p2 = { ...p2, shortcut: String(i === 9 ? 0 : i + 1) };
          migrated = true;
        }
        return p2;
      });
      const launches = rawLaunches.map((l, i) => {
        let l2 = l;
        if (typeof l2.shortcut === 'number') {
          l2 = { ...l2, shortcut: String(l2.shortcut) };
          migrated = true;
        } else if (l2.shortcut === undefined && i < 10) {
          l2 = { ...l2, shortcut: String(i === 9 ? 0 : i + 1) };
          migrated = true;
        }
        return l2;
      });
      if (migrated) {
        window.electronAPI.savePhrases(phrases);
        window.electronAPI.saveLaunches(launches);
      }

      setSettings(s);
      setPhrases(phrases);
      setLaunches(launches);
      setLaunchHistory(launchHistory ?? []);
      setLanguage(s.language === 'auto' ? detectLanguage(locale) : s.language);

      // Restore session if there are saved tabs with content
      if (session && Array.isArray(session.tabs) && session.tabs.length > 0) {
        const restoredTabs: Tab[] = session.tabs.map((t: Pick<Tab, 'id' | 'title' | 'content' | 'path' | 'phraseRanges'>) => ({
          id: t.id,
          title: t.title || 'Untitled',
          content: t.content || '',
          path: t.path || null,
          dirty: false,
          lastSavedAt: null,
          attachedFiles: [],
          phraseRanges: t.phraseRanges || [],
        }));
        const validActiveId = restoredTabs.find(t => t.id === session.activeTabId)
          ? session.activeTabId
          : restoredTabs[0].id;
        restoreSession(restoredTabs, validActiveId);
      }
    })();
  }, []);

  // ── Autosave session whenever tabs change (debounced 600ms) ──────────
  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
    sessionTimerRef.current = setTimeout(() => {
      window.electronAPI.saveSession({
        tabs: tabs.map(t => ({ id: t.id, title: t.title, content: t.content, path: t.path, phraseRanges: t.phraseRanges })),
        activeTabId,
      });
    }, 600);
    return () => { if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current); };
  }, [tabs, activeTabId]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    if (settings.language !== 'auto') {
      setLanguage(settings.language);
    } else {
      window.electronAPI.getLocale().then(locale => setLanguage(detectLanguage(locale)));
    }
  }, [settings.language]);

  const phraseByShortcut = useMemo(() => {
    const map = new Map<string, Phrase>();
    for (const p of phrases) {
      if (p.shortcut !== undefined) {
        if (!map.has(p.shortcut)) map.set(p.shortcut, p);
      }
    }
    return map;
  }, [phrases]);

  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      const mod = settings.phraseShortcutModifier;
      const needCtrl = mod === 'ctrl' || mod === 'ctrl+shift' || mod === 'ctrl+alt' || mod === 'ctrl+alt+shift';
      const needShift = mod === 'ctrl+shift' || mod === 'ctrl+alt+shift';
      const needAlt = mod === 'ctrl+alt' || mod === 'ctrl+alt+shift';
      if (needCtrl && !(e.ctrlKey || e.metaKey)) return;
      if (needShift && !e.shiftKey) return;
      if (needAlt && !e.altKey) return;
      if (!needShift && e.shiftKey) return;
      if (!needAlt && e.altKey) return;
      if (!needCtrl && (e.ctrlKey || e.metaKey)) return;
      if (e.repeat) return;
      const key = shortcutKeyFromEvent(e);
      if (!key) return;
      const phrase = phraseByShortcut.get(key);
      if (!phrase) return;

      e.preventDefault();
      requestInsertion(activeTabId, phrase.content, 'catalog');
      if (settings.theme === 'gaudy') addToast(t('gaudyPhrase'));
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [phraseByShortcut, activeTabId, requestInsertion, settings.theme, settings.phraseShortcutModifier, addToast]);

  const launchByShortcut = useMemo(() => {
    const map = new Map<string, LaunchConfig>();
    for (const l of launches) {
      if (l.shortcut !== undefined) {
        if (!map.has(l.shortcut)) map.set(l.shortcut, l);
      }
    }
    return map;
  }, [launches]);

  useEffect(() => {
    const handleLaunchShortcut = (e: KeyboardEvent) => {
      const mod = settings.launchShortcutModifier;
      const needCtrl = mod === 'ctrl+shift' || mod === 'ctrl+alt' || mod === 'ctrl+alt+shift';
      const needShift = mod === 'ctrl+shift' || mod === 'ctrl+alt+shift';
      const needAlt = mod === 'ctrl+alt' || mod === 'ctrl+alt+shift';
      if (needCtrl && !(e.ctrlKey || e.metaKey)) return;
      if (needShift && !e.shiftKey) return;
      if (needAlt && !e.altKey) return;
      if (!needShift && e.shiftKey) return;
      if (!needAlt && e.altKey) return;
      if (e.repeat) return;
      const key = shortcutKeyFromEvent(e);
      if (!key) return;
      const launch = launchByShortcut.get(key);
      if (!launch || !activeTab?.content.trim()) return;

      e.preventDefault();
      e.stopPropagation();
      setPendingLaunch({
        launch,
        prompt: activeTab.content,
        attachedFilePaths: (activeTab.attachedFiles ?? []).map(f => f.path),
      });
    };

    window.addEventListener('keydown', handleLaunchShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleLaunchShortcut, { capture: true });
  }, [launchByShortcut, activeTab, setPendingLaunch, settings.launchShortcutModifier]);

  // Ctrl+Alt+letter opens VS Code in the launch's folder
  useEffect(() => {
    const handleVsCodeShortcut = (e: KeyboardEvent) => {
      const mod = settings.openVsCodeShortcutModifier;
      const needCtrl = mod === 'ctrl+shift' || mod === 'ctrl+alt' || mod === 'ctrl+alt+shift';
      const needShift = mod === 'ctrl+shift' || mod === 'ctrl+alt+shift';
      const needAlt = mod === 'ctrl+alt' || mod === 'ctrl+alt+shift';
      if (needCtrl && !(e.ctrlKey || e.metaKey)) return;
      if (needShift && !e.shiftKey) return;
      if (needAlt && !e.altKey) return;
      if (!needShift && e.shiftKey) return;
      if (!needAlt && e.altKey) return;
      if (e.repeat) return;
      const key = shortcutKeyFromEvent(e);
      if (!key) return;

      const launch = launchByShortcut.get(key);
      if (!launch || !launch.folder) return;

      e.preventDefault();
      e.stopPropagation();
      window.electronAPI.openVsCode(launch.folder);
    };

    window.addEventListener('keydown', handleVsCodeShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleVsCodeShortcut, { capture: true });
  }, [launchByShortcut, settings.openVsCodeShortcutModifier]);

  return (
    <div className="app">
      <Header />
      <div className="workspace">
        <ActivityBar />
        {activePanel && <SidePanel />}
        <Editor key={activeTabId} />
      </div>
      {toasts.length > 0 && <GaudyToast />}
      <ModelPicker />
      <LaunchSplash />
    </div>
  );
}
