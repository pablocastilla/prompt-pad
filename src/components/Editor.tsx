import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '../store';
import { t } from '../i18n';
import { AttachedFilesBar } from './AttachedFilesBar';

interface BurstPosition {
  id: number;
}

interface HistoryEntry {
  content: string;
  phraseRanges: Array<{ start: number; end: number }>;
  selectionStart: number;
  selectionEnd: number;
  afterContent?: string;
  afterPhraseRanges?: Array<{ start: number; end: number }>;
}

const GAUDY_PALETTES = [
  { burstA: 'rgba(255, 226, 138, .95)', burstB: 'rgba(103, 245, 230, .95)', burstC: 'rgba(255, 120, 200, .9)' },
  { burstA: 'rgba(255, 172, 111, .92)', burstB: 'rgba(255, 120, 200, .92)', burstC: 'rgba(155, 239, 255, .88)' },
  { burstA: 'rgba(197, 255, 122, .9)', burstB: 'rgba(255, 226, 138, .92)', burstC: 'rgba(255, 120, 200, .9)' },
];

function getPlainTextFromEditor(editor: HTMLElement): string {
  return (editor.textContent ?? '').replace(/\u00A0/g, ' ');
}

function syncEditorValue(editor: HTMLElement, text: string) {
  (editor as unknown as { value: string }).value = text;
}

function getSelectionOffsets(editor: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;

  const preStart = range.cloneRange();
  preStart.selectNodeContents(editor);
  preStart.setEnd(range.startContainer, range.startOffset);

  const preEnd = range.cloneRange();
  preEnd.selectNodeContents(editor);
  preEnd.setEnd(range.endContainer, range.endOffset);

  return {
    start: preStart.toString().length,
    end: preEnd.toString().length,
  };
}

function setSelectionOffsets(editor: HTMLElement, start: number, end: number) {
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  if (textNodes.length === 0) {
    const empty = document.createTextNode('');
    editor.appendChild(empty);
    textNodes.push(empty);
  }

  const totalLength = textNodes.reduce((acc, n) => acc + n.data.length, 0);
  const clampedStart = Math.max(0, Math.min(start, totalLength));
  const clampedEnd = Math.max(0, Math.min(end, totalLength));

  const locate = (offset: number): { node: Text; offset: number } => {
    let remaining = offset;
    for (const textNode of textNodes) {
      if (remaining <= textNode.data.length) {
        return { node: textNode, offset: remaining };
      }
      remaining -= textNode.data.length;
    }
    const last = textNodes[textNodes.length - 1];
    return { node: last, offset: last.data.length };
  };

  const startPos = locate(clampedStart);
  const endPos = locate(clampedEnd);
  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);

  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function renderEditorText(editor: HTMLElement, text: string, phraseRanges?: Array<{ start: number; end: number }>) {
  editor.innerHTML = '';

  if (!phraseRanges || phraseRanges.length === 0) {
    editor.appendChild(document.createTextNode(text));
    syncEditorValue(editor, text);
    return;
  }

  const sorted = [...phraseRanges].sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const r of sorted) {
    if (r.start >= r.end) continue;
    const clampedStart = Math.max(pos, Math.min(r.start, text.length));
    const clampedEnd = Math.max(clampedStart, Math.min(r.end, text.length));
    if (pos < clampedStart) {
      editor.appendChild(document.createTextNode(text.slice(pos, clampedStart)));
    }
    if (clampedStart < clampedEnd) {
      const span = document.createElement('span');
      span.className = 'phrase-text';
      span.textContent = text.slice(clampedStart, clampedEnd);
      editor.appendChild(span);
      pos = clampedEnd;
    }
  }
  if (pos < text.length) {
    editor.appendChild(document.createTextNode(text.slice(pos)));
  }
  syncEditorValue(editor, text);
}

function getBurstPosition(editor: HTMLElement, content: string, caretOffset: number): { left: number; top: number } {
  const style = window.getComputedStyle(editor);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const lineHeight = parseFloat(style.lineHeight) || 24;
  const fontSize = parseFloat(style.fontSize) || 14;
  const charWidth = fontSize * 0.6;
  const usableWidth = Math.max(40, editor.clientWidth - paddingLeft - paddingRight);
  const columns = Math.max(1, Math.floor(usableWidth / charWidth));
  const beforeCaret = content.slice(0, Math.max(0, Math.min(caretOffset, content.length)));

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
    left: paddingLeft + col * charWidth - editor.scrollLeft,
    top: paddingTop + row * lineHeight - editor.scrollTop,
  };
}

function adjustPhraseRanges(
  ranges: Array<{ start: number; end: number }>,
  oldText: string,
  newText: string,
  _caret: number,
): Array<{ start: number; end: number }> {
  let editStart = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (editStart < minLen && oldText[editStart] === newText[editStart]) editStart++;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > editStart && newEnd > editStart && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const delta = (newEnd - editStart) - (oldEnd - editStart);
  const result: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    if (r.end <= editStart) {
      result.push(r);
    } else if (r.start >= oldEnd) {
      result.push({ start: r.start + delta, end: r.end + delta });
    }
  }
  return result;
}

export function Editor() {
  const activeTabId = useStore(s => s.activeTabId);
  const tabs = useStore(s => s.tabs);
  const theme = useStore(s => s.settings.theme);
  const updateTabContent = useStore(s => s.updateTabContent);
  const setTabPhraseRanges = useStore(s => s.setTabPhraseRanges);
  const insertionSignal = useStore(s => s.insertionSignal);
  const clearInsertion = useStore(s => s.clearInsertion);
  const attachFileToTab = useStore(s => s.attachFileToTab);
  const addToast = useStore(s => s.addToast);

  const activeTab = tabs.find(tab => tab.id === activeTabId);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const editorRef = useRef<HTMLDivElement>(null);
  const editorSurfaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef(activeTab?.content || '');
  const typingTimeoutRef = useRef<number | null>(null);
  const paletteIndexRef = useRef(0);
  const suppressInputRef = useRef(false);
  const [isTyping, setIsTyping] = useState(false);
  const [burst, setBurst] = useState<BurstPosition | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteBurst, setDeleteBurst] = useState<BurstPosition | null>(null);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [isEditorEmpty, setIsEditorEmpty] = useState(!(activeTab?.content ?? '').length);
  const prevLengthRef = useRef(activeTab?.content.length ?? 0);
  
  // Undo/Redo history
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const isUndoRedoRef = useRef(false);
  const lastContentRef = useRef(activeTab?.content || '');
  const typingTimerRef = useRef<number | null>(null);
  const preTypingStateRef = useRef<{ content: string; phraseRanges: Array<{ start: number; end: number }> } | null>(null);

  const finalizeTypingBatch = useCallback(() => {
    typingTimerRef.current = null;
    const preState = preTypingStateRef.current;
    preTypingStateRef.current = null;
    if (!preState) return;
    const currentContent = contentRef.current;
    const tab = activeTabRef.current;
    if (!tab) return;
    // Only push if content actually changed
    if (preState.content !== currentContent) {
      // Remove any future history if we're in the middle of the stack
      if (historyIndexRef.current < historyRef.current.length - 1) {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      }
      // Add entry with both before and after states
      historyRef.current.push({
        content: preState.content,
        phraseRanges: preState.phraseRanges,
        selectionStart: 0,
        selectionEnd: 0,
        afterContent: currentContent,
        afterPhraseRanges: tab.phraseRanges,
      });
      // Limit history size
      if (historyRef.current.length > 100) {
        historyRef.current.shift();
      }
      historyIndexRef.current = historyRef.current.length - 1;
    }
  }, []);

  const pushToHistory = useCallback((content: string, phraseRanges: Array<{ start: number; end: number }>, _selectionStart: number, _selectionEnd: number) => {
    // Debounce: group rapid keystrokes into one undo step
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
    }
    // Save pre-typing state on first keystroke of a batch
    if (!preTypingStateRef.current) {
      preTypingStateRef.current = { content, phraseRanges };
    }
    typingTimerRef.current = window.setTimeout(finalizeTypingBatch, 500);
  }, [finalizeTypingBatch]);

  const undo = useCallback(() => {
    if (historyIndexRef.current < 0) return;
    isUndoRedoRef.current = true;
    
    // Finalize any pending typing batch first
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
      finalizeTypingBatch();
    }
    
    const editor = editorSurfaceRef.current;
    if (!editor || !activeTab) { isUndoRedoRef.current = false; return; }
    
    const entry = historyRef.current[historyIndexRef.current];
    // Restore the "before" state of this entry
    renderEditorText(editor, entry.content, entry.phraseRanges);
    syncEditorValue(editor, entry.content);
    setSelectionOffsets(editor, entry.selectionStart, entry.selectionEnd);
    
    contentRef.current = entry.content;
    prevLengthRef.current = entry.content.length;
    setIsEditorEmpty(entry.content.length === 0);
    updateTabContent(activeTabId, entry.content);
    setTabPhraseRanges(activeTabId, entry.phraseRanges);
    lastContentRef.current = entry.content;
    historyIndexRef.current--;
    editor.focus();
    isUndoRedoRef.current = false;
  }, [activeTabId, activeTab, updateTabContent, setTabPhraseRanges, finalizeTypingBatch]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current++;
    
    const editor = editorSurfaceRef.current;
    if (!editor || !activeTab) { isUndoRedoRef.current = false; return; }
    
    const entry = historyRef.current[historyIndexRef.current];
    // Restore the "after" state of this entry
    const afterContent = entry.afterContent ?? entry.content;
    const afterRanges = entry.afterPhraseRanges ?? entry.phraseRanges;
    renderEditorText(editor, afterContent, afterRanges);
    syncEditorValue(editor, afterContent);
    setSelectionOffsets(editor, entry.selectionStart, entry.selectionEnd);
    
    contentRef.current = afterContent;
    prevLengthRef.current = afterContent.length;
    setIsEditorEmpty(afterContent.length === 0);
    updateTabContent(activeTabId, afterContent);
    setTabPhraseRanges(activeTabId, afterRanges);
    lastContentRef.current = afterContent;
    editor.focus();
    isUndoRedoRef.current = false;
  }, [activeTabId, activeTab, updateTabContent, setTabPhraseRanges]);

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

  const handleEditorDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsFileDragOver(true);
    }
  }, []);

  const handleEditorDragLeave = useCallback(() => setIsFileDragOver(false), []);

  const handleEditorDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    setIsFileDragOver(false);
    const files = Array.from(e.dataTransfer.files) as (File & { path?: string })[];
    attachPaths(files.filter(f => f.path).map(f => ({ name: f.name, path: f.path!, size: f.size })));
  }, [attachPaths]);

  const insertPlainTextAtSelection = useCallback((insertText: string, source: 'catalog' | 'shortcut' = 'shortcut') => {
    const editor = editorSurfaceRef.current;
    const tab = activeTabRef.current;
    if (!editor || !tab) return;

    const current = getPlainTextFromEditor(editor);
    const selection = getSelectionOffsets(editor) ?? { start: current.length, end: current.length };
    
    // Clear any pending typing batch since this is an atomic operation
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
      preTypingStateRef.current = null;
    }
    
    // Push to history before making changes (atomic operation)
    if (!isUndoRedoRef.current) {
      // Remove any future history if we're in the middle of the stack
      if (historyIndexRef.current < historyRef.current.length - 1) {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      }
      historyRef.current.push({
        content: current,
        phraseRanges: tab.phraseRanges,
        selectionStart: selection.start,
        selectionEnd: selection.end,
      });
      if (historyRef.current.length > 100) {
        historyRef.current.shift();
      }
      historyIndexRef.current = historyRef.current.length - 1;
    }
    
    const newText = current.slice(0, selection.start) + insertText + current.slice(selection.end);
    const insertStart = selection.start;
    const insertEnd = selection.start + insertText.length;
    const shift = insertText.length - (selection.end - selection.start);

    const newRanges: Array<{ start: number; end: number }> = [];
    for (const r of tab.phraseRanges) {
      if (r.end <= selection.start) {
        newRanges.push(r);
      } else if (r.start >= selection.end) {
        newRanges.push({ start: r.start + shift, end: r.end + shift });
      }
    }
    if (source === 'catalog') {
      newRanges.push({ start: insertStart, end: insertEnd });
    }

    renderEditorText(editor, newText, newRanges);
    setSelectionOffsets(editor, insertEnd, insertEnd);

    contentRef.current = newText;
    prevLengthRef.current = newText.length;
    setIsEditorEmpty(newText.length === 0);
    updateTabContent(activeTabId, newText);
    setTabPhraseRanges(activeTabId, newRanges);
    syncEditorValue(editor, newText);
    lastContentRef.current = newText;
    editor.focus();
  }, [activeTabId, updateTabContent, setTabPhraseRanges]);

  const processEditorPaste = useCallback(async (clipboardData: DataTransfer | null) => {
    const fileItems = Array.from(clipboardData?.files ?? []) as (File & { path?: string })[];
    const withPath = fileItems.filter(file => file.path);

    if (withPath.length > 0) {
      attachPaths(withPath.map(file => ({ name: file.name, path: file.path!, size: file.size })));
      return true;
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
      return pasted > 0;
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
      return true;
    }
    return false;
  }, [attachPaths, attachFileToTab, activeTabId, theme, addToast]);

  const handleNativeEditorPaste = useCallback((event: ClipboardEvent) => {
    const clipboardData = event.clipboardData;
    const hasFiles = (clipboardData?.files.length ?? 0) > 0;
    const hasImages = Array.from(clipboardData?.items ?? []).some(item => item.kind === 'file' && item.type.startsWith('image/'));
    const hasNativeImage = !hasFiles && !hasImages && window.electronAPI.clipboardHasImage();
    const pastedText = clipboardData?.getData('text/plain') ?? '';

    if (!hasFiles && !hasImages && !hasNativeImage && !pastedText) return;
    event.preventDefault();

    if (pastedText && !hasFiles && !hasImages && !hasNativeImage) {
      suppressInputRef.current = true;
      insertPlainTextAtSelection(pastedText, 'shortcut');
      return;
    }

    void processEditorPaste(clipboardData);
  }, [processEditorPaste, insertPlainTextAtSelection]);

  useEffect(() => {
    const editor = editorSurfaceRef.current;
    if (!editor) return;

    editor.addEventListener('paste', handleNativeEditorPaste);
    return () => editor.removeEventListener('paste', handleNativeEditorPaste);
  }, [handleNativeEditorPaste]);

  useEffect(() => {
    contentRef.current = activeTab?.content || '';
    prevLengthRef.current = activeTab?.content.length ?? 0;
    lastContentRef.current = activeTab?.content || '';
    setIsEditorEmpty((activeTab?.content.length ?? 0) === 0);
    if (editorSurfaceRef.current) {
      renderEditorText(editorSurfaceRef.current, contentRef.current, activeTab?.phraseRanges);
      syncEditorValue(editorSurfaceRef.current, contentRef.current);
    }
    // Reset history for this tab
    historyRef.current = [{ content: contentRef.current, phraseRanges: activeTab?.phraseRanges || [], selectionStart: 0, selectionEnd: 0 }];
    historyIndexRef.current = 0;
    // Clear any pending typing timer
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    preTypingStateRef.current = null;
  }, [activeTabId]);

  useEffect(() => {
    const editor = editorSurfaceRef.current;
    if (!editor || isUndoRedoRef.current) return;
    const nextContent = activeTab?.content || '';
    if (nextContent === contentRef.current) return;

    const selection = getSelectionOffsets(editor);
    contentRef.current = nextContent;
    prevLengthRef.current = nextContent.length;
    lastContentRef.current = nextContent;
    setIsEditorEmpty(nextContent.length === 0);
    renderEditorText(editor, nextContent, activeTab?.phraseRanges);
    syncEditorValue(editor, nextContent);

    if (selection) {
      const offset = Math.min(selection.start, nextContent.length);
      setSelectionOffsets(editor, offset, offset);
    }
  }, [activeTab?.content]);

  useEffect(() => {
    if (!insertionSignal || insertionSignal.tabId !== activeTabId) return;
    suppressInputRef.current = true;
    insertPlainTextAtSelection(insertionSignal.text, insertionSignal.source);
    clearInsertion();
  }, [insertionSignal, activeTabId, insertPlainTextAtSelection, clearInsertion]);

  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    if (suppressInputRef.current || isUndoRedoRef.current) {
      suppressInputRef.current = false;
      return;
    }
    const editor = e.currentTarget;
    const selection = getSelectionOffsets(editor);
    const newContent = getPlainTextFromEditor(editor);
    const newLen = newContent.length;
    const wasDeleting = newLen < prevLengthRef.current;
    const oldText = contentRef.current;
    
    // Push to history if content actually changed
    if (oldText !== newContent && activeTabRef.current) {
      const sel = selection ?? { start: newContent.length, end: newContent.length };
      pushToHistory(oldText, activeTabRef.current.phraseRanges, sel.start, sel.end);
    }
    
    prevLengthRef.current = newLen;
    contentRef.current = newContent;
    updateTabContent(activeTabId, newContent);
    syncEditorValue(editor, newContent);
    setIsEditorEmpty(newLen === 0);

    if (activeTabRef.current && activeTabRef.current.phraseRanges.length > 0 && oldText !== newContent) {
      const caret = selection?.start ?? newContent.length;
      setTabPhraseRanges(activeTabId, adjustPhraseRanges(activeTabRef.current.phraseRanges, oldText, newContent, caret));
    }

    if (theme === 'gaudy') {
      const caretOffset = selection?.start ?? newContent.length;
      const { left, top } = getBurstPosition(editor, newContent, caretOffset);
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
  }, [activeTabId, theme, updateTabContent, setTabPhraseRanges, pushToHistory]);

  const handleEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Handle Undo (Ctrl+Z)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    
    // Handle Redo (Ctrl+Y or Ctrl+Shift+Z)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }
    
    if (e.key === 'Enter') {
      e.preventDefault();
      suppressInputRef.current = true;
      insertPlainTextAtSelection('\n', 'shortcut');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      suppressInputRef.current = true;
      insertPlainTextAtSelection('  ', 'shortcut');
    }
  }, [insertPlainTextAtSelection, undo, redo]);

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
    if (typingTimerRef.current !== null) window.clearTimeout(typingTimerRef.current);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
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
      <div
        ref={editorSurfaceRef}
        className={
          'editor-textarea' +
          (isEditorEmpty ? ' is-empty' : '') +
          (isFileDragOver ? ' file-drag-over' : '')
        }
        data-placeholder={t('placeholder')}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleEditorKeyDown}
        onDragOver={handleEditorDragOver}
        onDragLeave={handleEditorDragLeave}
        onDrop={handleEditorDrop}
        spellCheck={false}
      />
      <AttachedFilesBar tabId={activeTabId} />

    </div>
  );
}
