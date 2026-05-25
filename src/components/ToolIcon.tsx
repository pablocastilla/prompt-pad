import React from 'react';
import type { LaunchTool } from '../types';
import { siGithubcopilot, siClaude, siOpenaigym } from 'simple-icons';
import opencodeIconDarkTheme from '../assets/cli-icons/opencode-logo-light-square.png';
import opencodeIconLightTheme from '../assets/cli-icons/opencode-logo-dark-square.png';

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

function getOpenCodeIconForTheme(): string {
  if (typeof document === 'undefined') {
    return opencodeIconLightTheme;
  }

  const theme = document.documentElement.getAttribute('data-theme') ?? 'light';
  return theme === 'light' ? opencodeIconLightTheme : opencodeIconDarkTheme;
}

export function ToolIcon({ tool, size = 14, className }: ToolIconProps) {
  if (tool === 'copilot') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={className}>
        <path d={siGithubcopilot.path} fill="currentColor" />
      </svg>
    );
  }
  if (tool === 'opencode') {
    return (
      <img
        src={getOpenCodeIconForTheme()}
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
