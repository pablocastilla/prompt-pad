import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { getModelCostInfo } from '../types';
import { t } from '../i18n';
import type { LaunchTool, ModelOption, Settings, LaunchHistoryEntry } from '../types';
import { ToolIcon, TOOL_LABELS } from './ToolIcon';

// Providers offered when launching. Order matters: numeric shortcuts 1..N map by position.
const ALL_TOOLS: LaunchTool[] = ['opencode', 'copilot', 'claude-code', 'codex', 'antigravity'];

// Providers that expose a CLI-driven model list; others launch with the CLI's default model.
const TOOLS_WITH_MODEL_PICKER: LaunchTool[] = ['opencode', 'copilot', 'antigravity'];

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export type ProviderPickerStep = 'provider' | 'model';

const EMPTY_PROVIDER_NUMERIC_SHORTCUT: Record<string, number> = {
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

export function ModelPicker() {
  const pendingLaunch    = useStore(s => s.pendingLaunch);
  const setPendingLaunch = useStore(s => s.setPendingLaunch);
  const addToast         = useStore(s => s.addToast);
  const settings         = useStore(s => s.settings);
  const setSettings      = useStore(s => s.setSettings);
  const addLaunchHistoryEntry = useStore(s => s.addLaunchHistoryEntry);
  const launchHistory    = useStore(s => s.launchHistory);
  const triggerLaunchSplash = useStore(s => s.triggerLaunchSplash);

  const [providerStep, setProviderStep] = useState<ProviderPickerStep>('provider');
  const [providerIdx, setProviderIdx] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<LaunchTool | null>(null);

  const emptyToolRecord = <T,>(value: T): Record<LaunchTool, T> => ({
    copilot: value,
    opencode: value,
    antigravity: value,
    'claude-code': value,
    codex: value,
    gemini: value,
  });

  const [modelCache, setModelCache] = useState<Record<LaunchTool, ModelOption[] | null>>(() => emptyToolRecord<ModelOption[] | null>(null));
  const [loadingModels, setLoadingModels] = useState<Record<LaunchTool, boolean>>(() => emptyToolRecord(false));
  const [modelError, setModelError] = useState<Record<LaunchTool, string | null>>(() => emptyToolRecord<string | null>(null));
  const listRef = useRef<HTMLDivElement | null>(null);
  const [dragPinnedIdx, setDragPinnedIdx] = useState<number | null>(null);
  const [dropPinnedIdx, setDropPinnedIdx] = useState<number | null>(null);
  const [confirmExpensiveIdx, setConfirmExpensiveIdx] = useState<number | null>(null);

  const tool: LaunchTool = selectedProvider ?? ALL_TOOLS[0];
  const availableModels = modelCache[tool] ?? [];
  const pinnedIds = settings.pinnedModels?.[tool] ?? [];
  const showGoOnly = settings.showGoModelsOnly?.[tool] ?? (tool === 'opencode' ? true : false);
  const showFreeOnly = settings.showFreeModelsOnly?.[tool] ?? false;

  const filteredModels = useMemo(() => {
    let result = availableModels;
    if (tool === 'opencode') {
      if (showGoOnly && showFreeOnly) {
        result = availableModels.filter(m => m.id.startsWith('opencode-go/') && (m.id.toLowerCase().includes('free') || m.label.toLowerCase().includes('free')));
      } else if (showGoOnly) {
        result = availableModels.filter(m => m.id.startsWith('opencode-go/'));
      } else if (showFreeOnly) {
        result = availableModels.filter(m => m.id.toLowerCase().includes('free') || m.label.toLowerCase().includes('free'));
      }
    }
    return result;
  }, [availableModels, showGoOnly, showFreeOnly, tool]);

  const pinnedModels = useMemo(
    () => pinnedIds.map(id => filteredModels.find(m => m.id === id)).filter((m): m is ModelOption => !!m),
    [pinnedIds, filteredModels]
  );
  const unpinnedModels = useMemo(
    () => filteredModels.filter(m => !pinnedIds.includes(m.id)),
    [filteredModels, pinnedIds]
  );
  const allModels = useMemo(() => [...pinnedModels, ...unpinnedModels], [pinnedModels, unpinnedModels]);

  const [selectedIdx, setSelectedIdx] = useState(0);

  const setPinnedForTool = async (nextIds: string[]) => {
    const existingPinned = settings.pinnedModels ?? {};
    const nextSettings: Settings = {
      ...settings,
      pinnedModels: {
        ...existingPinned,
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

  const toggleFreeOnly = async () => {
    const nextSettings: Settings = {
      ...settings,
      showFreeModelsOnly: {
        ...settings.showFreeModelsOnly,
        [tool]: !showFreeOnly,
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
    if (!TOOLS_WITH_MODEL_PICKER.includes(selectedTool)) return;
    if (!force && (modelCache[selectedTool] || loadingModels[selectedTool])) return;
    setLoadingModels(prev => ({ ...prev, [selectedTool]: true }));
    setModelError(prev => ({ ...prev, [selectedTool]: null }));
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
        setModelError(prev => ({ ...prev, [selectedTool]: t('modelsUnavailable') }));
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
      setModelError(prev => ({ ...prev, [selectedTool]: t('modelsUnavailable') }));
    } finally {
      setLoadingModels(prev => ({ ...prev, [selectedTool]: false }));
    }
  };

  const refreshModels = async () => {
    await window.electronAPI.clearModelCache();
    setModelCache(emptyToolRecord<ModelOption[] | null>(null));
    await loadModels(tool, true);
  };

  // Trigger model loading once a provider with model picker support is selected
  useEffect(() => {
    if (pendingLaunch && selectedProvider && TOOLS_WITH_MODEL_PICKER.includes(selectedProvider)) {
      void loadModels(selectedProvider);
    }
  }, [pendingLaunch?.launch.id, selectedProvider]);

  // Reset provider step when a new pending launch arrives
  useEffect(() => {
    setProviderStep('provider');
    setProviderIdx(0);
    setSelectedProvider(null);
    setSelectedIdx(0);
  }, [pendingLaunch?.launch.id]);

  // Never auto-scroll; keep list at top. User scrolls manually if needed.
  useEffect(() => {
    if (!pendingLaunch) return;
    const listEl = listRef.current;
    if (!listEl) return;
    listEl.scrollTop = 0;
  }, [pendingLaunch, allModels.length, tool]);

  const setShowGitPanel = useStore(s => s.setShowGitPanel);
  const setGitFolder = useStore(s => s.setGitFolder);

  const launchWithModel = async (toolForLaunch: LaunchTool, model: string) => {
    if (!pendingLaunch) return;
    const folder = pendingLaunch.launch.folder;
    setPendingLaunch(null);
    const entry: LaunchHistoryEntry = {
      id: uid(),
      launchId: pendingLaunch.launch.id,
      launchName: pendingLaunch.launch.name,
      tool: toolForLaunch,
      model,
      prompt: pendingLaunch.prompt,
      timestamp: Date.now(),
      folder,
    };
    addLaunchHistoryEntry(entry);
    const updated = [entry, ...launchHistory].slice(0, 100);
    await window.electronAPI.saveLaunchHistory(updated);
    await window.electronAPI.executeLaunch({
      tool: toolForLaunch,
      model,
      folder,
      yolo: true,
      prompt: pendingLaunch.prompt,
      mode: 'interactive',
      attachedFilePaths: pendingLaunch.attachedFilePaths,
    });
    if (folder) {
      setGitFolder(folder);
      setShowGitPanel(true);
    }
    if (settings.theme === 'gaudy') {
      triggerLaunchSplash();
      addToast(t('gaudyLaunch'));
    }
  };

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
    await launchWithModel(tool, model);
  };

  const selectProvider = (provider: LaunchTool) => {
    if (TOOLS_WITH_MODEL_PICKER.includes(provider)) {
      setSelectedProvider(provider);
      setProviderStep('model');
      return;
    }
    // Providers without a model picker: launch directly with default model
    void launchWithModel(provider, '');
  };

  // Reset confirmation when picker closes
  useEffect(() => {
    if (!pendingLaunch) setConfirmExpensiveIdx(null);
  }, [pendingLaunch]);

  // Keyboard handler for the provider step (numeric 1..N, arrows, Enter, Esc)
  useEffect(() => {
    if (!pendingLaunch || providerStep !== 'provider') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setProviderIdx(i => (i + 1) % ALL_TOOLS.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setProviderIdx(i => (i - 1 + ALL_TOOLS.length) % ALL_TOOLS.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectProvider(ALL_TOOLS[providerIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPendingLaunch(null);
      } else if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        const idx = EMPTY_PROVIDER_NUMERIC_SHORTCUT[e.code];
        if (idx === undefined || idx >= ALL_TOOLS.length) return;
        e.preventDefault();
        setProviderIdx(idx);
        selectProvider(ALL_TOOLS[idx]);
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [pendingLaunch, providerStep, providerIdx, launchHistory, settings]);

  // Keyboard handler for the model step (existing behaviour)
  useEffect(() => {
    if (!pendingLaunch || providerStep !== 'model') return;
    const ms = allModels;
    if (!ms.length) return;
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
        setProviderStep('provider');
      } else if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        const idx = EMPTY_PROVIDER_NUMERIC_SHORTCUT[e.code];
        if (idx === undefined || !ms[idx]) return;
        e.preventDefault();
        togglePin(ms[idx].id);
      } else if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
        const idx = EMPTY_PROVIDER_NUMERIC_SHORTCUT[e.code];
        if (idx === undefined || idx >= pinnedModels.length) return;
        e.preventDefault();
        execute(idx);
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [pendingLaunch, providerStep, selectedIdx, allModels, pinnedModels.length, pinnedIds, confirmExpensiveIdx]);

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

  function TierBadge({ modelId }: { modelId: string }) {
    if (modelId.startsWith('opencode-go/')) {
      return <span className="model-tier-badge model-tier-go">Go</span>;
    }
    if (modelId.startsWith('opencode/')) {
      return <span className="model-tier-badge model-tier-zen">Zen</span>;
    }
    return null;
  }

  if (!pendingLaunch) return null;

  const isLoading = loadingModels[tool];
  const getShortcutLabel = (idx: number): string => `${(idx + 1) % 10}`;

  if (providerStep === 'provider') {
    return (
      <div className="model-picker-overlay" onClick={() => setPendingLaunch(null)}>
        <div className="model-picker-card" onClick={e => e.stopPropagation()}>
          <div className="model-picker-header">
            <div className="model-picker-title">{t('selectProviderToLaunch')}</div>
            <div className="model-picker-launch-name">{pendingLaunch.launch.name}</div>
          </div>
          <div className="provider-picker-list">
            {ALL_TOOLS.map((provider, idx) => (
              <div
                key={provider}
                data-provider={provider}
                data-provider-index={idx}
                className={'model-picker-item provider-picker-item' + (idx === providerIdx ? ' selected' : '')}
                onClick={() => { setProviderIdx(idx); selectProvider(provider); }}
                onMouseEnter={() => setProviderIdx(idx)}
              >
                <span className="provider-picker-shortcut">{idx + 1}</span>
                <span className="launch-tool-icon"><ToolIcon tool={provider} /></span>
                <span className="model-picker-item-label">{TOOL_LABELS[provider]}</span>
              </div>
            ))}
          </div>
          <div className="model-picker-hint">{t('providerPickerHint')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="model-picker-overlay" onClick={() => setPendingLaunch(null)}>
      <div className="model-picker-card" onClick={e => e.stopPropagation()}>
        <div className="model-picker-header">
          <button
            className="model-picker-back-btn"
            onClick={e => { e.stopPropagation(); setProviderStep('provider'); }}
            title={t('backToProvider')}
          >←</button>
          <div className="model-picker-title">{t('selectModelToLaunch')}</div>
          <div className="model-picker-launch-name">{pendingLaunch.launch.name}</div>
          <div className="model-picker-tool-badge">
            <span className="launch-tool-icon"><ToolIcon tool={tool} /></span>
            <span>{TOOL_LABELS[tool]}</span>
          </div>
          <button
            className="model-picker-refresh-btn"
            onClick={e => { e.stopPropagation(); void refreshModels(); }}
            disabled={isLoading}
            title={t('refreshModels')}
          >{isLoading ? '⏳' : '🔄'}</button>
        </div>
        {tool === 'opencode' && (
          <>
            <label className="model-picker-go-toggle">
              <input type="checkbox" checked={showGoOnly} onChange={toggleGoOnly} />
              <span className="model-picker-go-checkbox" />
              <span>{t('showGoModelsOnly')}</span>
            </label>
            <label className="model-picker-go-toggle">
              <input type="checkbox" checked={showFreeOnly} onChange={toggleFreeOnly} />
              <span className="model-picker-go-checkbox" />
              <span>{t('showFreeModelsOnly')}</span>
            </label>
          </>
        )}
        <div className="model-picker-list" ref={listRef}>
          {isLoading && <div className="model-picker-loading"><span className="model-picker-loading-dot" />{t('loadingModels')}</div>}
          {allModels.length === 0 ? (
            modelError[tool] ? (
              <div className="model-picker-error">{modelError[tool]}</div>
            ) : (
              <div className="model-picker-loading">{t('loadingModels')}</div>
            )
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
                  <TierBadge modelId={m.id} />
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
                    <TierBadge modelId={m.id} />
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
              <div className="model-picker-confirm-model">
                {allModels[confirmExpensiveIdx]?.label}
                {allModels[confirmExpensiveIdx] && <TierBadge modelId={allModels[confirmExpensiveIdx].id} />}
              </div>
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
