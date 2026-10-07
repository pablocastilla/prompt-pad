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
  // Pending live interactions attached by the server readers (not from SQLite).
  permissions?: OpenCodePermissionRequest[];
  questions?: OpenCodeQuestionRequest[];
}

export interface OpenCodeSessionsSnapshot {
  dbPath: string | null;
  sessions: OpenCodeSession[];
  hiddenCount: number;
  checkedAt: number;
}

// Live interactions the agent is waiting on. These live in the running OpenCode
// server (not SQLite), so the board and the mobile page poll them separately.
export interface OpenCodeQuestionOption {
  label: string;
  description: string;
}

export interface OpenCodeQuestionInfo {
  question: string;
  header: string;
  options: OpenCodeQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface OpenCodeQuestionRequest {
  id: string;
  sessionID: string;
  questions: OpenCodeQuestionInfo[];
}

export interface OpenCodePermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
  always?: string[];
}

export interface OpenCodeInteractions {
  permissions: OpenCodePermissionRequest[];
  questions: OpenCodeQuestionRequest[];
}
