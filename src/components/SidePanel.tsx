import React from 'react';
import { useStore } from '../store';
import { t } from '../i18n';
import { LaunchPanel } from './LaunchPanel';
import { PhraseCatalog } from './PhraseCatalog';
import { SettingsPanel } from './SettingsPanel';
import { HistoryPanel } from './HistoryPanel';

const TITLES = {
  launches:   'launches',
  phrases:    'phraseCatalog',
  settings:   'settings',
  history:    'launchHistory',
} as const;

export function SidePanel() {
  const activePanel = useStore(s => s.activePanel);
  if (!activePanel || activePanel === 'statistics') return null;

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <span className="side-panel-title">{t(TITLES[activePanel])}</span>
      </div>
      <div className="side-panel-body">
        {activePanel === 'launches'   && <LaunchPanel />}
        {activePanel === 'phrases'    && <PhraseCatalog />}
        {activePanel === 'settings'   && <SettingsPanel />}
        {activePanel === 'history'    && <HistoryPanel />}
      </div>
    </div>
  );
}
