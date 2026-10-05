export type OpenCodeSessionStatus = 'working' | 'waiting' | 'completed' | 'error' | 'unknown';

export interface OpenCodeActivity {
  id: string;
  role: string;
  type: 'text' | 'tool';
  text: string;
  tool?: string;
  status?: string;
  // Tool calls only: the command/arguments that were executed and the captured
  // result, so the board can show exactly what ran (e.g. a python command) and
  // what it printed. Kept optional for backward compatibility.
  input?: string;
  output?: string;
}

export interface OpenCodeSession {
  id: string;
  turnId: string;
  title: string;
  directory: string;
  parentId: string | null;
  model: string;
  status: OpenCodeSessionStatus;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  expiresAt: number | null;
  activity: OpenCodeActivity[];
  // Which product the session belongs to; defaults to OpenCode.
  source?: 'opencode' | 'antigravity';
}

export interface OpenCodeSessionsSnapshot {
  dbPath: string | null;
  sessions: OpenCodeSession[];
  hiddenCount: number;
  checkedAt: number;
}
