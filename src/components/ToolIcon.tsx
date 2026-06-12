import React from 'react';
import type { LaunchTool } from '../types';
import { siGithubcopilot, siClaude, siOpenaigym, siGooglegemini } from 'simple-icons';
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
  gemini: 'Gemini',
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
      <svg viewBox="8 12 92 92" width={size} height={size} aria-hidden="true" className={className}>
        <defs>
          <linearGradient id="antigravity-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3186FF" />
            <stop offset="35%" stopColor="#00B95C" />
            <stop offset="70%" stopColor="#FFE432" />
            <stop offset="100%" stopColor="#FC413D" />
          </linearGradient>
        </defs>
        <path
          d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z"
          fill="url(#antigravity-gradient)"
        />
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
  if (tool === 'gemini') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={className}>
        <path d={siGooglegemini.path} fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={className}>
      <path d={siOpenaigym.path} fill="currentColor" />
    </svg>
  );
}
