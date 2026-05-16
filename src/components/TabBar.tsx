import React from 'react';
import { useStore } from '../store';
import { t } from '../i18n';

export function TabBar() {
  const tabs        = useStore(s => s.tabs);
  const activeTabId = useStore(s => s.activeTabId);
  const setActiveTab = useStore(s => s.setActiveTab);
  const addTab      = useStore(s => s.addTab);
  const closeTab    = useStore(s => s.closeTab);
  const addToast    = useStore(s => s.addToast);
  const settings    = useStore(s => s.settings);

  const handleAdd = () => {
    addTab();
    if (settings.theme === 'gaudy') addToast(t('gaudyNewTab'));
  };

  return (
    <div className="tab-bar">
      {tabs.map(tab => (
        <div
          key={tab.id}
          className={'tab' + (tab.id === activeTabId ? ' active' : '')}
          onClick={() => setActiveTab(tab.id)}
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
  );
}
