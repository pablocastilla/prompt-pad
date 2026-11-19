// Model catalogs for CLIs that do not expose a supported "list models" command.
//
// Claude Code resolves model *aliases* to the newest model available for the
// signed-in provider, so the alias list below stays current without shipping a
// release for every model launch. Codex has no `codex models` command (see
// openai/codex issue #23279), so its catalog is a curated snapshot checked
// against the official Codex model docs.
//
// Sources (checked 2026-11-19):
//   - https://code.claude.com/docs/en/model-config
//   - https://learn.chatgpt.com/docs/models
//
// Both launchers treat the special `default` id as "let the CLI use its own
// configured model" and omit the --model flag entirely.

export interface ProviderModel {
  id: string;
  label: string;
}

export const DEFAULT_CLAUDE_CODE_MODEL = 'default';
export const DEFAULT_CODEX_MODEL = 'default';

// Claude Code aliases. `best` is documented as an alias for `opus`; `fable`
// resolves to the most capable model, `opusplan` plans on Opus and executes on
// Sonnet. Full model IDs can still be typed/pinned by users through settings.
export const CLAUDE_CODE_MODELS: ProviderModel[] = [
  { id: 'default',  label: 'Default (Claude Code setting)' },
  { id: 'fable',    label: 'Fable (latest)' },
  { id: 'opus',     label: 'Opus (latest)' },
  { id: 'sonnet',   label: 'Sonnet (latest)' },
  { id: 'haiku',    label: 'Haiku (latest)' },
  { id: 'best',     label: 'Best (same as Opus)' },
  { id: 'opusplan', label: 'Opus plan, Sonnet execute' },
];

// Codex model IDs. The newest family first; older options stay for accounts
// that still have access to them or have pinned them in history.
export const CODEX_MODELS: ProviderModel[] = [
  { id: 'default',             label: 'Default (Codex config)' },
  { id: 'gpt-6.2-sol',         label: 'GPT-6.2 Sol' },
  { id: 'gpt-6.2-astra',       label: 'GPT-6.2 Astra' },
  { id: 'gpt-6.1-terra',       label: 'GPT-6.1 Terra' },
  { id: 'gpt-6-astra',         label: 'GPT-6 Astra' },
  { id: 'gpt-5.6-sol',         label: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra',       label: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna',        label: 'GPT-5.6 Luna' },
  { id: 'gpt-5.5',             label: 'GPT-5.5' },
  { id: 'gpt-5.4',             label: 'GPT-5.4' },
  { id: 'gpt-5.3-codex',       label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.2-codex',       label: 'GPT-5.2 Codex' },
  { id: 'gpt-5.1-codex-max',   label: 'GPT-5.1 Codex Max' },
  { id: 'gpt-5.1-codex-mini',  label: 'GPT-5.1 Codex Mini' },
  { id: 'gpt-5-codex',         label: 'GPT-5 Codex' },
  { id: 'gpt-5',               label: 'GPT-5' },
];

const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@[\]-]+$/;

function normalizeCliModel(model: unknown, fallback: string): string {
  const value = typeof model === 'string' ? model.trim() : '';
  if (!value || value === 'default' || !MODEL_ID_PATTERN.test(value)) return fallback;
  return value;
}

export function normalizeClaudeCodeModel(model: unknown): string {
  return normalizeCliModel(model, DEFAULT_CLAUDE_CODE_MODEL);
}

export function normalizeCodexModel(model: unknown): string {
  return normalizeCliModel(model, DEFAULT_CODEX_MODEL);
}

export function getProviderModels(tool: 'claude-code' | 'codex'): ProviderModel[] {
  return tool === 'claude-code' ? CLAUDE_CODE_MODELS : CODEX_MODELS;
}
