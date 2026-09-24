import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useStore } from '../store';
import type { OpenCodeSession, OpenCodeSessionStatus, OpenCodeSessionsSnapshot } from '../types';
import './SessionsPanel.css';

const statusKeys = {
  working: 'sessionsWorking', waiting: 'sessionsWaiting', completed: 'sessionsCompleted',
  error: 'sessionsFailed', unknown: 'sessionsUnknown',
} as const satisfies Record<OpenCodeSessionStatus, Parameters<typeof t>[0]>;

function SessionColumn({ session, now, closing, onClose }: {
  session: OpenCodeSession; now: number; closing: boolean; onClose: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    if (follow.current && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [session.activity]);
  const toolStatus = (status?: string) => {
    if (status === 'running') return t('sessionsWorking');
    if (status === 'completed') return t('sessionsCompleted');
    if (status === 'error') return t('sessionsFailed');
    return t('sessionsWaiting');
  };
  return <article className={`session-column session-column-${session.source || 'opencode'}`} data-session-id={session.id} data-status={session.status} aria-label={session.title}>
    <header className="session-column-header">
      <div className="session-heading">
        <h3 title={session.title}>{session.title || session.id}</h3>
        {session.source === 'antigravity' && <span className="session-source-badge">{t('sessionsAntigravityBadge')}</span>}
        <button className="session-close" onClick={onClose} disabled={closing}
          title={t('sessionsDismissHint')} aria-label={`${t('sessionsDismiss')}: ${session.title}`}>×</button>
      </div>
      <div className="session-directory" title={session.directory}>{session.directory}</div>
      {session.parentId && <div className="session-meta" title={session.parentId}>{t('sessionsChild')}</div>}
      <div className="session-model" title={session.model}>{session.model || t('sessionsNoModel')}</div>
      <div className="session-status-row">
        <span className={`session-status session-status-${session.status}`}>{t(statusKeys[session.status])}</span>
        <time className="session-meta" dateTime={new Date(session.updatedAt).toISOString()}>
          {new Date(session.updatedAt).toLocaleTimeString()}
        </time>
      </div>
      {session.expiresAt !== null && <div className="session-expiry">
        {t('sessionsClosesIn')} {Math.max(0, Math.ceil((session.expiresAt - now) / 60000))} min
      </div>}
    </header>
    <div className="session-activity" ref={body} tabIndex={0} aria-label={t('sessionsActivity')}
      onScroll={() => { if (body.current) follow.current = body.current.scrollHeight - body.current.scrollTop - body.current.clientHeight < 40; }}>
      {session.activity.length === 0 && <p className="session-meta">{t('sessionsNoActivity')}</p>}
      {session.activity.map(item => <div key={item.id} className={`session-event session-event-${item.type}`}>
        <div className="session-event-label">{item.type === 'tool' ? `${item.tool} · ${toolStatus(item.status)}` :
          item.role === 'user' ? t('sessionsYou') : 'OpenCode'}</div>
        {item.text && <p>{item.text}</p>}
      </div>)}
    </div>
  </article>;
}

const statusPriority: Record<OpenCodeSessionStatus, number> = { working: 0, waiting: 1, completed: 2, error: 2, unknown: 3 };

export function SessionsPanel() {
  const settings = useStore(s => s.settings); // Re-render translations when language changes.
  const setSettings = useStore(s => s.setSettings);
  const [opencode, setOpencode] = useState<OpenCodeSessionsSnapshot | null>(null);
  const [antigravity, setAntigravity] = useState<OpenCodeSessionsSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [closing, setClosing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [oc, agy] = await Promise.allSettled([
          window.electronAPI.getOpenCodeSessions(),
          window.electronAPI.getAntigravitySessions(),
        ]);
        if (disposed) return;
        const errors: string[] = [];
        if (oc.status === 'rejected') errors.push(String(oc.reason));
        else setOpencode(oc.value);
        if (agy.status === 'rejected') errors.push(String(agy.reason));
        else setAntigravity(agy.value);
        setError(errors.join(' · '));
      } finally {
        if (!disposed) { setLoading(false); timer = setTimeout(poll, 3000); }
      }
    };
    setLoading(true);
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [revision]);

  const changeVisibility = async (session?: OpenCodeSession) => {
    setClosing(session?.id || 'restore');
    try {
      if (session) {
        if (session.source === 'antigravity') await window.electronAPI.dismissAntigravitySession(session.id, session.turnId);
        else await window.electronAPI.dismissOpenCodeSession(session.id, session.turnId);
      } else {
        await Promise.all([
          window.electronAPI.restoreOpenCodeSessions(),
          window.electronAPI.restoreAntigravitySessions(),
        ]);
      }
      setRevision(v => v + 1);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setClosing(null); }
  };
  const toggleSound = async () => {
    const next = { ...settings, sessionSoundEnabled: settings.sessionSoundEnabled === false };
    setSettings(next);
    try { await window.electronAPI.saveSettings(next); } catch { /* keep the UI responsive on save failure */ }
  };
  const query = search.trim().toLocaleLowerCase();
  const sessions = [...(opencode?.sessions || []), ...(antigravity?.sessions || [])]
    .filter(s => `${s.title} ${s.directory} ${s.model}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => statusPriority[a.status] - statusPriority[b.status] || b.updatedAt - a.updatedAt);
  const hiddenCount = (opencode?.hiddenCount || 0) + (antigravity?.hiddenCount || 0);
  return <section className="sessions-panel" aria-label={t('sessionsTitle')}>
    <div className="sessions-toolbar">
      <div><h2>▥ {t('sessionsTitle')}</h2><p>{t('sessionsSubtitle')}</p></div>
      <button className="btn" onClick={() => setRevision(v => v + 1)} disabled={loading}>{t('sessionsRefresh')}</button>
    </div>
    <div className="sessions-controls">
      <input type="search" aria-label={t('sessionsSearch')} placeholder={t('sessionsSearch')}
        value={search} onChange={e => setSearch(e.target.value)} />
      <span>{sessions.length} {t('statsSessions').toLocaleLowerCase()}</span>
      <label className="sessions-sound" title={t('sessionsSoundHint')}>
        <input type="checkbox" checked={settings.sessionSoundEnabled !== false} onChange={() => void toggleSound()} />
        <span>{t('sessionsSound')}</span>
      </label>
      {!!hiddenCount && <button className="btn" disabled={closing !== null} onClick={() => void changeVisibility()}>
        {t('sessionsRestore')} ({hiddenCount})
      </button>}
    </div>
    <p className="sessions-hint">{t('sessionsInferenceHint')}</p>
    {error && <div className="sessions-error" role="alert">{t('sessionsError')} <span>{error}</span></div>}
    {loading && !opencode && !antigravity && <p className="sessions-empty" role="status">{t('sessionsLoading')}</p>}
    {!loading && !error && !opencode?.dbPath && !antigravity?.dbPath && <p className="sessions-empty">{t('statsDbNotFound')}</p>}
    {(opencode?.dbPath || antigravity?.dbPath) && sessions.length === 0 && <p className="sessions-empty">{query ? t('sessionsNoMatches') : t('sessionsEmpty')}</p>}
    <div className="sessions-board">
      {sessions.map(session => <SessionColumn key={`${session.source || 'opencode'}-${session.id}`} session={session} now={opencode?.checkedAt || antigravity?.checkedAt || Date.now()}
        closing={closing !== null} onClose={() => void changeVisibility(session)} />)}
    </div>
    {(opencode?.dbPath || antigravity?.dbPath) && <footer className="sessions-source">
      {opencode?.dbPath && <div title={opencode.dbPath}>SQLite · {opencode.dbPath} · {t('sessionsLastCheck')} {new Date(opencode.checkedAt).toLocaleTimeString()}</div>}
      {antigravity?.dbPath && <div title={antigravity.dbPath}>Antigravity · {antigravity.dbPath} · {t('sessionsLastCheck')} {new Date(antigravity.checkedAt).toLocaleTimeString()}</div>}
    </footer>}
  </section>;
}
