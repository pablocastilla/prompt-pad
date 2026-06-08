import React from 'react';
import { useStore } from '../store';
import { t } from '../i18n';

export function ActivityBar() {
  const activePanel = useStore(s => s.activePanel);
  const togglePanel = useStore(s => s.togglePanel);
  const tabs = useStore(s => s.tabs);
  const activeTabId = useStore(s => s.activeTabId);
  const openStatsTab = useStore(s => s.openStatsTab);
  const activeIsStats = tabs.some(t => t.id === activeTabId && t.content === '__STATS__');

  return (
    <div className="activity-bar">
      <button
        className={'activity-btn' + (activePanel === 'launches' ? ' active' : '')}
        onClick={() => togglePanel('launches')}
        title={t('launches')}
      >🚀</button>
      <button
        className={'activity-btn' + (activePanel === 'phrases' ? ' active' : '')}
        onClick={() => togglePanel('phrases')}
        title={t('phraseCatalog')}
      >📝</button>
      <button
        className={'activity-btn' + (activePanel === 'history' ? ' active' : '')}
        onClick={() => togglePanel('history')}
        title={t('launchHistory')}
      >📜</button>
      <button
        className={'activity-btn' + (activeIsStats ? ' active' : '')}
        onClick={() => openStatsTab()}
        title={t('statistics')}
      >📊</button>
      <div className="activity-spacer" />
      <button
        className={'activity-btn' + (activePanel === 'settings' ? ' active' : '')}
        onClick={() => togglePanel('settings')}
        title={t('settings')}
      >⚙️</button>
    </div>
  );
}
