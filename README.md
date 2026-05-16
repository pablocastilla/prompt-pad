# Prompt Pad

A native desktop app (Electron + React) for writing, organising, and firing AI prompts at the **GitHub Copilot CLI** or **OpenCode** — without leaving your keyboard.

---

## Screenshots

### Editor — write your prompt in a distraction-free multi-tab editor

![Editor light theme](docs/screenshots/01-editor-light.png)

### Phrase Catalog — save and reuse text snippets with `Ctrl+1…9`

![Phrase catalog panel](docs/screenshots/02-phrases-panel.png)

### Launch Configurations — manage pre-configured Copilot CLI / OpenCode runs

![Launch configurations panel](docs/screenshots/03-launches-panel.png)

### Model Picker — choose the model at launch time (↑↓ + Enter)

![Model picker overlay](docs/screenshots/04-model-picker.png)

### Themes

| Dark | Cyberpunk | Gaudy |
|---|---|---|
| ![Dark theme](docs/screenshots/05-dark-theme.png) | ![Cyberpunk theme](docs/screenshots/06-cyberpunk.png) | 💥 Burst particles on every keystroke |

---

## Features

### Editor
- **Multi-tab**: unlimited tabs; `Ctrl+T` to create, middle-click or `×` to close.
- **Auto-session**: tab state (title, content, path) is saved every 600 ms and restored on the next launch.
- **Save/Open**: `Ctrl+S` (save), `Ctrl+Shift+S` (save as), `Ctrl+O` (open).
- **Copy prompt**: copies the entire active tab's content to the clipboard.
- **File attachments**: drag & drop files onto the editor or paste clipboard images (Snipping Tool, PrintScreen). Attached files are sent alongside your prompt when launching.
- **Gaudy theme animations**: colour burst particles on every keystroke, converging particles on deletion, floating background particles, scanline overlay, and pulsing fire button.

### Phrase Catalog
- **Reusable snippets**: create named text templates you type once and reuse everywhere.
- **Keyboard insertion**: `Ctrl/⌘+1` through `Ctrl/⌘+9` (and `+0`) insert phrase at the current cursor position — shortcuts are assigned by list order.
- **Drag-to-reorder**: grab the ⠿ handle and drop a phrase to a new position. The `Ctrl+N` shortcuts adjust automatically and the new order is auto-saved.
- **Search**: filter phrases by name or content with the search bar.

### Launch Configurations
- **One launcher per folder + CLI**: the idea is simple — create one launch config for each project folder and each AI tool you use. Working on `my-react-app` with Copilot? One launcher. Same folder but want to try OpenCode? Another launcher. Different project? Yet another. It's like git worktrees, but for people who find worktrees confusing (which is to say, most of us). Instead of juggling terminal tabs, `cd`-ing to the right directory, remembering which flags to pass, and then forgetting which model you were using — you just click 🚀. Your future self, drowning in `cd ../../oops-wrong-dir`, will thank you.
- **Pre-configured runs**: each config stores a name, working folder, `--yolo` flag, tool (Copilot CLI or OpenCode), and interactive / non-interactive mode.
- **Model chosen at launch time**: when you fire a config (🚀 button or `Ctrl+Shift+1–9`), a **model picker** appears — navigate with `↑ ↓`, confirm with `Enter`, cancel with `Esc`.
- **Drag-to-reorder**: drag the ⠿ handle to reprioritise configs. The `Ctrl+Shift+N` shortcuts follow the list order and are auto-saved.
- **Keyboard shortcuts**: `Ctrl/⌘+Shift+1` through `+9` (and `+0`) fire the corresponding launch config on the current tab's content.
- **Pin favourite models**: pin models in the picker for quick access with number keys.

### Model Picker
- **Dynamic model lists**: fetches available models from both Copilot CLI (`copilot help config`) and OpenCode (`opencode models`) at runtime.
- **Dual tool support**: automatically shows the correct model list based on whether the launch config uses Copilot or OpenCode.
- **Pinned models**: pin your most-used models to the top for instant keyboard access (`Ctrl+1-0` to pin/unpin, `1-0` to launch pinned).
- **Drag-to-reorder pinned**: reorder pinned models by dragging.

### Themes
Four themes controlled by `data-theme` on `<html>`: `light`, `dark`, `gaudy`, `cyberpunk`.

| Theme | Description |
|---|---|
| **Light** | Clean, minimal white editor |
| **Dark** | Pure black OLED-friendly |
| **Gaudy** | Deep purple/magenta with gold accents. Burst particles on typing, converging particles on deletion, floating background particles, scanline overlay, typing glow effect, pulsing fire button, and themed toast notifications |
| **Cyberpunk** | Neon cyan/pink grid, glowing accents |

### Settings
- **Language**: auto-detect (from system locale), English, or Spanish.
- **OneDrive sync**: `phrases.json` and `launches.json` can be synced via OneDrive. First-enable migrates existing files automatically.
- **Auto-updates**: automatically checks for new versions on startup and every 4 hours. Downloads and installs updates silently — just restart when prompted. Manual check button also available.

### Auto-Updates
Prompt Pad automatically keeps itself up to date:
- Checks for updates on every launch
- Periodic background checks every 4 hours
- Downloads updates silently in the background
- Prompts to restart when a new version is ready
- Manual "Check for updates" button in Settings
- No need to manually download installers — updates are applied automatically

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ + 1–9, 0` | Insert phrase #1–10 at cursor |
| `Ctrl/⌘ + Shift + 1–9, 0` | Open model picker for launch config #1–10 |
| `Ctrl/⌘ + S` | Save current tab |
| `Ctrl/⌘ + Shift + S` | Save current tab as… |
| `Ctrl/⌘ + O` | Open file into current tab |
| `Ctrl/⌘ + T` | New tab |
| `Ctrl + 1–0` (in model picker) | Pin/unpin model |
| `1–0` (in model picker) | Launch pinned model |

---

## Development

```bash
npm install
npm run dev          # Vite dev server + Electron hot-reload
```

## Build & package

```bash
npm run build        # TypeScript compile + Vite bundle (no packaging)

npm run dist:win     # Windows NSIS installer  (x64)
npm run dist         # All platforms (Windows + macOS)
```

### macOS installer
The macOS build produces a `.dmg` installer for both Intel (`x64`) and Apple Silicon (`arm64`) Macs. Download the appropriate `.dmg` from GitHub Releases, open it, and drag Prompt Pad to your Applications folder.

---

## Data storage

All local data lives in `~/.prompt-pad/`:

| File | Contents |
|---|---|
| `settings.json` | Theme, language, OneDrive preference |
| `phrases.json` | Phrase catalog *(moved to OneDrive when sync is on)* |
| `launches.json` | Launch configurations *(moved to OneDrive when sync is on)* |
| `session.json` | Open tabs state (autosaved; ephemeral) |
| `prompts/` | Explicitly saved prompt files |

### OneDrive paths (when sync is enabled)

| OS | Path |
|---|---|
| Windows | `%OneDrive%\Apps\PromptPad\` |
| macOS | `~/Library/CloudStorage/OneDrive-Personal/Apps/PromptPad/` |

When you enable OneDrive sync for the first time, existing local `phrases.json` and `launches.json` are **migrated automatically**.

---

## Tech stack

| Layer | Library / Tool | Version |
|---|---|---|
| Native shell | Electron | 39 |
| UI | React | 18 |
| Language | TypeScript | 5 |
| State | Zustand | 5 |
| Bundler | Vite (vite-plugin-electron) | 6 |
| Packaging | electron-builder | 26 |
| Auto-updates | electron-updater | 6 |
| Package manager | npm | – |
