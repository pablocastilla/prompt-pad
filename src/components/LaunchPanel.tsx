import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { t } from '../i18n';
import type { LaunchConfig, LaunchTool } from '../types';

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const DEFAULT: Omit<LaunchConfig, 'id'> = {
  name: '', tool: 'copilot', folder: '', yolo: true, mode: 'interactive',
};

export function LaunchPanel() {
  const launches            = useStore(s => s.launches);
  const setLaunches         = useStore(s => s.setLaunches);
  const addLaunch           = useStore(s => s.addLaunch);
  const updateLaunch        = useStore(s => s.updateLaunch);
  const deleteLaunch        = useStore(s => s.deleteLaunch);
  const deleteLaunchHistoryByLaunchId = useStore(s => s.deleteLaunchHistoryByLaunchId);
  const launchHistory       = useStore(s => s.launchHistory);
  const selectedLaunchId    = useStore(s => s.selectedLaunchId);
  const setSelectedLaunchId = useStore(s => s.setSelectedLaunchId);
  const setPendingLaunch    = useStore(s => s.setPendingLaunch);
  const tabs                = useStore(s => s.tabs);
  const activeTabId         = useStore(s => s.activeTabId);
  const addToast            = useStore(s => s.addToast);
  const settings            = useStore(s => s.settings);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState<LaunchConfig>({ id: '', ...DEFAULT });
  const [dragIdx, setDragIdx]     = useState<number | null>(null);
  const [dropIdx, setDropIdx]     = useState<number | null>(null);

  const selectedLaunch = launches.find(l => l.id === selectedLaunchId) ?? null;
  const activeTab      = tabs.find(tab => tab.id === activeTabId);
  const gaudy          = (key: Parameters<typeof t>[0]) => { if (settings.theme === 'gaudy') addToast(t(key)); };
  const launchPosition = useMemo(
    () => new Map(launches.map((launch, index) => [launch.id, index])),
    [launches]
  );

  const getShortcutLabel = (index: number): string | null => {
    if (index < 0 || index > 9) return null;
    const key = index === 9 ? '0' : String(index + 1);
    return `Ctrl+Shift+${key}`;
  };

  // Open model picker (model chosen at launch time)
  const handleLaunch = () => {
    if (!selectedLaunch || !activeTab?.content.trim()) return;
    setPendingLaunch({
      launch: selectedLaunch,
      prompt: activeTab.content,
      attachedFilePaths: (activeTab.attachedFiles ?? []).map(f => f.path),
    });
  };

  const handleStartAdd = () => {
    const id = uid();
    setForm({ id, ...DEFAULT });
    setEditingId('__new__');
  };

  const handleStartEdit = (launch: LaunchConfig) => {
    setForm({ ...launch });
    setEditingId(launch.id);
  };

  const handleSaveForm = async () => {
    if (!form.name.trim()) return;
    if (editingId === '__new__') {
      addLaunch(form);
      await window.electronAPI.saveLaunches([...launches, form]);
      setSelectedLaunchId(form.id);
    } else {
      updateLaunch(form);
      await window.electronAPI.saveLaunches(launches.map(l => l.id === form.id ? form : l));
    }
    setEditingId(null);
    gaudy('gaudySave');
  };

  const handleDelete = async (id: string) => {
    deleteLaunch(id);
    deleteLaunchHistoryByLaunchId(id);
    if (selectedLaunchId === id) setSelectedLaunchId(null);
    await window.electronAPI.saveLaunches(launches.filter(l => l.id !== id));
    await window.electronAPI.saveLaunchHistory(launchHistory.filter(e => e.launchId !== id));
    gaudy('gaudyDelete');
  };

  const handlePickFolder = async () => {
    const folder = await window.electronAPI.pickFolder();
    if (folder) setForm(f => ({ ...f, folder }));
  };

  // ── Drag-to-reorder ──
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIdx(idx);
  };
  const handleDrop = async (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDropIdx(null); return; }
    const next = [...launches];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setLaunches(next);
    await window.electronAPI.saveLaunches(next);
    setDragIdx(null); setDropIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDropIdx(null); };

  return (
    <div className="launch-panel">
      {/* ── Config list ── */}
      <div className="panel-section">
        <div className="panel-section-header">
          <span className="panel-section-title">{t('configureLaunches')}</span>
          <div className="panel-section-actions">
            <button
              className="btn-icon"
              onClick={handleLaunch}
              disabled={!selectedLaunch || !activeTab?.content.trim()}
              title={t('noLaunchSelected')}
            >🚀</button>
            <button className="btn-icon" onClick={handleStartAdd} title={t('addLaunch')}>＋</button>
          </div>
        </div>

        {editingId === '__new__' && (
          <LaunchForm
            data={form} onChange={setForm}
            onSave={handleSaveForm} onCancel={() => setEditingId(null)}
            onPickFolder={handlePickFolder}
          />
        )}

        {launches.map((launch, idx) => (
          editingId === launch.id ? (
            <LaunchForm
              key={launch.id}
              data={form} onChange={setForm}
              onSave={handleSaveForm} onCancel={() => setEditingId(null)}
              onPickFolder={handlePickFolder}
            />
          ) : (
            <div
              key={launch.id}
              draggable
              className={
                'launch-list-item' +
                (launch.id === selectedLaunchId ? ' selected' : '') +
                (dragIdx === idx ? ' dragging' : '') +
                (dropIdx === idx && dragIdx !== idx ? ' drop-target' : '')
              }
              onClick={() => setSelectedLaunchId(launch.id)}
              onDragStart={e => handleDragStart(e, idx)}
              onDragOver={e => handleDragOver(e, idx)}
              onDrop={e => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
            >
              <div className="drag-handle" onClick={e => e.stopPropagation()}>⠿</div>
              <div className="launch-list-item-indicator" />
              <div className="launch-list-item-info">
                <div className="launch-list-item-title-row">
                  <div className="launch-list-item-name">{launch.name}</div>
                  {(() => {
                    const index = launchPosition.get(launch.id) ?? -1;
                    const shortcut = getShortcutLabel(index);
                    if (!shortcut) return null;
                    return <kbd className="launch-shortcut">{shortcut}</kbd>;
                  })()}
                </div>
                <div className="launch-list-item-meta">
                {launch.tool === 'opencode' ? 'opencode' : `copilot · ${launch.yolo ? 'YOLO' : 'safe'} · ${launch.mode === 'interactive' ? '-i' : '-p'}`}
              </div>
              </div>
              <div className="launch-list-item-actions">
                <button className="btn-icon" onClick={e => { e.stopPropagation(); handleStartEdit(launch); }}>✏️</button>
                <button className="btn-icon" onClick={e => { e.stopPropagation(); handleDelete(launch.id); }}>🗑️</button>
              </div>
            </div>
          )
        ))}

        {launches.length === 0 && !editingId && (
          <div className="launch-hint launch-empty-state">{t('noLaunches')}</div>
        )}
      </div>
    </div>
  );
}

interface LaunchFormProps {
  data: LaunchConfig;
  onChange: (data: LaunchConfig) => void;
  onSave: () => void;
  onCancel: () => void;
  onPickFolder: () => void;
}

function LaunchForm({ data, onChange, onSave, onCancel, onPickFolder }: LaunchFormProps) {
  return (
    <div className="launch-form">
      <div className="form-group">
        <label>{t('launchName')}</label>
        <input type="text" value={data.name} placeholder="My Project…" autoFocus
          onChange={e => onChange({ ...data, name: e.target.value })} />
      </div>
      <div className="form-group">
        <label>{t('launchTool')}</label>
        <div className="tool-selector">
          {(['copilot', 'opencode'] as LaunchTool[]).map(tool => (
            <button
              key={tool}
              className={'tool-btn' + (data.tool === tool ? ' active' : '')}
              onClick={() => onChange({ ...data, tool })}
              type="button"
            >
              {tool === 'copilot' ? '🤖 GitHub Copilot' : '⚡ OpenCode'}
            </button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label>{t('folder')}</label>
        <div className="folder-input-row">
          <input type="text" value={data.folder} placeholder="~/projects/…"
            onChange={e => onChange({ ...data, folder: e.target.value })} />
          <button className="btn btn-sm" onClick={onPickFolder}>{t('browseFolder')}</button>
        </div>
      </div>
      {data.tool !== 'opencode' && (
        <div className="form-group form-checkbox">
          <label>
            <input type="checkbox" checked={data.yolo}
              onChange={e => onChange({ ...data, yolo: e.target.checked })} />
            {t('yoloMode')}
          </label>
        </div>
      )}
      {data.tool !== 'opencode' && (
        <div className="form-group">
          <label>{t('launchMode')}</label>
          <select title={t('launchMode')} value={data.mode}
            onChange={e => onChange({ ...data, mode: e.target.value as 'interactive' | 'non-interactive' })}>
            <option value="interactive">{t('interactive')}</option>
            <option value="non-interactive">{t('nonInteractive')}</option>
          </select>
        </div>
      )}
      <div className="form-actions">
        <button className="btn btn-sm" onClick={onCancel}>{t('cancelBtn')}</button>
        <button className="btn btn-primary btn-sm" onClick={onSave}>{t('saveBtn')}</button>
      </div>
    </div>
  );
}
