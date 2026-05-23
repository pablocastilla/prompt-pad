import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { t } from '../i18n';
import type { Phrase } from '../types';

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function PhraseCatalog() {
  const phrases          = useStore(s => s.phrases);
  const setPhrases       = useStore(s => s.setPhrases);
  const addPhrase        = useStore(s => s.addPhrase);
  const updatePhrase     = useStore(s => s.updatePhrase);
  const deletePhrase     = useStore(s => s.deletePhrase);
  const activeTabId      = useStore(s => s.activeTabId);
  const requestInsertion = useStore(s => s.requestInsertion);
  const addToast         = useStore(s => s.addToast);
  const settings         = useStore(s => s.settings);

  const [search,  setSearch]  = useState('');
  const [editing, setEditing] = useState<Phrase | null>(null);
  const [isNew,   setIsNew]   = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const filtered = phrases.filter(p =>
    search === '' ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.content.toLowerCase().includes(search.toLowerCase())
  );

  const phrasePosition = useMemo(
    () => new Map(phrases.map((phrase, index) => [phrase.id, index])),
    [phrases]
  );

  const getShortcutLabel = (shortcut: string): string | null => {
    if (!shortcut) return null;
    const mod = settings.phraseShortcutModifier;
    if (mod === 'ctrl') return `Ctrl+${shortcut}`;
    if (mod === 'ctrl+shift') return `Ctrl+Shift+${shortcut}`;
    if (mod === 'ctrl+alt') return `Ctrl+Alt+${shortcut}`;
    if (mod === 'ctrl+alt+shift') return `Ctrl+Alt+Shift+${shortcut}`;
    return `Ctrl+${shortcut}`;
  };

  const gaudy = (key: Parameters<typeof t>[0]) => { if (settings.theme === 'gaudy') addToast(t(key)); };

  const handleInsert = (phrase: Phrase) => { requestInsertion(activeTabId, phrase.content, 'catalog'); gaudy('gaudyPhrase'); };
  const handleAdd    = () => { setEditing({ id: uid(), name: '', content: '' }); setIsNew(true); };
  const handleEdit   = (phrase: Phrase) => { setEditing({ ...phrase }); setIsNew(false); };

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) return;
    const next = isNew ? [...phrases, editing] : phrases.map(p => p.id === editing.id ? editing : p);
    isNew ? addPhrase(editing) : updatePhrase(editing);
    await window.electronAPI.savePhrases(next);
    setEditing(null);
    gaudy('gaudySave');
  };

  const handleDelete = async (id: string) => {
    deletePhrase(id);
    await window.electronAPI.savePhrases(phrases.filter(p => p.id !== id));
    gaudy('gaudyDelete');
  };

  // ── Drag-to-reorder (only when not searching) ──
  const handleDragStart = (e: React.DragEvent, origIdx: number) => {
    setDragIdx(origIdx);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, origIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIdx(origIdx);
  };
  const handleDrop = async (e: React.DragEvent, origIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === origIdx) { setDragIdx(null); setDropIdx(null); return; }
    const next = [...phrases];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(origIdx, 0, moved);
    setPhrases(next);
    await window.electronAPI.savePhrases(next);
    setDragIdx(null); setDropIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDropIdx(null); };

  const canDrag = search === '';

  return (
    <div className="phrase-catalog">
      <div className="phrase-search-row">
        <input
          type="search" className="phrase-search"
          placeholder={t('searchPhrases')}
          value={search} onChange={e => setSearch(e.target.value)}
        />
      </div>

      {editing && (
        <div className="phrase-form">
          <div className="phrase-form-title">{isNew ? t('addPhrase') : t('editPhrase')}</div>
          <div className="form-group">
            <label>{t('phraseName')}</label>
            <input type="text" title={t('phraseName')} value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })} autoFocus />
          </div>
          <div className="form-group">
            <label>{t('phraseContent')}</label>
            <textarea title={t('phraseContent')} value={editing.content} rows={4}
              onChange={e => setEditing({ ...editing, content: e.target.value })} />
</div>
          <div className="form-group">
            <label>{t('shortcut')}</label>
            <select title={t('shortcut')} value={editing.shortcut ?? ''}
              onChange={e => setEditing({ ...editing, shortcut: e.target.value === '' ? undefined : e.target.value })}>
              <option value="">{t('shortcutNone')}</option>
              {Array.from('1234567890QWERTYUIOPASDFGHJKLZXCVBNM').map(n => (
                <option key={n} value={n}>Ctrl+{n}</option>
              ))}
            </select>
          </div>
          <div className="form-actions">
            <button className="btn btn-sm" onClick={() => setEditing(null)}>{t('cancelBtn')}</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave}>{t('saveBtn')}</button>
          </div>
        </div>
      )}

      <div className="panel-section">
        <div className="panel-section-header">
          <span className="panel-section-title">{t('phrases')}</span>
          <button className="btn-icon" onClick={handleAdd} title={t('addPhrase')}>＋</button>
        </div>
        <div className="phrase-list">
          {filtered.length === 0 && (
            <p className="phrase-empty">{search ? 'No matches' : t('noPhrases')}</p>
          )}
          {filtered.map(phrase => {
            const origIdx = phrasePosition.get(phrase.id) ?? -1;
            return (
              <div
                key={phrase.id}
                draggable={canDrag}
                className={
                  'phrase-item' +
                  (dragIdx === origIdx ? ' dragging' : '') +
                  (dropIdx === origIdx && dragIdx !== origIdx ? ' drop-target' : '')
                }
                onDragStart={canDrag ? e => handleDragStart(e, origIdx) : undefined}
                onDragOver={canDrag ? e => handleDragOver(e, origIdx) : undefined}
                onDrop={canDrag ? e => handleDrop(e, origIdx) : undefined}
                onDragEnd={canDrag ? handleDragEnd : undefined}
                onClick={() => handleInsert(phrase)}
              >
                {canDrag && <div className="drag-handle" onClick={e => e.stopPropagation()}>⠿</div>}
                <div className="phrase-item-main">
                  <div className="phrase-item-name-row">
                    <div className="phrase-item-name">{phrase.name}</div>
                    {phrase.shortcut !== undefined && (() => {
                      const shortcut = getShortcutLabel(phrase.shortcut!);
                      if (!shortcut) return null;
                      return <kbd className="phrase-shortcut">{shortcut}</kbd>;
                    })()}
                  </div>
                  <div className="phrase-item-preview">{phrase.content.slice(0, 80)}{phrase.content.length > 80 ? '…' : ''}</div>
                </div>
                <div className="phrase-item-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn-icon" onClick={() => handleEdit(phrase)}>✏️</button>
                  <button className="btn-icon" onClick={() => handleDelete(phrase.id)}>🗑️</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
