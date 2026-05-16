# Prompt Pad – Copilot Instructions

## Project overview

**Prompt Pad** is a Windows desktop app built with Electron + React + TypeScript.  
It lets developers write, organise, and fire AI prompts directly to the **GitHub Copilot CLI** from a polished native window.

---

## Tech stack

| Layer | Library / Tool | Version |
|---|---|---|
| Native shell | Electron | 33 |
| UI | React | 18 |
| Language | TypeScript | 5 |
| State | Zustand | 5 |
| Bundler | Vite (vite-plugin-electron) | 6 |
| Packaging | electron-builder | 25 |
| Package manager | npm | – |

---

## Folder structure

```
electron/         Electron main process (main.ts) and preload bridge (preload.ts)
src/              React renderer
  components/     All UI components
  store.ts        Zustand global state
  types.ts        Shared TypeScript types + ElectronAPI interface
  i18n.ts         English / Spanish translations (flat key-value)
  App.tsx         Root component, startup effects, session restore
  App.css         All styles (CSS custom properties, 4 themes)
resources/        icon.png (2048×2048, transparent background)
electron-builder.yml  Packaging config
```

---

## Architecture rules

### IPC bridge (Electron ↔ React)
- All IPC is declared in `electron/preload.ts` and typed in `src/types.ts` (`ElectronAPI` interface).
- New IPC channels must be: added to `ipcMain.handle` in `electron/main.ts`, exposed via `contextBridge` in `electron/preload.ts`, and typed in the `ElectronAPI` interface in `src/types.ts`.
- Never use `nodeIntegration: true`; always go through the preload bridge.

### State management
- Single Zustand store in `src/store.ts`.
- All async side-effects (file I/O, IPC) happen in React `useEffect` hooks or event handlers, **not** inside the store.

### File I/O
- All writes use `atomicWrite()` (write to `.tmp` then rename) to prevent data corruption.
- Local data directory: `~/.prompt-pad/`  
- OneDrive sync directory (when enabled): `%OneDrive%/Apps/PromptPad/` (Win) or `~/Library/CloudStorage/OneDrive-Personal/Apps/PromptPad/` (mac).
- `settings.json` is **always** stored locally; only `phrases.json` and `launches.json` move to OneDrive.
- On first OneDrive enable, local files are **migrated** automatically (copy, then the new path is used).

### Session autosave
- Tab state (title, content, path) is saved to `~/.prompt-pad/session.json` via a **600 ms debounce** whenever `tabs` or `activeTabId` changes.
- On startup, `App.tsx` restores the session after loading settings/phrases/launches.

### Models
- Allowed model IDs are declared in `src/types.ts` (`AVAILABLE_MODELS`) and mirrored in `electron/main.ts` (`ALLOWED_MODELS`).
- Always sanitize/normalize model IDs at the IPC boundary using `normalizeModel()` / `normalizeModelId()`.

---

## Internationalisation

- Translations live in `src/i18n.ts` as a `{ en: {...}, es: {...} }` constant.
- Both `en` and `es` keys **must be kept in sync** (same keys, same order).
- Use `t('key')` everywhere; never hardcode UI strings.
- Language auto-detects from `app.getLocale()` (Electron); manual override stored in `settings.json`.

---

## Theming

Four themes controlled by `data-theme` attribute on `<html>`: `light`, `dark`, `gaudy`, `cyberpunk`.  
All colours are CSS custom properties defined in `App.css`. Never use hard-coded colours in components.

---

## Build & run commands

```bash
npm run dev          # Dev mode (Vite + Electron hot-reload)
npm run build        # Compile TS + bundle (no packaging)
npm run dist:win     # Build Windows NSIS installer
```

---

## Key data types (src/types.ts)

```typescript
Tab          { id, title, content, path, dirty, lastSavedAt }
Phrase       { id, name, content }
LaunchConfig { id, name, model, folder, yolo, mode }
Settings     { theme, language, useOneDrive? }
SessionData  { tabs: Pick<Tab, 'id'|'title'|'content'|'path'>[], activeTabId }
```

---

## Coding conventions

- **English** for all code, comments, and commit messages.
- **Conventional commits**: `feat:`, `fix:`, `refactor:`, `chore:`, etc.
- No default exports except for the root `App` component.
- CSS class names follow BEM-light: `block`, `block-element`, `block--modifier`.
- No inline styles except for truly dynamic values.
- Security: validate/sanitize all data arriving through IPC (model ids, file paths) before use.
