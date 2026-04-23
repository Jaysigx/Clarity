# Changelog

All notable changes to Clarity IDE are documented here.
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- **Integrated terminal panel** — xterm.js frontend + WebSocket backend with raw PTY via `node-pty`; Ctrl+\` toggles; multiple tabs; resize-aware via `FitAddon`
- **Light theme** — full CSS variable override for `[data-theme="light"]`; theme selection now applies to `<html data-theme>` attribute at runtime
- **Darker / Midnight / Gruvbox Dark themes** — all four variants fully styled via CSS custom properties
- **AI commit message** — "✦ AI Message" button in git panel streams a conventional commit message from the staged diff using the active model
- **Git: Fetch** — `POST /api/git/fetch` + Fetch button in git panel (`git fetch --prune`)
- **Git: Stash / Pop** — `POST /api/git/stash` with `push`, `pop`, `list`, `drop` actions + Stash / Pop buttons in git panel
- **Git: Blame** — `POST /api/git/blame` returns per-line hash, author, date
- **Git: Conflict detection** — `GET /api/git/conflicts` returns files with unresolved merge markers
- **File copy** — `POST /api/file/copy` with path sandbox guard
- **Search replace** — `POST /api/search/replace` replaces across workspace files server-side
- **AI autocomplete (ghost text)** — `POST /api/autocomplete` with FIM prompt support for DeepSeek/StarCoder/CodeLlama; chat-model fallback for others
- **AI explain selection** — `POST /api/explain` streams an explanation of selected code
- **AI generate tests** — `POST /api/test/generate` streams unit tests for selected code (configurable framework)
- **AI docstring** — `POST /api/docstring` generates JSDoc/docstring for a function
- **`.gitignore`** — root `.gitignore` covering Node, Rust/Tauri, OS files, secrets, editor files
- `Makefile` `desktop-install`, `desktop-dev`, `desktop-build`, `desktop-dist`, `desktop-clean` targets

### Fixed
- Theme switching now immediately re-renders `data-theme` attribute on `<html>` — previously only CSS variables were updated
- `applySettings` no longer requires page reload to see theme changes

---

## [0.2.0] — Desktop + Git + Terminal

### Added
- Toast notification system (success / error / info, auto-dismiss, click-to-dismiss)
- Explorer right-click context menu: New File, New Folder, Rename, Delete, Copy Path
- Go-to-line overlay (`Ctrl+G`) with live line hint
- `/api/file/create` — create file or directory with path validation
- `/api/file/rename` — rename / move file or directory
- `/api/file/delete` — recursive delete with path guard
- `/api/git/push` — push current branch to remote
- `/api/git/pull` — pull with optional rebase
- `/api/git/branches` — list all local branches
- `/api/git/checkout` — switch or create branch
- Git panel: Push / Pull buttons in header
- Git panel: Branch switcher dropdown with filter and create-new support
- Agent sidebar: collapsible, searchable file tree mirroring the explorer
- Search panel overhaul: replace row, inline clear, filter labels with icons, loading spinner, F3/Shift+F3 navigation, collapse/expand-all toolbar, Replace All
- Groq API key passed per-request from client settings (fixes Groq models not working)
- `.env` file loading at server startup for `GROQ_API_KEY`
- `.nvmrc` pinning Node.js 20
- `Makefile` with `dev`, `build`, `clean`, `install`, `typecheck` targets
- **Desktop app (Electron)** under `apps/desktop/` — `main.js` spawns `server.mjs` on a free port, opens a `BrowserWindow`; `preload.js` exposes safe IPC bridge; native OS menu bar with File › Open Folder…; supports `desktop-install`, `desktop-dev`, `desktop-build`, `desktop-dist` Makefile targets
- OpenRouter provider support — 50+ models including Claude, Gemini, Llama via single API key
- Welcome screen with recent files and quick actions
- Settings search (filter all settings rows by keyword)
- In-editor find & replace bar (`Ctrl+F` / `Ctrl+H`) with regex, case, word-boundary modes; F3/Shift+F3 navigation
- Slash commands in chat (`/fix`, `/explain`, `/test`, `/refactor`, `/optimize`, `/doc`, `/commit`)
- Session export as Markdown (`Ctrl+Shift+S`)

### Fixed
- Groq streaming always returned 401 when `GROQ_API_KEY` env var was absent
- Provider health check for Groq now passes Authorization header
- `renderFileTree` now syncs agent sidebar file tree on every update

---

## [0.1.0] — Initial Release

### Added
- Single-file Node.js server (`server.mjs`) with no external runtime dependencies
- LM Studio, Ollama, and Groq provider support with SSE streaming
- Full workspace text search with regex / case / whole-word modes
- BM25 context ranking engine with token-budget packing
- AI chat with session management, rolling summary compression, token meter
- Composer (AI patch generation + apply) with unified diff preview
- Git panel: status, staged/unstaged/untracked, inline diff, commit, log
- Explorer with folder tree, file icons, filter, collapse-all
- Settings overlay with Basic/Advanced mode, theme, accent color, all provider options
- Command palette (`Ctrl+K`) with fuzzy file + command search
- Resizable sidebar and agent pane
- CRT scanlines effect, custom accent color theming
