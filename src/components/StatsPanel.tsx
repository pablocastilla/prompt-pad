import React, { useEffect, useState } from 'react';
import { t } from '../i18n';
import type { OpenCodeDayCost, OpenCodeStats, PRStats, DayPRs } from '../types';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (dateStr === today.toISOString().slice(0, 10)) return t('statsToday');
  if (dateStr === yesterday.toISOString().slice(0, 10)) return t('statsYesterday');

  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatModelName(modelId: string): string {
  return modelId.replace(/^opencode(-go)?\//, '').replace(/^antigravity\//, '');
}

const colorPalette = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#06b6d4', '#eab308', '#22d3ee', '#a855f7', '#fb923c', '#34d399',
  '#f472b6', '#38bdf8', '#a3e635', '#c084fc', '#fb7185', '#2dd4bf',
];

function getNormalizedModelId(modelId: string): string {
  return modelId
    .replace(/^opencode(-go)?\//, '')
    .replace(/^antigravity\//, '')
    .replace(/^copilot\//, '')
    .toLowerCase()
    .trim();
}

function getModelColor(modelId: string) {
  const normalized = getNormalizedModelId(modelId);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colorPalette[Math.abs(hash) % colorPalette.length];
}

interface DayData {
  date: string;
  cost: number;
  sessions: number;
  tokensIn: number;
  tokensOut: number;
  models: OpenCodeDayCost['models'];
  prs: number;
}

export function StatsPanel() {
  const [data, setData] = useState<OpenCodeStats | null>(null);
  const [prData, setPrData] = useState<PRStats>({ days: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<DayData | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      window.electronAPI.getOpenCodeStats(),
      window.electronAPI.getPRStats(),
    ])
      .then(([statsResult, prResult]) => {
        setData(statsResult);
        setPrData(prResult);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message || t('statsError'));
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="stats-panel">
        <div className="stats-loading">
          <div className="stats-spinner" />
          <span>{t('statsLoading')}</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="stats-panel">
        <div className="stats-error">
          <span className="stats-error-icon">⚠️</span>
          <p>{error || t('statsError')}</p>
          {!data?.dbPath && (
            <p className="stats-error-hint">{t('statsDbNotFound')}</p>
          )}
        </div>
      </div>
    );
  }

  const { days, totalCost, totalSessions } = data;

  // Build full 30-day array merging OpenCode + PR data
  const fullMonth: DayData[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const oc = days.find(x => x.date === key);
    const pr = prData.days.find(x => x.date === key);
    fullMonth.push({
      date: key,
      cost: oc?.cost ?? 0,
      sessions: oc?.sessions ?? 0,
      tokensIn: oc?.tokensIn ?? 0,
      tokensOut: oc?.tokensOut ?? 0,
      models: oc?.models ?? [],
      prs: pr?.count ?? 0,
    });
  }

  const maxCost = Math.max(...fullMonth.map(d => d.cost), 0.001);
  const maxTokens = Math.max(...fullMonth.map(d => d.tokensIn + d.tokensOut), 1);
  const maxPrs = Math.max(...fullMonth.map(d => d.prs), 1);
  const todayStr = new Date().toISOString().slice(0, 10);
  const hasPrData = prData.total > 0;

  return (
    <div className="stats-panel">
      {/* Summary cards */}
      <div className="stats-summary">
        <div className="stats-card">
          <div className="stats-card-value">{formatCost(totalCost)}</div>
          <div className="stats-card-label">{t('statsMonthTotal') || '30-DAY TOTAL'}</div>
        </div>
        <div className="stats-card">
          <div className="stats-card-value">{totalSessions}</div>
          <div className="stats-card-label">{t('statsSessions')}</div>
        </div>
        {hasPrData && (
          <div className="stats-card">
            <div className="stats-card-value">{prData.total}</div>
            <div className="stats-card-label">{t('statsPRsMerged')}</div>
          </div>
        )}
      </div>

      {/* Chart title */}
      <div className="stats-chart-title">{t('statsDailySpend')}</div>

      {/* Bar chart */}
      <div className="stats-chart">
        <div className="stats-bars">
          {fullMonth.map(day => {
            const pct = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
            const isToday = day.date === todayStr;
            const isHovered = hoveredDay?.date === day.date;

            const showGreyBar = day.cost === 0 && day.sessions > 0;
            const heightPct = showGreyBar ? 2 : Math.max(pct, day.cost > 0 ? 2 : 0);

            const prPct = (day.prs / maxPrs) * 100;

            return (
              <div
                key={day.date}
                className={`stats-bar-col${isToday ? ' stats-bar-col-today' : ''}`}
                onMouseEnter={(e) => {
                  setHoveredDay(day);
                  setHoverPosition({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => setHoverPosition({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoveredDay(null)}
              >
                <div className="stats-bar-wrapper">
                  {/* Cost bar (left) */}
                  <div className="stats-bar-group">
                    {day.cost > 0 && (
                      <div className="stats-bar-cost-label">{formatCost(day.cost)}</div>
                    )}
                    <div
                      className={`stats-bar stats-bar-cost${isHovered ? ' stats-bar-hovered' : ''}`}
                      style={{ height: `${heightPct}%` }}
                    >
                      {showGreyBar && (
                        <div className="stats-bar-segment" style={{ height: '100%', backgroundColor: 'var(--text3)' }} />
                      )}
                      {day.cost > 0 && day.models.map((m) => {
                        const mPct = (m.cost / day.cost) * 100;
                        if (mPct <= 0) return null;
                        return (
                          <div
                            key={m.modelId}
                            className="stats-bar-segment"
                            style={{ height: `${mPct}%`, backgroundColor: getModelColor(m.modelId) }}
                            title={`${formatModelName(m.modelId)}: ${formatCost(m.cost)}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                  {/* Tokens bar (middle) */}
                  <div className="stats-bar-group">
                    {(day.tokensIn + day.tokensOut) > 0 && (
                      <div className="stats-bar-token-label">{formatTokens(day.tokensIn + day.tokensOut)}</div>
                    )}
                    <div
                      className="stats-bar stats-bar-tokens"
                      style={{ height: `${Math.max((day.tokensIn + day.tokensOut) / maxTokens * 100, 1)}%` }}
                    >
                      {day.tokensIn > 0 && (
                        <div
                          className="stats-bar-segment"
                          style={{ height: `${(day.tokensIn / (day.tokensIn + day.tokensOut)) * 100}%`, backgroundColor: getModelColor('tokens-in') }}
                          title={`${t('statsTokensIn')}: ${formatTokens(day.tokensIn)}`}
                        />
                      )}
                      {day.tokensOut > 0 && (
                        <div
                          className="stats-bar-segment"
                          style={{ height: `${(day.tokensOut / (day.tokensIn + day.tokensOut)) * 100}%`, backgroundColor: getModelColor('tokens-out') }}
                          title={`${t('statsTokensOut')}: ${formatTokens(day.tokensOut)}`}
                        />
                      )}
                    </div>
                  </div>
                  {/* PRs bar (right) */}
                  {hasPrData && (
                    <div className="stats-bar-group">
                      {day.prs > 0 && (
                        <div className="stats-bar-pr-label">{day.prs}</div>
                      )}
                      <div
                        className="stats-bar stats-bar-prs"
                        style={{ height: `${Math.max(prPct, day.prs > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                  )}
                </div>
                {/* Day label */}
                <div className={`stats-bar-label${isToday ? ' stats-bar-label-today' : ''}`}>
                  {isToday ? t('statsToday') : new Date(day.date + 'T00:00:00').getDate()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Source info */}
      <div className="stats-source">
        OpenCode · opencode.db{hasPrData ? ' · GitHub PRs' : ''}
      </div>

      {/* gh CLI install hint */}
      <div className="stats-cli-hint">{t('statsGHInstallHint')}</div>

      {/* Global fixed tooltip to prevent cutoff */}
      {hoveredDay && (
        <div 
          className="stats-tooltip" 
          style={{ 
            position: 'fixed', 
            left: hoverPosition.x, 
            top: Math.max(hoverPosition.y - 15, 10),
            transform: `translate(${hoverPosition.x > window.innerWidth - 250 ? '-100%' : '-50%'}, -100%)`,
            minWidth: '220px',
            zIndex: 9999,
            background: 'var(--bg3, #27272a)',
            border: '1px solid var(--border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            animation: 'none'
          }}
        >
          <div className="stats-tooltip-date" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '6px', marginBottom: '6px' }}>
            {formatDate(hoveredDay.date)}
          </div>
          <div className="stats-tooltip-cost">{formatCost(hoveredDay.cost)}</div>
          {hoveredDay.sessions > 0 && (
            <>
              <div className="stats-tooltip-row">
                <span>{t('statsSessions')}:</span>
                <span>{hoveredDay.sessions}</span>
              </div>
              <div className="stats-tooltip-row">
                <span>{t('statsTokensIn')}:</span>
                <span>{formatTokens(hoveredDay.tokensIn)}</span>
              </div>
              <div className="stats-tooltip-row" style={{ marginBottom: '8px' }}>
                <span>{t('statsTokensOut')}:</span>
                <span>{formatTokens(hoveredDay.tokensOut)}</span>
              </div>

              {hoveredDay.prs > 0 && (
                <div className="stats-tooltip-row" style={{ marginBottom: '8px' }}>
                  <span>{t('statsPRsMerged')}:</span>
                  <span>{hoveredDay.prs}</span>
                </div>
              )}

              {hoveredDay.models.length > 0 && (
                <div style={{ marginTop: '8px', borderTop: '1px dashed var(--border)', paddingTop: '8px' }}>
                  <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: '4px', fontWeight: 600 }}>Breakdown</div>
                  {hoveredDay.models.map(m => (
                    <div key={m.modelId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: getModelColor(m.modelId), flexShrink: 0 }} />
                        <span style={{ color: 'var(--text2)', textOverflow: 'ellipsis', overflow: 'hidden' }} title={m.modelId}>
                          {formatModelName(m.modelId)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', color: 'var(--text)' }}>
                        <span>{m.sessions} {t('statsSessions').toLowerCase()}</span>
                        <span style={{ fontWeight: 500 }}>{m.cost > 0 ? formatCost(m.cost) : 'Free'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
