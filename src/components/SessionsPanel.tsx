import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useStore } from '../store';
import type {
  OpenCodeSession, OpenCodeSessionStatus, OpenCodeSessionsSnapshot,
  OpenCodeInteractions, OpenCodePermissionRequest, OpenCodeQuestionRequest,
} from '../types';
import { renderMarkdown } from '../../electron/markdown';
import './SessionsPanel.css';

const statusKeys = {
  working: 'sessionsWorking', waiting: 'sessionsWaiting', completed: 'sessionsCompleted',
  error: 'sessionsFailed', unknown: 'sessionsUnknown',
} as const satisfies Record<OpenCodeSessionStatus, Parameters<typeof t>[0]>;

const emptyInteractions = (): OpenCodeInteractions => ({ permissions: [], questions: [] });

function PermissionBlock({ request, onReply }: {
  request: OpenCodePermissionRequest;
  onReply: (reply: 'once' | 'always' | 'reject') => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reply = async (value: 'once' | 'always' | 'reject') => {
    setBusy(true);
    setError('');
    try { await onReply(value); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const detail = [request.permission, ...(request.patterns || [])].filter(Boolean).join('\n');
  return <div className="session-interaction session-interaction-permission">
    <div className="session-interaction-label">{t('sessionsPermission')}</div>
    <pre className="session-interaction-command">{detail}</pre>
    <div className="session-interaction-actions">
      <button type="button" disabled={busy} onClick={() => void reply('once')}>{t('sessionsAllowOnce')}</button>
      <button type="button" disabled={busy} onClick={() => void reply('always')}>{t('sessionsAllowAlways')}</button>
      <button type="button" className="session-interaction-reject" disabled={busy} onClick={() => void reply('reject')}>{t('sessionsReject')}</button>
    </div>
    {error && <div className="session-interaction-error">{error}</div>}
  </div>;
}

function QuestionBlock({ request, onAnswer }: {
  request: OpenCodeQuestionRequest;
  onAnswer: (answers: string[][]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[][]>(() => request.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => request.questions.map(() => ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (qi: number, label: string, multiple?: boolean) => {
    setSelected(prev => prev.map((arr, i) => {
      if (i !== qi) return arr;
      if (multiple) return arr.includes(label) ? arr.filter(l => l !== label) : [...arr, label];
      return arr.includes(label) ? [] : [label];
    }));
  };
  const submit = async () => {
    const answers = request.questions.map((q, i) => {
      const picked = [...(selected[i] || [])];
      if (q.custom && (custom[i] || '').trim()) picked.push(custom[i].trim());
      return picked;
    });
    setBusy(true);
    setError('');
    try { await onAnswer(answers); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <div className="session-interaction session-interaction-question">
    {request.questions.map((q, qi) => <div className="session-question" key={qi}>
      <div className="session-interaction-label">{q.header || t('sessionsQuestion')}</div>
      <p className="session-interaction-text">{q.question}</p>
      <div className="session-question-options">
        {q.options.map(o => <label key={o.label} className="session-question-option">
          <input type={q.multiple ? 'checkbox' : 'radio'} name={`q-${request.id}-${qi}`}
            checked={(selected[qi] || []).includes(o.label)} disabled={busy}
            onChange={() => toggle(qi, o.label, q.multiple)} />
          <span><strong>{o.label}</strong>{o.description && <small>{o.description}</small>}</span>
        </label>)}
      </div>
      {q.custom && <input className="session-question-custom" value={custom[qi] || ''} disabled={busy}
        placeholder={t('sessionsQuestionCustom')} aria-label={t('sessionsQuestionCustom')}
        onChange={e => setCustom(prev => prev.map((v, i) => i === qi ? e.target.value : v))} />}
    </div>)}
    <div className="session-interaction-actions">
      <button type="button" disabled={busy} onClick={() => void submit()}>{t('sessionsAnswer')}</button>
    </div>
    {error && <div className="session-interaction-error">{error}</div>}
  </div>;
}

function SessionColumn({ session, interactions, now, closing, onClose, onSend, onReplyPermission, onAnswerQuestion }: {
  session: OpenCodeSession; interactions: OpenCodeInteractions; now: number; closing: boolean;
  onClose: () => void; onSend: (id: string, text: string) => Promise<string>;
  onReplyPermission: (requestId: string, reply: 'once' | 'always' | 'reject') => Promise<void>;
  onAnswerQuestion: (requestId: string, answers: string[][]) => Promise<void>;
}) {
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<{ cls: string; text: string; at: number } | null>(null);
  useLayoutEffect(() => {
    if (follow.current && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [session.activity]);
  useEffect(() => {
    if (note && Date.now() - note.at > 15000) setNote(null);
  }, [note, now]);
  const toolStatus = (status?: string) => {
    if (status === 'running') return t('sessionsWorking');
    if (status === 'completed') return t('sessionsCompleted');
    if (status === 'error') return t('sessionsFailed');
    return t('sessionsWaiting');
  };
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setNote({ cls: '', text: t('sessionsSending'), at: Date.now() });
    try {
      const title = await onSend(session.id, text);
      setNote({ cls: 'ok', text: t('sessionsSentTo') + ' ' + title, at: Date.now() });
      setDraft('');
    } catch (err) {
      setNote({ cls: 'error', text: t('sessionsSendFailed') + ' ' + (err instanceof Error ? err.message : String(err)), at: Date.now() });
    }
  };
  const hasInteractions = interactions.permissions.length > 0 || interactions.questions.length > 0;
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
    {hasInteractions && <div className="session-interactions" aria-live="polite">
      {interactions.questions.map(request => <QuestionBlock key={request.id} request={request}
        onAnswer={answers => onAnswerQuestion(request.id, answers)} />)}
      {interactions.permissions.map(request => <PermissionBlock key={request.id} request={request}
        onReply={reply => onReplyPermission(request.id, reply)} />)}
    </div>}
    <div className="session-activity" ref={body} tabIndex={0} aria-label={t('sessionsActivity')}
      onScroll={() => { if (body.current) follow.current = body.current.scrollHeight - body.current.scrollTop - body.current.clientHeight < 40; }}>
      {session.activity.length === 0 && <p className="session-meta">{t('sessionsNoActivity')}</p>}
      {session.activity.map(item => <div key={item.id} className={`session-event session-event-${item.type}`}>
        <div className="session-event-label">{item.type === 'tool' ? `${item.tool} · ${toolStatus(item.status)}` :
          item.role === 'user' ? t('sessionsYou') : (session.source === 'antigravity' ? 'Antigravity' : 'OpenCode')}</div>
        {item.type === 'tool' ? <>
          {item.text && item.text !== item.input && <p>{item.text}</p>}
          {item.input && <pre className="session-event-command" title={t('sessionsToolCommand')}>{item.input}</pre>}
          {item.output && <pre className={`session-event-output${item.status === 'error' ? ' session-event-output-error' : ''}`}
            title={t('sessionsToolOutput')}>{item.output}</pre>}
        </> : item.text && <div className="session-event-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} />}
      </div>)}
    </div>
    {session.source === 'opencode' && <form className="session-compose" onSubmit={e => { e.preventDefault(); void send(); }}>
      <textarea value={draft} rows={2} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
        placeholder={t('sessionsComposePlaceholder')} aria-label={t('sessionsComposeAria')} />
      <button type="submit" disabled={!draft.trim()} title={t('sessionsComposeSend')}>{t('sessionsComposeSend')}</button>
      {note && <div className={`session-compose-note ${note.cls}`}>{note.text}</div>}
    </form>}
  </article>;
}

export function SessionsPanel() {
  const settings = useStore(s => s.settings); // Re-render translations when language changes.
  const setSettings = useStore(s => s.setSettings);
  const addToast = useStore(s => s.addToast);
  const [opencode, setOpencode] = useState<OpenCodeSessionsSnapshot | null>(null);
  const [antigravity, setAntigravity] = useState<OpenCodeSessionsSnapshot | null>(null);
  const [interactions, setInteractions] = useState<OpenCodeInteractions>(emptyInteractions);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [closing, setClosing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [remote, setRemote] = useState<{ url: string; qr: string } | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const orderKeys = useRef<string[]>([]);
  const statusMemory = useRef(new Map<string, OpenCodeSessionStatus>());
  const gaudyRef = useRef(settings.theme === 'gaudy');
  gaudyRef.current = settings.theme === 'gaudy';
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [oc, agy, ix] = await Promise.allSettled([
          window.electronAPI.getOpenCodeSessions(),
          window.electronAPI.getAntigravitySessions(),
          window.electronAPI.getOpenCodeInteractions(),
        ]);
        if (disposed) return;
        const errors: string[] = [];
        if (oc.status === 'rejected') errors.push(String(oc.reason));
        else setOpencode(oc.value);
        if (agy.status === 'rejected') errors.push(String(agy.reason));
        else setAntigravity(agy.value);
        if (ix.status === 'fulfilled') setInteractions(ix.value);
        setError(errors.join(' · '));
        // Gaudy flair: kitschy toasts when a watched turn reaches a final state.
        if (gaudyRef.current) {
          const seen = new Set<string>();
          const messages: string[] = [];
          for (const snapshot of [oc, agy]) {
            if (snapshot.status !== 'fulfilled') continue;
            for (const session of snapshot.value.sessions) {
              const key = `${session.source || 'opencode'}:${session.id}`;
              seen.add(key);
              const previous = statusMemory.current.get(key);
              statusMemory.current.set(key, session.status);
              if (!previous) continue;
              if (session.status === 'completed' && previous !== 'completed') messages.push(t('gaudySessionDone'));
              else if (session.status === 'error' && previous !== 'error') messages.push(t('gaudySessionBoom'));
            }
          }
          for (const key of [...statusMemory.current.keys()]) {
            if (!seen.has(key)) statusMemory.current.delete(key);
          }
          for (const message of messages) addToast(message);
        }
      } finally {
        if (!disposed) { setLoading(false); timer = setTimeout(poll, 3000); }
      }
    };
    setLoading(true);
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [revision]);

  // Scrolling over the board (outside a column's own scroll area) moves the board
  // horizontally, so wide sessions are reachable without a horizontal scrollbar.
  useEffect(() => {
    const element = board.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('.session-activity, .session-compose, .session-event-command, .session-event-output, .session-event-text pre')) return;
      element.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const changeVisibility = async (session?: OpenCodeSession) => {
    setClosing(session?.id || 'restore');
    if (session) {
      if (session.source === 'antigravity') {
        setAntigravity(prev => prev ? {
          ...prev,
          sessions: prev.sessions.filter(s => s.id !== session.id),
          hiddenCount: prev.hiddenCount + 1,
        } : null);
      } else {
        setOpencode(prev => prev ? {
          ...prev,
          sessions: prev.sessions.filter(s => s.id !== session.id),
          hiddenCount: prev.hiddenCount + 1,
        } : null);
      }
    }
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
  const showRemoteQr = async () => {
    setRemoteBusy(true);
    try {
      const info = await window.electronAPI.getRemoteSessionsQr(settings.remoteSessionsExternalUrl);
      setRemote(info);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setRemoteBusy(false); }
  };
  useEffect(() => {
    if (remote) {
      void showRemoteQr();
    }
  }, [settings.remoteSessionsExternalUrl]);
  const sendToSession = async (sessionId: string, text: string): Promise<string> => {
    const result = await window.electronAPI.sendOpenCodeMessage(sessionId, text);
    return result.title || sessionId;
  };
  const replyPermission = async (requestId: string, reply: 'once' | 'always' | 'reject') => {
    await window.electronAPI.replyOpenCodePermission(requestId, reply);
    setInteractions(prev => ({ ...prev, permissions: prev.permissions.filter(p => p.id !== requestId) }));
    setRevision(v => v + 1);
  };
  const answerQuestion = async (requestId: string, answers: string[][]) => {
    await window.electronAPI.replyOpenCodeQuestion(requestId, answers);
    setInteractions(prev => ({ ...prev, questions: prev.questions.filter(q => q.id !== requestId) }));
    setRevision(v => v + 1);
  };
  const query = search.trim().toLocaleLowerCase();
  const keyOf = (session: OpenCodeSession) => `${session.source || 'opencode'}-${session.id}`;
  const allSessions = [...(opencode?.sessions || []), ...(antigravity?.sessions || [])]
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const live = new Set(allSessions.map(keyOf));
  const kept = orderKeys.current.filter(key => live.has(key));
  const placed = new Set(kept);
  // New columns join at the left; once placed, a column never moves again even
  // though its status and activity keep changing on every poll.
  const added = allSessions.filter(session => !placed.has(keyOf(session))).map(keyOf);
  orderKeys.current = [...added, ...kept];
  const position = new Map(orderKeys.current.map((key, index) => [key, index]));
  const sessions = allSessions
    .filter(s => `${s.title} ${s.directory} ${s.model}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => (position.get(keyOf(a)) ?? 0) - (position.get(keyOf(b)) ?? 0));
  const interactionsFor = (session: OpenCodeSession): OpenCodeInteractions => ({
    permissions: interactions.permissions.filter(p => p.sessionID === session.id),
    questions: interactions.questions.filter(q => q.sessionID === session.id),
  });
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
    <div className="sessions-remote">
      <button className="btn" onClick={() => void showRemoteQr()} disabled={remoteBusy}>
        {remote ? t('sessionsRemoteShow') : t('sessionsRemote')}
      </button>
      {remote && <div className="sessions-remote-card">
        <div className="sessions-remote-qr" dangerouslySetInnerHTML={{ __html: remote.qr }} />
        <div className="sessions-remote-info">
          <code title={remote.url}>{remote.url}</code>
          <div className="sessions-remote-actions">
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(remote.url)}>{t('sessionsRemoteCopy')}</button>
            <span>{settings.remoteSessionsExternalUrl?.trim() ? t('sessionsRemoteExternalHint') : t('sessionsRemoteHint')}</span>
          </div>
        </div>
      </div>}
    </div>
    {error && <div className="sessions-error" role="alert">{t('sessionsError')} <span>{error}</span></div>}
    {loading && !opencode && !antigravity && <p className="sessions-empty" role="status">{t('sessionsLoading')}</p>}
    {!loading && !error && !opencode?.dbPath && !antigravity?.dbPath && <p className="sessions-empty">{t('statsDbNotFound')}</p>}
    {(opencode?.dbPath || antigravity?.dbPath) && sessions.length === 0 && <p className="sessions-empty">{query ? t('sessionsNoMatches') : t('sessionsEmpty')}</p>}
    <div className="sessions-board" ref={board}>
      {sessions.map(session => <SessionColumn key={`${session.source || 'opencode'}-${session.id}`} session={session}
        interactions={interactionsFor(session)} now={opencode?.checkedAt || antigravity?.checkedAt || Date.now()}
        closing={closing !== null} onClose={() => void changeVisibility(session)} onSend={sendToSession}
        onReplyPermission={replyPermission} onAnswerQuestion={answerQuestion} />)}
    </div>
    {(opencode?.dbPath || antigravity?.dbPath) && <footer className="sessions-source">
      {opencode?.dbPath && <div title={opencode.dbPath}>SQLite · {opencode.dbPath} · {t('sessionsLastCheck')} {new Date(opencode.checkedAt).toLocaleTimeString()}</div>}
      {antigravity?.dbPath && <div title={antigravity.dbPath}>Antigravity · {antigravity.dbPath} · {t('sessionsLastCheck')} {new Date(antigravity.checkedAt).toLocaleTimeString()}</div>}
    </footer>}
  </section>;
}
