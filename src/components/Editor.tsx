import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '../store';
import { t } from '../i18n';
import { AttachedFilesBar } from './AttachedFilesBar';

interface BurstPosition {
  id: number;
}

const GAUDY_PALETTES = [
  { burstA: 'rgba(255, 226, 138, .95)', burstB: 'rgba(103, 245, 230, .95)', burstC: 'rgba(255, 120, 200, .9)' },
  { burstA: 'rgba(255, 172, 111, .92)', burstB: 'rgba(255, 120, 200, .92)', burstC: 'rgba(155, 239, 255, .88)' },
  { burstA: 'rgba(197, 255, 122, .9)',  burstB: 'rgba(255, 226, 138, .92)', burstC: 'rgba(255, 120, 200, .9)' },
];

function getBurstPosition(textarea: HTMLTextAreaElement): { left: number; top: number } {
  const style = window.getComputedStyle(textarea);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const lineHeight = parseFloat(style.lineHeight) || 24;
  const fontSize = parseFloat(style.fontSize) || 14;
  const charWidth = fontSize * 0.6;
  const usableWidth = Math.max(40, textarea.clientWidth - paddingLeft - paddingRight);
  const columns = Math.max(1, Math.floor(usableWidth / charWidth));
  const selectionStart = textarea.selectionStart ?? textarea.value.length;
  const beforeCaret = textarea.value.slice(0, selectionStart);

  let row = 0;
  let col = 0;
  for (const char of beforeCaret) {
    if (char === '\n') {
      row += 1;
      col = 0;
      continue;
    }

    col += 1;
    if (col >= columns) {
      row += 1;
      col = 0;
    }
  }

  return {
    left: paddingLeft + col * charWidth - textarea.scrollLeft,
    top: paddingTop + row * lineHeight - textarea.scrollTop,
  };
}

export function Editor() {
  const activeTabId = useStore(s => s.activeTabId);
  const tabs = useStore(s => s.tabs);
  const theme = useStore(s => s.settings.theme);
  const updateTabContent = useStore(s => s.updateTabContent);
  const insertionSignal = useStore(s => s.insertionSignal);
  const clearInsertion = useStore(s => s.clearInsertion);
  const attachFileToTab = useStore(s => s.attachFileToTab);
  const addToast = useStore(s => s.addToast);

  const activeTab = tabs.find(tab => tab.id === activeTabId);
  const editorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef(activeTab?.content || '');
  const typingTimeoutRef = useRef<number | null>(null);
  const paletteIndexRef = useRef(0);
  const [isTyping, setIsTyping] = useState(false);
  const [burst, setBurst] = useState<BurstPosition | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteBurst, setDeleteBurst] = useState<BurstPosition | null>(null);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [catalogInsertHighlight, setCatalogInsertHighlight] = useState(false);
  const prevLengthRef = useRef(activeTab?.content.length ?? 0);
  const catalogInsertTimerRef = useRef<number | null>(null);

  // ── File attachment via drag-and-drop / paste onto textarea ──────────
  const attachPaths = useCallback((items: { name: string; path: string; size: number }[]) => {
    let added = 0;
    for (const item of items) {
      if (!item.path) continue;
      attachFileToTab(activeTabId, {
        id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        name: item.name,
        path: item.path,
        size: item.size,
      });
      added++;
    }
    if (added > 0 && theme === 'gaudy') addToast(t('gaudyAttach'));
  }, [activeTabId, attachFileToTab, addToast, theme]);

  const handleTextareaDragOver = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    // Only intercept if the drag contains files
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsFileDragOver(true);
    }
  }, []);

  const handleTextareaDragLeave = useCallback(() => setIsFileDragOver(false), []);

  const handleTextareaDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    if (e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    setIsFileDragOver(false);
    const files = Array.from(e.dataTransfer.files) as (File & { path?: string })[];
    attachPaths(files.filter(f => f.path).map(f => ({ name: f.name, path: f.path!, size: f.size })));
  }, [attachPaths]);

  const processTextareaPaste = useCallback(async (clipboardData: DataTransfer | null) => {
    const fileItems = Array.from(clipboardData?.files ?? []) as (File & { path?: string })[];
    const withPath = fileItems.filter(file => file.path);

    if (withPath.length > 0) {
      attachPaths(withPath.map(file => ({ name: file.name, path: file.path!, size: file.size })));
      return;
    }

    const imageItems = Array.from(clipboardData?.items ?? []).filter(item => item.kind === 'file' && item.type.startsWith('image/'));
    if (imageItems.length > 0) {
      let pasted = 0;
      for (const item of imageItems) {
        const ext = item.type === 'image/jpeg' ? 'jpg' : item.type === 'image/gif' ? 'gif' : item.type === 'image/webp' ? 'webp' : 'png';
        const blob = item.getAsFile();
        if (blob) {
          const result = await window.electronAPI.saveBlob(Array.from(new Uint8Array(await blob.arrayBuffer())), ext);
          if (result) {
            attachFileToTab(activeTabId, {
              id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
              name: result.name,
              path: result.path,
              size: result.size,
            });
            pasted++;
          }
        }
      }
      if (pasted === 0) {
        const result = await window.electronAPI.readClipboardImage();
        if (result) {
          attachFileToTab(activeTabId, {
            id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
            name: result.name,
            path: result.path,
            size: result.size,
          });
          pasted++;
        }
      }
      if (pasted > 0 && theme === 'gaudy') addToast(t('gaudyAttach'));
      return;
    }

    const result = await window.electronAPI.readClipboardImage();
    if (result) {
      attachFileToTab(activeTabId, {
        id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        name: result.name,
        path: result.path,
        size: result.size,
      });
      if (theme === 'gaudy') addToast(t('gaudyAttach'));
    }
  }, [attachPaths, attachFileToTab, activeTabId, theme, addToast]);

  const handleNativeTextareaPaste = useCallback((event: ClipboardEvent) => {
    const clipboardData = event.clipboardData;
    const hasFiles = (clipboardData?.files.length ?? 0) > 0;
    const hasImages = Array.from(clipboardData?.items ?? []).some(item => item.kind === 'file' && item.type.startsWith('image/'));
    const hasNativeImage = !hasFiles && !hasImages && window.electronAPI.clipboardHasImage();

    if (!hasFiles && !hasImages && !hasNativeImage) return;
    event.preventDefault();
    void processTextareaPaste(clipboardData);
  }, [processTextareaPaste]);

  useEffect(() => {
    contentRef.current = activeTab?.content || '';
    prevLengthRef.current = activeTab?.content.length ?? 0;
    setCatalogInsertHighlight(false);
    if (catalogInsertTimerRef.current !== null) {
      window.clearTimeout(catalogInsertTimerRef.current);
      catalogInsertTimerRef.current = null;
    }
    if (textareaRef.current) {
      textareaRef.current.value = contentRef.current;
    }
  }, [activeTabId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.addEventListener('paste', handleNativeTextareaPaste);
    return () => textarea.removeEventListener('paste', handleNativeTextareaPaste);
  }, [handleNativeTextareaPaste]);

  // Handle phrase insertion
  useEffect(() => {
    if (!insertionSignal || insertionSignal.tabId !== activeTabId) return;

    const ta = textareaRef.current;
    if (!ta) { clearInsertion(); return; }

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.substring(0, start);
    const after = ta.value.substring(end);
    const newContent = before + insertionSignal.text + after;
    const insertStart = start;
    const insertEnd = start + insertionSignal.text.length;

    ta.value = newContent;
    contentRef.current = newContent;
    updateTabContent(activeTabId, newContent);

    if (insertionSignal.source === 'catalog') {
      ta.selectionStart = insertStart;
      ta.selectionEnd = insertEnd;
      setCatalogInsertHighlight(true);
      if (catalogInsertTimerRef.current !== null) window.clearTimeout(catalogInsertTimerRef.current);
      catalogInsertTimerRef.current = window.setTimeout(() => {
        ta.selectionStart = insertEnd;
        ta.selectionEnd = insertEnd;
        setCatalogInsertHighlight(false);
      }, 950);
    } else {
      ta.selectionStart = insertEnd;
      ta.selectionEnd = insertEnd;
    }

    ta.focus();

    clearInsertion();
  }, [insertionSignal]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newLen = e.target.value.length;
    const wasDeleting = newLen < prevLengthRef.current;
    prevLengthRef.current = newLen;
    contentRef.current = e.target.value;
    updateTabContent(activeTabId, e.target.value);

    if (theme === 'gaudy') {
      const { left, top } = getBurstPosition(e.target);
      editorRef.current?.style.setProperty('--gaudy-burst-left', `${left}px`);
      editorRef.current?.style.setProperty('--gaudy-burst-top', `${top}px`);

      if (wasDeleting) {
        setIsDeleting(true);
        setDeleteBurst({ id: Date.now() });
        if (typingTimeoutRef.current !== null) window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = window.setTimeout(() => {
          setIsDeleting(false);
          setDeleteBurst(null);
        }, 200);
      } else {
        const paletteIndex = paletteIndexRef.current;
        const palette = GAUDY_PALETTES[paletteIndex % GAUDY_PALETTES.length];
        paletteIndexRef.current = (paletteIndex + 1) % 1000;
        editorRef.current?.style.setProperty('--gaudy-burst-a', palette.burstA);
        editorRef.current?.style.setProperty('--gaudy-burst-b', palette.burstB);
        editorRef.current?.style.setProperty('--gaudy-burst-c', palette.burstC);
        setBurst({ id: Date.now() });
        setIsTyping(true);
        if (typingTimeoutRef.current !== null) window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = window.setTimeout(() => {
          setIsTyping(false);
          setBurst(null);
        }, 180);
      }
    }
  }, [activeTabId, theme, updateTabContent]);

  useEffect(() => {
    if (theme === 'gaudy') return;
    setIsTyping(false);
    setBurst(null);
    setIsDeleting(false);
    setDeleteBurst(null);
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, [theme]);

  useEffect(() => () => {
    if (typingTimeoutRef.current !== null) window.clearTimeout(typingTimeoutRef.current);
    if (catalogInsertTimerRef.current !== null) window.clearTimeout(catalogInsertTimerRef.current);
  }, []);

  // Ctrl+S shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        // Trigger save from toolbar - dispatch a custom event
        document.dispatchEvent(new CustomEvent('prompt-pad:save'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!activeTab) return null;

  return (
    <div ref={editorRef} className={
      'editor' +
      (theme === 'gaudy' && isTyping ? ' typing' : '') +
      (theme === 'gaudy' && isDeleting ? ' deleting' : '')
    }>
      {theme === 'gaudy' && burst && (
        <div className="gaudy-burst" key={burst.id} aria-hidden="true">
          <span className="gaudy-burst-dot gaudy-burst-dot-a" />
          <span className="gaudy-burst-dot gaudy-burst-dot-b" />
          <span className="gaudy-burst-dot gaudy-burst-dot-c" />
        </div>
      )}
      {theme === 'gaudy' && deleteBurst && (
        <div className="gaudy-delete-burst" key={`del-${deleteBurst.id}`} aria-hidden="true">
          <span className="gaudy-delete-dot gaudy-delete-dot-a" />
          <span className="gaudy-delete-dot gaudy-delete-dot-b" />
          <span className="gaudy-delete-dot gaudy-delete-dot-c" />
        </div>
      )}
      <textarea
        ref={textareaRef}
        className={
          'editor-textarea' +
          (isFileDragOver ? ' file-drag-over' : '') +
          (catalogInsertHighlight ? ' phrase-catalog-highlight' : '')
        }
        defaultValue={activeTab.content}
        onChange={handleChange}
        onDragOver={handleTextareaDragOver}
        onDragLeave={handleTextareaDragLeave}
        onDrop={handleTextareaDrop}
        placeholder={t('placeholder')}
        spellCheck={false}
      />
      <AttachedFilesBar tabId={activeTabId} />

    </div>
  );
}
