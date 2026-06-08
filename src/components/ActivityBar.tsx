import React from 'react';
import { useStore } from '../store';
import { t } from '../i18n';

export function ActivityBar() {
  const activePanel = useStore(s => s.activePanel);
  const togglePanel = useStore(s => s.togglePanel);

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
        className={'activity-btn' + (activePanel === 'statistics' ? ' active' : '')}
        onClick={() => togglePanel('statistics')}
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
