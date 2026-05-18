import React, { useEffect, useMemo, useRef } from 'react';
import { useStore } from './store';
import { setLanguage, detectLanguage, t } from './i18n';
import { Header } from './components/Header';
import { ActivityBar } from './components/ActivityBar';
import { SidePanel } from './components/SidePanel';
import { Editor } from './components/Editor';
import { GaudyToast } from './components/GaudyToast';
import { ModelPicker } from './components/ModelPicker';
import type { LaunchConfig, Phrase, Settings, Tab } from './types';
import './App.css';

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
          theme: 'light' as const,
          language: 'auto' as const,
          pinnedModels: { copilot: [], opencode: [] },
        },
        ...loadedSettings,
        pinnedModels: {
          copilot: loadedSettings?.pinnedModels?.copilot ?? [],
          opencode: loadedSettings?.pinnedModels?.opencode ?? [],
        },
      } as Settings;

      // Migrate items without shortcuts (assign positional shortcuts for 0-9)
      let migrated = false;
      const phrases = rawPhrases.map((p, i) => {
        if (p.shortcut === undefined && i <= 9) {
          migrated = true;
          return { ...p, shortcut: i === 9 ? 0 : i + 1 };
        }
        return p;
      });
      const launches = rawLaunches.map((l, i) => {
        if (l.shortcut === undefined && i <= 9) {
          migrated = true;
          return { ...l, shortcut: i === 9 ? 0 : i + 1 };
        }
        return l;
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
        const restoredTabs: Tab[] = session.tabs.map((t: Pick<Tab, 'id' | 'title' | 'content' | 'path'>) => ({
          id: t.id,
          title: t.title || 'Untitled',
          content: t.content || '',
          path: t.path || null,
          dirty: false,
          lastSavedAt: null,
          attachedFiles: [],
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
        tabs: tabs.map(t => ({ id: t.id, title: t.title, content: t.content, path: t.path })),
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
    const map = new Map<number, Phrase>();
    for (const p of phrases) {
      if (p.shortcut !== undefined && p.shortcut >= 0 && p.shortcut <= 9) {
        if (!map.has(p.shortcut)) map.set(p.shortcut, p);
      }
    }
    return map;
  }, [phrases]);

  useEffect(() => {
    const digitByCode: Record<string, number> = {
      Digit1: 1,
      Digit2: 2,
      Digit3: 3,
      Digit4: 4,
      Digit5: 5,
      Digit6: 6,
      Digit7: 7,
      Digit8: 8,
      Digit9: 9,
      Digit0: 0,
    };

    const handleShortcut = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.repeat) return;
      const shortcut = digitByCode[e.code];
      if (shortcut === undefined) return;

      const phrase = phraseByShortcut.get(shortcut);
      if (!phrase) return;

      e.preventDefault();
      requestInsertion(activeTabId, phrase.content);
      if (settings.theme === 'gaudy') addToast(t('gaudyPhrase'));
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [phraseByShortcut, activeTabId, requestInsertion, settings.theme, addToast]);

  const launchByShortcut = useMemo(() => {
    const map = new Map<number, LaunchConfig>();
    for (const l of launches) {
      if (l.shortcut !== undefined && l.shortcut >= 0 && l.shortcut <= 9) {
        if (!map.has(l.shortcut)) map.set(l.shortcut, l);
      }
    }
    return map;
  }, [launches]);

  useEffect(() => {
    const digitByCode: Record<string, number> = {
      Digit1: 1,
      Digit2: 2,
      Digit3: 3,
      Digit4: 4,
      Digit5: 5,
      Digit6: 6,
      Digit7: 7,
      Digit8: 8,
      Digit9: 9,
      Digit0: 0,
    };

    const handleLaunchShortcut = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      if (e.repeat) return;
      const shortcut = digitByCode[e.code];
      if (shortcut === undefined) return;

      const launch = launchByShortcut.get(shortcut);
      if (!launch || !activeTab?.content.trim()) return;

      e.preventDefault();
      setPendingLaunch({
        launch,
        prompt: activeTab.content,
        attachedFilePaths: (activeTab.attachedFiles ?? []).map(f => f.path),
      });
    };

    window.addEventListener('keydown', handleLaunchShortcut);
    return () => window.removeEventListener('keydown', handleLaunchShortcut);
  }, [launchByShortcut, activeTab, setPendingLaunch]);

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
    </div>
  );
}
