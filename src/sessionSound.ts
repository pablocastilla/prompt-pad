import { useEffect, useRef } from 'react';
import type { OpenCodeSession, OpenCodeSessionStatus } from './types';

const POLL_MS = 3000;

interface SessionSignals {
  turnId: string;
  status: OpenCodeSessionStatus;
  questions: Set<string>;
  pending: Set<string>;
  announcedPending: Set<string>;
}

type SessionSignalMap = Map<string, SessionSignals>;

export interface SessionNotifications {
  finished: OpenCodeSession[];
  questions: OpenCodeSession[];
}

const TERMINAL_TOOL = new Set(['completed', 'error']);

function isTerminal(status: OpenCodeSessionStatus): boolean {
  return status === 'completed' || status === 'error';
}

/** Tool ids of OpenCode `question` calls that are still waiting for an answer. */
function openQuestionIds(session: OpenCodeSession): string[] {
  return session.activity
    .filter(item => item.type === 'tool' && item.tool === 'question' && !TERMINAL_TOOL.has(item.status || 'pending'))
    .map(item => item.id);
}

/**
 * Non-question tools stuck in `pending` state. They usually fly past it in
 * milliseconds, so a tool still pending across two polls is almost certainly
 * waiting for the user to approve it.
 */
function pendingApprovalIds(session: OpenCodeSession): string[] {
  if (session.status !== 'working') return [];
  return session.activity
    .filter(item => item.type === 'tool' && item.tool !== 'question' && (item.status || 'pending') === 'pending')
    .map(item => item.id);
}

/**
 * Detect the transitions worth a sound: a turn that just reached a terminal
 * state, an open `question`, or a tool waiting for approval. All are
 * transition-based, so state already present when Prompt Pad starts stays silent.
 */
export function detectSessionNotifications(
  known: SessionSignalMap,
  sessions: OpenCodeSession[],
): SessionNotifications {
  const finished: OpenCodeSession[] = [];
  const questions: OpenCodeSession[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    seen.add(session.id);
    const previous = known.get(session.id);
    if (isTerminal(session.status) && previous && previous.turnId === session.turnId && !isTerminal(previous.status)) {
      finished.push(session);
    }
    const open = openQuestionIds(session);
    const pending = pendingApprovalIds(session);
    const waitingApproval = previous
      ? pending.filter(id => previous.pending.has(id) && !previous.announcedPending.has(id))
      : [];
    if (waitingApproval.length > 0 || (previous && open.some(id => !previous.questions.has(id)))) {
      questions.push(session);
    }
    known.set(session.id, {
      turnId: session.turnId,
      status: session.status,
      questions: new Set(open),
      pending: new Set(pending),
      announcedPending: new Set([...(previous?.announcedPending ?? []), ...waitingApproval].filter(id => pending.includes(id))),
    });
  }
  for (const id of [...known.keys()]) {
    if (!seen.has(id)) known.delete(id);
  }
  return { finished, questions };
}

let audioContext: AudioContext | null = null;

/**
 * Play a soft chime with the Web Audio API. It needs no bundled asset, works on
 * every platform Electron supports and stays best-effort: any failure (no audio
 * device, blocked context, headless run) is swallowed.
 */
function playNotes(frequencies: number[]): void {
  try {
    const Ctor = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext = audioContext ?? new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();
    const start = audioContext.currentTime;
    const master = audioContext.createGain();
    master.gain.value = 1;
    master.connect(audioContext.destination);
    for (const [index, frequency] of frequencies.entries()) {
      const at = start + index * 0.12;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(at);
      oscillator.stop(at + 0.32);
    }
  } catch {
    // Audio is a convenience, never a hard requirement.
  }
}

/** Finished / error turn: a gentle E5 → B5 pair. */
export function playSessionSound(): void {
  playNotes([659.25, 987.77]);
}

/** Agent is asking a question: a distinct C5 → G5 pair. */
export function playQuestionSound(): void {
  playNotes([523.25, 783.99]);
}

/**
 * Poll the local OpenCode sessions in the background and play a soft chime
 * whenever a turn finishes or the agent asks a question, even when the sessions
 * board is not open.
 */
export function useSessionSound(enabled: boolean): void {
  const known = useRef<SessionSignalMap>(new Map());
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const snapshot = await window.electronAPI.getOpenCodeSessions();
        if (disposed) return;
        const { finished, questions } = detectSessionNotifications(known.current, snapshot.sessions);
        if (enabledRef.current) {
          if (questions.length > 0) playQuestionSound();
          if (finished.length > 0) playSessionSound();
        }
      } catch {
        // The sessions board surfaces database errors; notifications stay silent.
      } finally {
        if (!disposed) timer = setTimeout(poll, POLL_MS);
      }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
}
