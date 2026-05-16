import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { t } from '../i18n';
import { TabBar } from './TabBar';

export function Header() {
  const tabs           = useStore(s => s.tabs);
  const activeTabId    = useStore(s => s.activeTabId);
  const markTabSaved   = useStore(s => s.markTabSaved);
  const addToast       = useStore(s => s.addToast);
  const settings       = useStore(s => s.settings);
  const addTab         = useStore(s => s.addTab);
  const loadFileIntoTab = useStore(s => s.loadFileIntoTab);

  const activeTab = tabs.find(tab => tab.id === activeTabId);
  const gaudy = (key: Parameters<typeof t>[0]) => { if (settings.theme === 'gaudy') addToast(t(key)); };

  const handleCopyPrompt = async () => {
    if (!activeTab) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(activeTab.content);
        return;
      }
      const ta = document.createElement('textarea');
      ta.value = activeTab.content;
      ta.setAttribute('readonly', 'true');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      // Ignore clipboard failures in environments where copy is restricted.
    }
  };

  const handleSave = async () => {
    if (!activeTab) return;
    if (activeTab.path) {
      await window.electronAPI.saveFile(activeTab.path, activeTab.content);
      markTabSaved(activeTab.id, activeTab.path, activeTab.title);
      gaudy('gaudySave');
    } else {
      await handleSaveAs();
    }
  };

  const handleSaveAs = async () => {
    if (!activeTab) return;
    const filePath = await window.electronAPI.saveFileAs(activeTab.content, activeTab.title + '.txt');
    if (filePath) {
      const name = filePath.split(/[\\/]/).pop()?.replace(/\.\w+$/, '') || activeTab.title;
      markTabSaved(activeTab.id, filePath, name);
      gaudy('gaudySave');
    }
  };

  const handleOpen = async () => {
    const result = await window.electronAPI.openFile();
    if (!result) return;
    const title = result.filePath.split(/[\\/]/).pop()?.replace(/\.\w+$/, '') || 'Untitled';
    if (activeTab && !activeTab.dirty && !activeTab.path && !activeTab.content) {
      loadFileIntoTab(activeTab.id, result.filePath, result.content, title);
    } else {
      addTab();
      setTimeout(() => {
        const state = useStore.getState();
        const newTab = state.tabs[state.tabs.length - 1];
        state.loadFileIntoTab(newTab.id, result.filePath, result.content, title);
        state.setActiveTab(newTab.id);
      }, 0);
    }
    gaudy('gaudyOpen');
  };

  // Keep ref current so the keydown listener never has stale closure
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <header className="header">
      <div className="header-brand">
        <span className="brand-mark">✦</span>
      </div>
      <TabBar />
      <div className="header-actions">
        <button className="header-btn" onClick={handleOpen} title={t('open')}>📂</button>
        <button className="header-btn" onClick={handleCopyPrompt} title={t('copyPrompt')}>📋</button>
        <button
          className={'header-btn' + (activeTab?.dirty ? ' dirty' : '')}
          onClick={handleSave}
          title={t('save')}
        >💾</button>
        <button className="header-btn" onClick={handleSaveAs} title={t('saveAs')}>↓</button>
      </div>
    </header>
  );
}
