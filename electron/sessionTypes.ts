export type OpenCodeSessionStatus = 'working' | 'waiting' | 'completed' | 'error' | 'unknown';

export interface OpenCodeActivity {
  id: string;
  role: string;
  type: 'text' | 'tool';
  text: string;
  tool?: string;
  status?: string;
}

export interface OpenCodeSession {
  id: string;
  turnId: string;
  title: string;
  directory: string;
  parentId: string | null;
  model: string;
  status: OpenCodeSessionStatus;
  updatedAt: number;
  completedAt: number | null;
  expiresAt: number | null;
  activity: OpenCodeActivity[];
}

export interface OpenCodeSessionsSnapshot {
  dbPath: string | null;
  sessions: OpenCodeSession[];
  hiddenCount: number;
  checkedAt: number;
}
