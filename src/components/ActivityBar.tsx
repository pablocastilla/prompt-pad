import React from 'react';
import { useStore } from '../store';
import { t } from '../i18n';

export function ActivityBar() {
  const activePanel = useStore(s => s.activePanel);
  const togglePanel = useStore(s => s.togglePanel);
  const tabs = useStore(s => s.tabs);
  const activeTabId = useStore(s => s.activeTabId);
  const openStatsTab = useStore(s => s.openStatsTab);
  const helpOpen = useStore(s => s.helpOpen);
  const setHelpOpen = useStore(s => s.setHelpOpen);
  const activeIsStats = tabs.some(t => t.id === activeTabId && t.content === '__STATS__');

  return (
    <div className="activity-bar">
      <button
        className={'activity-btn' + (activePanel === 'launches' ? ' active' : '')}
        onClick={() => togglePanel('launches')}
        title={t('launches')}
        data-tour-id="launches"
      >🚀</button>
      <button
        className={'activity-btn' + (activePanel === 'phrases' ? ' active' : '')}
        onClick={() => togglePanel('phrases')}
        title={t('phraseCatalog')}
        data-tour-id="phrases"
      >📝</button>
      <button
        className={'activity-btn' + (activePanel === 'history' ? ' active' : '')}
        onClick={() => togglePanel('history')}
        title={t('launchHistory')}
        data-tour-id="history"
      >📜</button>
      <button
        className={'activity-btn' + (activeIsStats ? ' active' : '')}
        onClick={() => openStatsTab()}
        title={t('statistics')}
        data-tour-id="statistics"
      >📊</button>
      <button
        className={'activity-btn activity-btn-help' + (helpOpen ? ' active' : '')}
        onClick={() => setHelpOpen(!helpOpen)}
        title={t('help')}
        aria-label={t('help')}
        data-tour-id="help"
      >?</button>
      <div className="activity-spacer" />
      <button
        className={'activity-btn' + (activePanel === 'settings' ? ' active' : '')}
        onClick={() => togglePanel('settings')}
        title={t('settings')}
        data-tour-id="settings"
      >⚙️</button>
    </div>
  );
}
