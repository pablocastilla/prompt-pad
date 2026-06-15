import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { t } from '../i18n';

interface HelpItem {
  tourId: 'launches' | 'phrases' | 'history' | 'statistics' | 'help' | 'settings';
  icon: string;
  titleKey: 'helpLaunchesTitle' | 'helpPhrasesTitle' | 'helpHistoryTitle' | 'helpStatsTitle' | 'helpHelpTitle' | 'helpSettingsTitle';
  textKey: 'helpLaunchesText' | 'helpPhrasesText' | 'helpHistoryText' | 'helpStatsText' | 'helpHelpText' | 'helpSettingsText';
}

const ITEMS: HelpItem[] = [
  { tourId: 'launches',   icon: '🚀',  titleKey: 'helpLaunchesTitle', textKey: 'helpLaunchesText' },
  { tourId: 'phrases',    icon: '📝',  titleKey: 'helpPhrasesTitle',  textKey: 'helpPhrasesText' },
  { tourId: 'history',    icon: '📜',  titleKey: 'helpHistoryTitle',  textKey: 'helpHistoryText' },
  { tourId: 'statistics', icon: '📊',  titleKey: 'helpStatsTitle',    textKey: 'helpStatsText' },
  { tourId: 'help',       icon: '❓',  titleKey: 'helpHelpTitle',     textKey: 'helpHelpText' },
  { tourId: 'settings',   icon: '⚙️', titleKey: 'helpSettingsTitle', textKey: 'helpSettingsText' },
];

export function HelpOverlay() {
  const helpOpen = useStore(s => s.helpOpen);
  const setHelpOpen = useStore(s => s.setHelpOpen);
  const settings = useStore(s => s.settings);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    closeBtnRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [helpOpen, setHelpOpen]);

  if (!helpOpen) return null;

  const gaudy = settings.theme === 'gaudy';

  return (
    <div
      className={'help-overlay' + (gaudy ? ' help-overlay-gaudy' : '')}
      role="dialog"
      aria-modal="true"
      aria-label={t('help')}
      onClick={() => setHelpOpen(false)}
    >
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <div className="help-card-header">
          <div className="help-card-eyebrow">{t('helpEyebrow')}</div>
          <div className="help-card-title">{t('helpTitle')}</div>
          <div className="help-card-subtitle">{t('helpSubtitle')}</div>
          <button
            className="help-close-x"
            onClick={() => setHelpOpen(false)}
            aria-label={t('helpCloseBtn')}
            title={t('helpCloseBtn')}
          >×</button>
        </div>
        <div className="help-items">
          {ITEMS.map(item => (
            <div className="help-item" key={item.tourId} data-help-for={item.tourId}>
              <span className="help-arrow" aria-hidden="true">{t('helpArrow')}</span>
              <span className="help-item-icon" aria-hidden="true">{item.icon}</span>
              <div className="help-item-body">
                <div className="help-item-title">{t(item.titleKey)}</div>
                <div className="help-item-text">{t(item.textKey)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="help-card-footer">
          <span className="help-card-hint">{t('helpFooter')}</span>
          <button
            ref={closeBtnRef}
            className="btn btn-primary help-close-btn"
            onClick={() => setHelpOpen(false)}
          >{t('helpCloseBtn')}</button>
        </div>
      </div>
    </div>
  );
}
