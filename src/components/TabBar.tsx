import React, { useState, useCallback } from 'react';
import { useStore } from '../store';
import { t } from '../i18n';
import { TabContextMenu } from './TabContextMenu';

export function TabBar() {
  const tabs        = useStore(s => s.tabs);
  const activeTabId = useStore(s => s.activeTabId);
  const setActiveTab = useStore(s => s.setActiveTab);
  const addTab      = useStore(s => s.addTab);
  const closeTab    = useStore(s => s.closeTab);
  const addToast    = useStore(s => s.addToast);
  const settings    = useStore(s => s.settings);

  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  const handleAdd = () => {
    addTab();
    if (settings.theme === 'gaudy') addToast(t('gaudyNewTab'));
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      <div className="tab-bar">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={'tab' + (tab.id === activeTabId ? ' active' : '')}
            onClick={() => setActiveTab(tab.id)}
            onContextMenu={e => handleContextMenu(e, tab.id)}
          >
            <span className="tab-title">
              {tab.dirty && <span className="tab-dot" />}
              {tab.title || t('untitled')}
            </span>
            {tabs.length > 1 && (
              <button
                className="tab-close"
                onClick={e => {
                  e.stopPropagation();
                  closeTab(tab.id);
                  if (settings.theme === 'gaudy') addToast(t('gaudyCloseTab'));
                }}
              >×</button>
            )}
          </div>
        ))}
        <button className="tab-add" onClick={handleAdd} title={t('newTab')}>+</button>
      </div>
      {contextMenu && (
        <TabContextMenu
          tabId={contextMenu.tabId}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
