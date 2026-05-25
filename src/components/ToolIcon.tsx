import React from 'react';
import type { LaunchTool } from '../types';
import { siGithubcopilot, siClaude, siOpenaigym } from 'simple-icons';
import { useStore } from '../store';
import opencodeIconLight from '../assets/cli-icons/opencode-logo-light-square.png';
import opencodeIconDark from '../assets/cli-icons/opencode-logo-dark-square.png';

interface ToolIconProps {
  tool: LaunchTool;
  size?: number;
  className?: string;
}

export const TOOL_LABELS: Record<LaunchTool, string> = {
  copilot: 'GitHub Copilot',
  opencode: 'OpenCode',
  antigravity: 'Antigravity',
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

export function ToolIcon({ tool, size = 14, className }: ToolIconProps) {
  const theme = useStore(s => s.settings.theme);

  if (tool === 'copilot') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={className}>
        <path d={siGithubcopilot.path} fill="currentColor" />
      </svg>
    );
  }
  if (tool === 'opencode') {
    const src = theme === 'light' ? opencodeIconLight : opencodeIconDark;
    return (
      <img
        src={src}
        alt="OpenCode"
        className={`tool-icon-image ${className ?? ''}`.trim()}
        width={size}
        height={size}
      />
    );
  }
  if (tool === 'antigravity') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={className}>
        <circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M2.5 12h19" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (tool === 'claude-code') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={className}>
        <path d={siClaude.path} fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={className}>
      <path d={siOpenaigym.path} fill="currentColor" />
    </svg>
  );
}
