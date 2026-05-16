import React, { useCallback } from 'react';
import { useStore } from '../store';
import { t } from '../i18n';
import type { AttachedFile } from '../types';

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

interface Props {
  tabId: string;
}

export function AttachedFilesBar({ tabId }: Props) {
  const tabs              = useStore(s => s.tabs);
  const attachFileToTab   = useStore(s => s.attachFileToTab);
  const removeFileFromTab = useStore(s => s.removeFileFromTab);
  const addToast          = useStore(s => s.addToast);
  const settings          = useStore(s => s.settings);

  const tab           = tabs.find(t => t.id === tabId);
  const attachedFiles = tab?.attachedFiles ?? [];
  const [isDragOver, setIsDragOver] = React.useState(false);

  const toast = useCallback(() => {
    if (settings.theme === 'gaudy') addToast(t('gaudyAttach'));
  }, [settings.theme, addToast]);

  // ── Add files by absolute path (from IPC picker or drag/drop) ──────────────
  const attachPaths = useCallback((items: { name: string; path: string; size: number }[]) => {
    let added = 0;
    for (const item of items) {
      if (!item.path) continue;
      attachFileToTab(tabId, { id: uid(), name: item.name, path: item.path, size: item.size });
      added++;
    }
    if (added > 0) toast();
  }, [tabId, attachFileToTab, toast]);

  // ── Save a raw image blob (Snipping Tool etc.) via IPC then attach ──────────
  const processBlobItem = useCallback(async (item: DataTransferItem): Promise<boolean> => {
    const ext = item.type === 'image/jpeg' ? 'jpg'
      : item.type === 'image/gif'  ? 'gif'
      : item.type === 'image/webp' ? 'webp'
      : 'png';
    const blob = item.getAsFile();
    if (!blob) return false;
    const arrayBuffer = await blob.arrayBuffer();
    const result = await window.electronAPI.saveBlob(Array.from(new Uint8Array(arrayBuffer)), ext);
    if (!result) return false;
    attachFileToTab(tabId, { id: uid(), name: result.name, path: result.path, size: result.size });
    return true;
  }, [tabId, attachFileToTab]);

  // ── Handle paste: filesystem files OR raw image blobs ──────────────────────
  const processClipboard = useCallback(async (clipboardData: DataTransfer) => {
    // 1. Filesystem files (Ctrl+C from Explorer) → have .path in Electron
    const fileItems = Array.from(clipboardData.files) as (File & { path?: string })[];
    const withPath = fileItems.filter(f => f.path);
    if (withPath.length > 0) {
      attachPaths(withPath.map(f => ({ name: f.name, path: f.path!, size: f.size })));
      return;
    }
    // 2. Image blob via Web API — try getAsFile(), fall back to Electron native
    const imageItems = Array.from(clipboardData.items).filter(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (imageItems.length > 0) {
      let pasted = 0;
      for (const item of imageItems) {
        const blob = item.getAsFile();
        if (blob) {
          if (await processBlobItem(item)) pasted++;
        } else {
          // getAsFile() returned null → Electron native clipboard (Snipping Tool)
          const result = await window.electronAPI.readClipboardImage();
          if (result) {
            attachFileToTab(tabId, { id: uid(), name: result.name, path: result.path, size: result.size });
            pasted++;
          }
          break;
        }
      }
      if (pasted > 0) toast();
      return;
    }
    // 3. No web API items at all — try Electron native clipboard as last resort
    const result = await window.electronAPI.readClipboardImage();
    if (result) {
      attachFileToTab(tabId, { id: uid(), name: result.name, path: result.path, size: result.size });
      toast();
    }
  }, [attachPaths, processBlobItem, attachFileToTab, tabId, toast]);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files) as (File & { path?: string })[];
    attachPaths(files.filter(f => f.path).map(f => ({ name: f.name, path: f.path!, size: f.size })));
  }, [attachPaths]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const hasFiles  = e.clipboardData.files.length > 0;
    const hasImages = Array.from(e.clipboardData.items).some(i => i.kind === 'file' && i.type.startsWith('image/'));
    const hasNativeImage = !hasFiles && !hasImages && window.electronAPI.clipboardHasImage();

    if (!hasFiles && !hasImages && !hasNativeImage) return;
    e.preventDefault();

    if (hasFiles) {
      const files = Array.from(e.clipboardData.files) as (File & { path?: string })[];
      attachPaths(files.filter(f => f.path).map(f => ({ name: f.name, path: f.path!, size: f.size })));
      return;
    }

    if (hasImages) {
      await processClipboard(e.clipboardData);
      return;
    }

    // Native image (Snipping Tool / PrintScreen)
    const result = await window.electronAPI.readClipboardImage();
    if (result) {
      attachFileToTab(tabId, { id: uid(), name: result.name, path: result.path, size: result.size });
      toast();
    }
  }, [attachPaths, processClipboard, attachFileToTab, tabId, toast]);

  // ── File picker via native Electron dialog (reliable absolute paths) ───────
  const handleClickAttach = useCallback(async () => {
    const files = await window.electronAPI.pickFiles();
    if (files.length > 0) attachPaths(files);
  }, [attachPaths]);

  return (
    <div
      className={'attached-files-bar' + (isDragOver ? ' drag-over' : '')}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onPaste={handlePaste}
    >
      {/* File chips — shown when there are attached files */}
      {attachedFiles.length > 0 && (
        <div className="attach-chips-row">
          <div className="attach-chips">
            {attachedFiles.map((f) => (
              <FileChip
                key={f.id}
                file={f}
                onRemove={() => removeFileFromTab(tabId, f.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Drop zone / hint — always visible */}
      <button
        className="attach-drop-zone"
        onClick={handleClickAttach}
        title={t('attachFiles')}
        aria-label={t('attachFiles')}
      >
        <span className="attach-drop-icon">📎</span>
        <span className="attach-drop-hint">{t('attachFilesHint')}</span>
      </button>
    </div>
  );
}

function FileChip({ file, onRemove }: { file: AttachedFile; onRemove: () => void }) {
  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? '' : '';
  return (
    <span className="attach-chip" title={file.path}>
      <span className="attach-chip-ext">{ext || '?'}</span>
      <span className="attach-chip-name">{file.name}</span>
      <span className="attach-chip-size">{formatBytes(file.size)}</span>
      <button
        className="attach-chip-remove"
        onClick={onRemove}
        title={t('removeFile')}
        aria-label={t('removeFile')}
      >×</button>
    </span>
  );
}
