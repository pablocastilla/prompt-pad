import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { t, setLanguage, detectLanguage } from '../i18n';
import type { Settings } from '../types';

export function SettingsPanel() {
  const settings    = useStore(s => s.settings);
  const setSettings = useStore(s => s.setSettings);
  const addToast    = useStore(s => s.addToast);
  const [oneDrivePath, setOneDrivePath] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    window.electronAPI.detectOneDrive().then(setOneDrivePath);
    window.electronAPI.getAppVersion().then(setAppVersion);
  }, []);

  const updateTheme = async (theme: Settings['theme']) => {
    const next = { ...settings, theme };
    setSettings(next);
    await window.electronAPI.saveSettings(next);
    if (theme === 'gaudy') addToast(t('gaudyTheme'));
  };

  const updateLanguage = async (language: Settings['language']) => {
    const next = { ...settings, language };
    setSettings(next);
    await window.electronAPI.saveSettings(next);
    if (language !== 'auto') {
      setLanguage(language);
    } else {
      window.electronAPI.getLocale().then(locale => setLanguage(detectLanguage(locale)));
    }
  };

  const toggleOneDrive = async () => {
    if (!oneDrivePath) return;
    const next = { ...settings, useOneDrive: !settings.useOneDrive };
    setSettings(next);
    await window.electronAPI.saveSettings(next);
  };

  const updateShortcutKeys = async (key: 'phraseShortcutKeys' | 'launchShortcutKeys', value: 'digit' | 'letter') => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    await window.electronAPI.saveSettings(next);
  };

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      await window.electronAPI.checkForUpdates();
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-section">
        <h4>{t('theme')}</h4>
        <div className="theme-cards">
          <button className={'theme-card' + (settings.theme === 'light' ? ' active' : '')} onClick={() => updateTheme('light')}>
            <div className="theme-preview theme-preview-light" />
            <span>{t('light')}</span>
          </button>
          <button className={'theme-card' + (settings.theme === 'dark' ? ' active' : '')} onClick={() => updateTheme('dark')}>
            <div className="theme-preview theme-preview-dark" />
            <span>{t('dark')}</span>
          </button>
          <button className={'theme-card' + (settings.theme === 'gaudy' ? ' active' : '')} onClick={() => updateTheme('gaudy')}>
            <div className="theme-preview theme-preview-gaudy" />
            <span>{t('gaudy')}</span>
          </button>
          <button className={'theme-card' + (settings.theme === 'cyberpunk' ? ' active' : '')} onClick={() => updateTheme('cyberpunk')}>
            <div className="theme-preview theme-preview-cyberpunk" />
            <span>{t('cyberpunk')}</span>
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h4>{t('language')}</h4>
        <select
          className="settings-select"
          title={t('language')}
          value={settings.language}
          onChange={e => updateLanguage(e.target.value as Settings['language'])}
        >
          <option value="auto">{t('langAuto')}</option>
          <option value="en">{t('langEnglish')}</option>
          <option value="es">{t('langSpanish')}</option>
        </select>
      </div>

      <div className="settings-section">
        <h4>{t('storage')}</h4>
        <div className="settings-info">~/.prompt-pad/</div>
        {oneDrivePath ? (
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={!!settings.useOneDrive}
              onChange={toggleOneDrive}
            />
            <span>{t('syncOneDrive')}</span>
            {settings.useOneDrive && (
              <div className="settings-info settings-info-small">{oneDrivePath}</div>
            )}
          </label>
        ) : (
          <div className="settings-info settings-muted">{t('oneDriveNotFound')}</div>
        )}
      </div>

      <div className="settings-section">
        <h4>{t('shortcutKeys')}</h4>
        <div className="settings-info" style={{ marginBottom: 8 }}>{t('shortcutKeysInfo')}</div>
        <div className="form-group">
          <label>{t('phraseShortcuts')}</label>
          <select
            className="settings-select"
            value={settings.phraseShortcutKeys}
            onChange={e => updateShortcutKeys('phraseShortcutKeys', e.target.value as 'digit' | 'letter')}
          >
            <option value="digit">{t('digits')}</option>
            <option value="letter">{t('letters')}</option>
          </select>
        </div>
        <div className="form-group">
          <label>{t('launchShortcuts')}</label>
          <select
            className="settings-select"
            value={settings.launchShortcutKeys}
            onChange={e => updateShortcutKeys('launchShortcutKeys', e.target.value as 'digit' | 'letter')}
          >
            <option value="digit">{t('digits')}</option>
            <option value="letter">{t('letters')}</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h4>{t('version')}</h4>
        <div className="settings-info settings-version">{appVersion ? `v${appVersion}` : '...'}</div>
        <button
          className="settings-update-btn"
          onClick={handleCheckForUpdates}
          disabled={checkingUpdate}
        >
          {checkingUpdate ? t('checkingUpdates') : t('checkForUpdates')}
        </button>
      </div>
    </div>
  );
}
