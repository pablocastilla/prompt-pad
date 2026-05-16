import React from 'react';
import { useStore } from '../store';
import { t } from '../i18n';
import { LaunchPanel } from './LaunchPanel';
import { PhraseCatalog } from './PhraseCatalog';
import { SettingsPanel } from './SettingsPanel';

const TITLES = {
  launches: 'launches',
  phrases:  'phraseCatalog',
  settings: 'settings',
} as const;

export function SidePanel() {
  const activePanel = useStore(s => s.activePanel);
  if (!activePanel) return null;

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <span className="side-panel-title">{t(TITLES[activePanel])}</span>
      </div>
      <div className="side-panel-body">
        {activePanel === 'launches' && <LaunchPanel />}
        {activePanel === 'phrases'  && <PhraseCatalog />}
        {activePanel === 'settings' && <SettingsPanel />}
      </div>
    </div>
  );
}
