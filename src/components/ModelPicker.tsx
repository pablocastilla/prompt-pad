import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { modelsForTool, getModelCostInfo } from '../types';
import { t } from '../i18n';
import type { LaunchTool, ModelOption, Settings, LaunchHistoryEntry, CostTier } from '../types';

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function ModelPicker() {
  const pendingLaunch    = useStore(s => s.pendingLaunch);
  const setPendingLaunch = useStore(s => s.setPendingLaunch);
  const addToast         = useStore(s => s.addToast);
  const settings         = useStore(s => s.settings);
  const setSettings      = useStore(s => s.setSettings);
  const addLaunchHistoryEntry = useStore(s => s.addLaunchHistoryEntry);
  const launchHistory    = useStore(s => s.launchHistory);
  const triggerLaunchSplash = useStore(s => s.triggerLaunchSplash);

  const [modelCache, setModelCache] = useState<Record<LaunchTool, ModelOption[] | null>>({
    copilot: null,
    opencode: null,
    antigravity: null,
    'claude-code': null,
    codex: null,
  });
  const [loadingModels, setLoadingModels] = useState<Record<LaunchTool, boolean>>({
    copilot: false,
    opencode: false,
    antigravity: false,
    'claude-code': false,
    codex: false,
  });
  const listRef = useRef<HTMLDivElement | null>(null);
  const [dragPinnedIdx, setDragPinnedIdx] = useState<number | null>(null);
  const [dropPinnedIdx, setDropPinnedIdx] = useState<number | null>(null);
  const userScrolledRef = useRef(false);
  const [confirmExpensiveIdx, setConfirmExpensiveIdx] = useState<number | null>(null);

  const tool: LaunchTool = pendingLaunch?.launch.tool ?? 'copilot';
  const fallbackModels = modelsForTool(tool);
  const availableModels = modelCache[tool] ?? fallbackModels;
  const pinnedIds = settings.pinnedModels?.[tool] ?? [];
  const showGoOnly = settings.showGoModelsOnly?.[tool] ?? (tool === 'opencode' ? true : false);

  const filteredModels = useMemo(() => {
    if (!showGoOnly || tool !== 'opencode') return availableModels;
    return availableModels.filter(m => m.id.startsWith('opencode-go/'));
  }, [availableModels, showGoOnly, tool]);

  const pinnedModels = useMemo(
    () => pinnedIds.map(id => filteredModels.find(m => m.id === id)).filter((m): m is ModelOption => !!m),
    [pinnedIds, filteredModels]
  );
  const unpinnedModels = useMemo(
    () => filteredModels.filter(m => !pinnedIds.includes(m.id)),
    [filteredModels, pinnedIds]
  );
  const allModels = useMemo(() => [...pinnedModels, ...unpinnedModels], [pinnedModels, unpinnedModels]);

  const defaultIdx = pendingLaunch
    ? Math.max(0, allModels.findIndex(m => m.id === pendingLaunch.launch.model))
    : 0;

  const [selectedIdx, setSelectedIdx] = useState(defaultIdx);

  const setPinnedForTool = async (nextIds: string[]) => {
    const nextSettings: Settings = {
      ...settings,
      pinnedModels: {
        copilot: settings.pinnedModels?.copilot ?? [],
        opencode: settings.pinnedModels?.opencode ?? [],
        antigravity: settings.pinnedModels?.antigravity ?? [],
        'claude-code': settings.pinnedModels?.['claude-code'] ?? [],
        codex: settings.pinnedModels?.codex ?? [],
        [tool]: nextIds,
      },
    };
    setSettings(nextSettings);
    await window.electronAPI.saveSettings(nextSettings);
  };

  const togglePin = (modelId: string) => {
    if (pinnedIds.includes(modelId)) {
      void setPinnedForTool(pinnedIds.filter(id => id !== modelId));
      return;
    }
    void setPinnedForTool([...pinnedIds, modelId]);
  };

  const toggleGoOnly = async () => {
    const nextSettings: Settings = {
      ...settings,
      showGoModelsOnly: {
        ...settings.showGoModelsOnly,
        [tool]: !showGoOnly,
      },
    };
    setSettings(nextSettings);
    await window.electronAPI.saveSettings(nextSettings);
  };

  const reorderPinned = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const visibleIds = pinnedModels.map(m => m.id);
    if (!visibleIds[fromIdx] || !visibleIds[toIdx]) return;

    const reorderedVisible = [...visibleIds];
    const [moved] = reorderedVisible.splice(fromIdx, 1);
    reorderedVisible.splice(toIdx, 0, moved);

    const hiddenIds = pinnedIds.filter(id => !visibleIds.includes(id));
    void setPinnedForTool([...reorderedVisible, ...hiddenIds]);
  };

  const cleanStalePins = async (selectedTool: LaunchTool, fetchedIds: string[]) => {
    const pinned = settings.pinnedModels?.[selectedTool] ?? [];
    if (pinned.length === 0) return;
    const stale = pinned.filter(id => !fetchedIds.includes(id));
    if (stale.length === 0) return;
    void setPinnedForTool(pinned.filter(id => !stale.includes(id)));
  };

  const loadModels = async (selectedTool: LaunchTool, force = false) => {
    if (!force && (modelCache[selectedTool] || loadingModels[selectedTool])) return;
    setLoadingModels(prev => ({ ...prev, [selectedTool]: true }));
    const fallback = modelsForTool(selectedTool);
    try {
      let fetched: ModelOption[] = [];
      if (selectedTool === 'opencode') {
        fetched = await window.electronAPI.getOpenCodeModels();
      } else if (selectedTool === 'copilot') {
        fetched = await window.electronAPI.getCopilotModels();
      } else if (selectedTool === 'antigravity') {
        fetched = await window.electronAPI.getAntigravityModels();
      }
      if (!Array.isArray(fetched) || fetched.length === 0) {
        setModelCache(prev => ({ ...prev, [selectedTool]: fallback }));
        return;
      }

      const unique = new Map<string, ModelOption>();
      for (const item of fetched) {
        if (!item?.id) continue;
        unique.set(item.id, { id: item.id, label: item.label || item.id });
      }
      const list = [...unique.values()];
      const normalized = selectedTool === 'copilot'
        ? [{ id: 'auto', label: 'auto' }, ...list.filter(m => m.id !== 'auto')]
        : list;

      setModelCache(prev => ({ ...prev, [selectedTool]: normalized }));
      void cleanStalePins(selectedTool, normalized.map(m => m.id));
    } catch {
      setModelCache(prev => ({ ...prev, [selectedTool]: fallback }));
    } finally {
      setLoadingModels(prev => ({ ...prev, [selectedTool]: false }));
    }
  };

  const refreshModels = async () => {
    await window.electronAPI.clearModelCache();
    setModelCache({ copilot: null, opencode: null, antigravity: null, 'claude-code': null, codex: null });
    await loadModels(tool, true);
  };

  // Reset selection when a new pending launch arrives
  useEffect(() => {
    if (pendingLaunch) {
      void loadModels(tool);
      if (allModels.length > 0) {
        const ms = allModels;
        const idx = Math.max(0, ms.findIndex(m => m.id === pendingLaunch.launch.model));
        setSelectedIdx(idx);
      }
    }
  }, [pendingLaunch?.launch.id, tool]);

  // Never auto-scroll; keep list at top. User scrolls manually if needed.
  useEffect(() => {
    if (!pendingLaunch) return;
    const listEl = listRef.current;
    if (!listEl) return;
    listEl.scrollTop = 0;
  }, [pendingLaunch, allModels.length, tool]);

  const execute = async (idx: number) => {
    if (!pendingLaunch) return;
    const ms = allModels;
    if (!ms[idx]) return;
    const model = ms[idx].id;
    const cost = getModelCostInfo(model);
    if (cost && (cost.tier === 4 || cost.tier === 5) && confirmExpensiveIdx !== idx) {
      setConfirmExpensiveIdx(idx);
      return;
    }
    setConfirmExpensiveIdx(null);
    setPendingLaunch(null);
    const entry: LaunchHistoryEntry = {
      id: uid(),
      launchId: pendingLaunch.launch.id,
      launchName: pendingLaunch.launch.name,
      tool: pendingLaunch.launch.tool,
      model,
      prompt: pendingLaunch.prompt,
      timestamp: Date.now(),
      folder: pendingLaunch.launch.folder,
      yolo: pendingLaunch.launch.yolo,
      mode: pendingLaunch.launch.mode,
    };
    addLaunchHistoryEntry(entry);
    const updated = [entry, ...launchHistory].slice(0, 100);
    await window.electronAPI.saveLaunchHistory(updated);
    await window.electronAPI.executeLaunch({
      tool: pendingLaunch.launch.tool ?? 'copilot',
      model,
      folder: pendingLaunch.launch.folder,
      yolo: pendingLaunch.launch.yolo,
      prompt: pendingLaunch.prompt,
      mode: pendingLaunch.launch.mode,
      attachedFilePaths: pendingLaunch.attachedFilePaths,
    });
    if (settings.theme === 'gaudy') {
      triggerLaunchSplash();
      addToast(t('gaudyLaunch'));
    }
  };

  // Reset confirmation when picker closes
  useEffect(() => {
    if (!pendingLaunch) setConfirmExpensiveIdx(null);
  }, [pendingLaunch]);

  useEffect(() => {
    if (!pendingLaunch) return;
    const ms = allModels;
    if (!ms.length) return;
    const digitByCode: Record<string, number> = {
      Digit1: 0, Numpad1: 0,
      Digit2: 1, Numpad2: 1,
      Digit3: 2, Numpad3: 2,
      Digit4: 3, Numpad4: 3,
      Digit5: 4, Numpad5: 4,
      Digit6: 5, Numpad6: 5,
      Digit7: 6, Numpad7: 6,
      Digit8: 7, Numpad8: 7,
      Digit9: 8, Numpad9: 8,
      Digit0: 9, Numpad0: 9,
    };
    const handler = (e: KeyboardEvent) => {
      if (confirmExpensiveIdx !== null) {
        if (e.key === 'Enter') { e.preventDefault(); execute(confirmExpensiveIdx); }
        else if (e.key === 'Escape') { e.preventDefault(); setConfirmExpensiveIdx(null); }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => (i + 1) % ms.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => (i - 1 + ms.length) % ms.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        execute(selectedIdx);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPendingLaunch(null);
      } else if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        const idx = digitByCode[e.code];
        if (idx === undefined || !ms[idx]) return;
        e.preventDefault();
        togglePin(ms[idx].id);
      } else if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
        const idx = digitByCode[e.code];
        if (idx === undefined || idx >= pinnedModels.length) return;
        e.preventDefault();
        execute(idx);
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [pendingLaunch, selectedIdx, allModels, pinnedModels.length, pinnedIds, confirmExpensiveIdx]);

  function CostIndicator({ modelId }: { modelId: string }) {
    const info = getModelCostInfo(modelId);
    if (!info) return null;
    const { tier, tooltip } = info;
    if (tier === 'free') {
      return <span className="model-cost-badge model-cost-free" title={tooltip}>free</span>;
    }
    const maxBars = 5;
    const bars: string[] = [];
    for (let i = 0; i < Math.min(tier, maxBars); i++) {
      bars.push('▮');
    }
    for (let i = tier; i < maxBars; i++) {
      bars.push('▯');
    }
    return <span className="model-cost-bars" title={tooltip}>{bars.join('')}</span>;
  }

  if (!pendingLaunch) return null;

  const toolLabel = tool === 'opencode' ? '⚡ OpenCode' : tool === 'antigravity' ? '🌌 Antigravity' : tool === 'claude-code' ? '🧠 Claude Code' : tool === 'codex' ? '💡 Codex' : '🤖 GitHub Copilot';
  const isLoading = loadingModels[tool];
  const getShortcutLabel = (idx: number): string => `${(idx + 1) % 10}`;

  return (
    <div className="model-picker-overlay" onClick={() => setPendingLaunch(null)}>
      <div className="model-picker-card" onClick={e => e.stopPropagation()}>
        <div className="model-picker-header">
          <div className="model-picker-title">{t('selectModelToLaunch')}</div>
          <div className="model-picker-launch-name">{pendingLaunch.launch.name}</div>
          <div className="model-picker-tool-badge">{toolLabel}</div>
          <button
            className="model-picker-refresh-btn"
            onClick={e => { e.stopPropagation(); void refreshModels(); }}
            disabled={isLoading}
            title={t('refreshModels')}
          >{isLoading ? '⏳' : '🔄'}</button>
        </div>
        {tool === 'opencode' && (
          <label className="model-picker-go-toggle">
            <input type="checkbox" checked={showGoOnly} onChange={toggleGoOnly} />
            <span className="model-picker-go-checkbox" />
            <span>{t('showGoModelsOnly')}</span>
          </label>
        )}
        <div className="model-picker-list" ref={listRef}>
          {isLoading && <div className="model-picker-loading"><span className="model-picker-loading-dot" />{t('loadingModels')}</div>}
          {allModels.length === 0 ? (
            <div className="model-picker-loading">{t('loadingModels')}</div>
          ) : (
            <>
              {pinnedModels.length > 0 && <div className="model-picker-section-header">{t('pinnedModelsTitle')}</div>}
              {pinnedModels.map((m, idx) => (
                <div
                  key={`pinned-${m.id}`}
                  data-model-index={idx}
                  draggable
                  className={
                    'model-picker-item pinned' +
                    (idx === selectedIdx ? ' selected' : '') +
                    (dragPinnedIdx === idx ? ' dragging' : '') +
                    (dropPinnedIdx === idx && dragPinnedIdx !== idx ? ' drop-target' : '')
                  }
                  onClick={() => execute(idx)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onDragStart={(e) => {
                    setDragPinnedIdx(idx);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropPinnedIdx(idx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragPinnedIdx !== null) reorderPinned(dragPinnedIdx, idx);
                    setDragPinnedIdx(null);
                    setDropPinnedIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragPinnedIdx(null);
                    setDropPinnedIdx(null);
                  }}
                >
                  <span className="model-picker-drag-handle" title={t('dragHandleTitle')}>⠿</span>
                  <span className="model-picker-item-dot" />
                  <span className="model-picker-item-label">{m.label}</span>
                  <CostIndicator modelId={m.id} />
                  <span className="model-picker-shortcut">{getShortcutLabel(idx)}</span>
                  <button
                    className="model-picker-pin-btn pinned"
                    onClick={e => { e.stopPropagation(); togglePin(m.id); }}
                    title={t('unpinModel')}
                  >📌</button>
                </div>
              ))}
              {unpinnedModels.length > 0 && <div className="model-picker-section-header">{t('availableModelsTitle')}</div>}
              {unpinnedModels.map((m, idx) => {
                const absoluteIdx = pinnedModels.length + idx;
                return (
                  <div
                    key={m.id}
                    data-model-index={absoluteIdx}
                    className={'model-picker-item' + (absoluteIdx === selectedIdx ? ' selected' : '')}
                    onClick={() => execute(absoluteIdx)}
                    onMouseEnter={() => setSelectedIdx(absoluteIdx)}
                  >
                    <span className="model-picker-item-dot" />
                    <span className="model-picker-item-label">{m.label}</span>
                    <CostIndicator modelId={m.id} />
                    <button
                      className="model-picker-pin-btn"
                      onClick={e => { e.stopPropagation(); togglePin(m.id); }}
                      title={t('pinModel')}
                    >📍</button>
                  </div>
                );
              })}
            </>
          )}
        </div>
        <div className="model-picker-hint">
          {pinnedModels.length > 0 ? t('modelPickerHintPinned') : t('modelPickerHint')}
        </div>
        {confirmExpensiveIdx !== null && (
          <div className="model-picker-confirm-overlay">
            <div className="model-picker-confirm-card">
              <div className="model-picker-confirm-icon">⚠️</div>
              <div className="model-picker-confirm-text">{t('expensiveModelConfirm')}</div>
              <div className="model-picker-confirm-model">{allModels[confirmExpensiveIdx]?.label}</div>
              <div className="model-picker-confirm-actions">
                <button className="model-picker-confirm-btn model-picker-confirm-cancel" onClick={() => setConfirmExpensiveIdx(null)}>{t('cancelBtn')}</button>
                <button className="model-picker-confirm-btn model-picker-confirm-launch" onClick={() => execute(confirmExpensiveIdx)}>{t('launch')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
