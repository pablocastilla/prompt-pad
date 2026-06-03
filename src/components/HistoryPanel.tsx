import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { t } from '../i18n';
import type { LaunchHistoryEntry, LaunchTool } from '../types';
import { TOOL_LABELS } from './ToolIcon';

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t('justNow');
  if (diffMin < 60) return `${diffMin}${t('minAgo')}`;
  if (diffHr < 24) return `${diffHr}${t('hrAgo')}`;
  if (diffDay < 7) return `${diffDay}${t('dayAgo')}`;
  return d.toLocaleDateString();
}

export function HistoryPanel() {
  const launchHistory = useStore(s => s.launchHistory);
  const setLaunchHistory = useStore(s => s.setLaunchHistory);
  const launches = useStore(s => s.launches);
  const addToast = useStore(s => s.addToast);
  const settings = useStore(s => s.settings);
  const createTabWithContent = useStore(s => s.createTabWithContent);
  const gaudy = (key: Parameters<typeof t>[0]) => { if (settings.theme === 'gaudy') addToast(t(key)); };

  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const existingLaunchIds = useMemo(() => new Set(launches.map(l => l.id)), [launches]);

  const filtered = useMemo(() => {
    let entries = launchHistory.filter(e => existingLaunchIds.has(e.launchId));
    if (search.trim()) {
      const q = search.toLowerCase();
      entries = entries.filter(e =>
        e.launchName.toLowerCase().includes(q) ||
        e.prompt.toLowerCase().includes(q) ||
        e.model.toLowerCase().includes(q) ||
        e.tool.toLowerCase().includes(q)
      );
    }
    return entries;
  }, [launchHistory, search, existingLaunchIds]);

  const grouped = useMemo(() => {
    const map = new Map<string, LaunchHistoryEntry[]>();
    for (const entry of filtered) {
      if (!map.has(entry.launchId)) map.set(entry.launchId, []);
      map.get(entry.launchId)!.push(entry);
    }
    return map;
  }, [filtered]);

  const groupIds = useMemo(() => [...grouped.keys()], [grouped]);

  // When search changes, auto-expand matching groups; when cleared, collapse all
  useEffect(() => {
    if (search.trim()) {
      setExpandedGroups(new Set(groupIds));
    } else {
      setExpandedGroups(new Set());
    }
  }, [search, groupIds]);

  const toggleGroup = (launchId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(launchId)) next.delete(launchId);
      else next.add(launchId);
      return next;
    });
  };

  const handleClearAll = async () => {
    setLaunchHistory([]);
    setExpandedGroups(new Set());
    await window.electronAPI.saveLaunchHistory([]);
    gaudy('gaudyClearHistory');
  };

  return (
    <div className="history-panel">
      <div className="history-search-row">
        <input
          type="text"
          className="history-search-input"
          placeholder={t('searchHistory')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {launchHistory.length > 0 && (
          <button className="btn-icon history-clear-btn" onClick={handleClearAll} title={t('clearHistory')}>🗑️</button>
        )}
      </div>

      {filtered.length === 0 && (
        <div className="history-empty">
          {search ? t('noHistoryResults') : t('noHistory')}
        </div>
      )}

      <div className="history-list">
        {[...grouped.entries()].map(([launchId, entries]) => {
          const launch = launches.find(l => l.id === launchId);
          const isCollapsed = !expandedGroups.has(launchId);
          const displayName = launch ? launch.name : entries[0]?.launchName || t('deletedLauncher');
          return (
            <div key={launchId} className={isCollapsed ? 'history-group history-group-collapsed' : 'history-group'}>
              <div className="history-group-header" onClick={() => toggleGroup(launchId)}>
                <button className="history-group-chevron" type="button">
                  {isCollapsed ? '▶' : '▼'}
                </button>
                <span className="history-group-name">{displayName}</span>
                <span className="history-group-count">{entries.length}</span>
              </div>
              {!isCollapsed && entries.map(entry => (
                <div
                  key={entry.id}
                  className="history-entry"
                  onDoubleClick={() => {
                    createTabWithContent(entry.prompt, entry.launchName);
                    if (settings.theme === 'gaudy') addToast(t('gaudyOpenHistory'));
                  }}
                >
                  <div className="history-entry-header">
                    <span className="history-entry-time">{formatTimestamp(entry.timestamp)}</span>
                    <span className="history-entry-model">{entry.model}</span>
                  </div>
                  <div className="history-entry-prompt-preview">
                    {entry.prompt}
                  </div>
                  <div className="history-entry-meta">
                    <span>{TOOL_LABELS[entry.tool as LaunchTool] ?? entry.tool}</span>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
