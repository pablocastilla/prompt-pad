import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import type { GitFile } from '../types';

function statusLabel(status: string): { icon: string; cls: string } {
  const icons: Record<string, { icon: string; cls: string }> = {
    M: { icon: 'M', cls: 'git-status-modified' },
    A: { icon: 'A', cls: 'git-status-added' },
    D: { icon: 'D', cls: 'git-status-deleted' },
    R: { icon: 'R', cls: 'git-status-renamed' },
    '?': { icon: '?', cls: 'git-status-untracked' },
    '??': { icon: '?', cls: 'git-status-untracked' },
  };
  return icons[status] || { icon: status, cls: '' };
}

function IconX() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M6 6l12 12M18 6l-12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function IconBack() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function renderDiffLine(line: string, idx: number): React.ReactNode {
  const trimmed = line;
  let cls = 'git-diff-line';
  if (trimmed.startsWith('+++') || trimmed.startsWith('---') || trimmed.startsWith('diff --git')) {
    cls += ' git-diff-header';
  } else if (trimmed.startsWith('@@')) {
    cls += ' git-diff-hunk';
  } else if (trimmed.startsWith('+')) {
    cls += ' git-diff-added';
  } else if (trimmed.startsWith('-')) {
    cls += ' git-diff-removed';
  }
  return (
    <span key={idx} className={cls}>{trimmed || ' '}{'\n'}</span>
  );
}

export function GitDiffPanel() {
  const showGitPanel = useStore(s => s.showGitPanel);
  const setShowGitPanel = useStore(s => s.setShowGitPanel);
  const gitFolder = useStore(s => s.gitFolder);
  const gitFiles = useStore(s => s.gitFiles);
  const setGitFiles = useStore(s => s.setGitFiles);
  const selectedGitFile = useStore(s => s.selectedGitFile);
  const setSelectedGitFile = useStore(s => s.setSelectedGitFile);
  const gitFileDiff = useStore(s => s.gitFileDiff);
  const setGitFileDiff = useStore(s => s.setGitFileDiff);

  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const diffRef = useRef<HTMLDivElement | null>(null);

  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gitPanelWidth');
      return saved ? Math.max(180, Math.min(800, Number(saved))) : 320;
    }
    return 320;
  });
  const panelWidthRef = useRef(panelWidth);
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = panelWidth;
    panelWidthRef.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.max(180, Math.min(800, startWidthRef.current - delta));
      panelWidthRef.current = newWidth;
      setPanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('gitPanelWidth', String(panelWidthRef.current));
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const refreshStatus = async () => {
    if (!gitFolder) return;
    setLoading(true);
    try {
      const files = await window.electronAPI.getGitStatus(gitFolder);
      setGitFiles(files);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const refreshDiff = async (filePath: string, status?: string) => {
    if (!gitFolder) return;
    try {
      const diff = await window.electronAPI.getGitDiff(gitFolder, filePath, status);
      setGitFileDiff(diff);
    } catch {
      setGitFileDiff('');
    }
  };

  useEffect(() => {
    if (!showGitPanel) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    refreshStatus();

    intervalRef.current = setInterval(refreshStatus, 7000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [showGitPanel, gitFolder]);

  useEffect(() => {
    if (selectedGitFile) {
      const file = gitFiles.find(f => f.path === selectedGitFile);
      refreshDiff(selectedGitFile, file?.status);
    } else {
      setGitFileDiff('');
    }
  }, [selectedGitFile, gitFiles]);

  useEffect(() => {
    if (diffRef.current) {
      diffRef.current.scrollTop = 0;
    }
  }, [gitFileDiff]);

  const handleFileClick = (file: GitFile) => {
    if (selectedGitFile === file.path) {
      setSelectedGitFile(null);
    } else {
      setSelectedGitFile(file.path);
    }
  };

  const handleClose = () => {
    setShowGitPanel(false);
    setGitFiles([]);
    setSelectedGitFile(null);
    setGitFileDiff('');
  };

  if (!showGitPanel || !gitFolder) return null;

  const diffLines = gitFileDiff ? gitFileDiff.split('\n') : [];

  return (
    <div className="git-panel" style={{ width: panelWidth }}>
      <div className="git-panel-resize-handle" onMouseDown={handleResizeStart} />
      <div className="git-panel-header">
        <span className="git-panel-title">Git Changes</span>
        <div className="git-panel-header-actions">
          {loading && <span className="git-panel-loading" />}
          <button className="btn-icon" onClick={handleClose} title="Close"><IconX /></button>
        </div>
      </div>

      <div className="git-panel-body">
        {selectedGitFile ? (
          <>
            <div className="git-panel-diff-header">
              <button className="btn-icon" onClick={() => setSelectedGitFile(null)} title="Back to list"><IconBack /></button>
              <span className="git-panel-diff-filename">{selectedGitFile}</span>
            </div>
            <div className="git-panel-diff" ref={diffRef}>
              {diffLines.length === 0 || (diffLines.length === 1 && diffLines[0] === '') ? (
                <div className="git-panel-empty">No changes</div>
              ) : (
                <pre className="git-diff-content">{diffLines.map((line, idx) => renderDiffLine(line, idx))}</pre>
              )}
            </div>
          </>
        ) : (
          <>
            {gitFiles.length === 0 ? (
              <div className="git-panel-empty">
                {loading ? 'Checking...' : 'No changes detected'}
              </div>
            ) : (
              <div className="git-panel-files">
                {gitFiles.map((file, idx) => {
                  const { icon, cls } = statusLabel(file.status);
                  return (
                    <div
                      key={idx}
                      className="git-panel-file"
                      onClick={() => handleFileClick(file)}
                    >
                      <span className={`git-file-status ${cls}`}>{icon}</span>
                      <span className="git-file-path">{file.path}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
