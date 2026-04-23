# Clarity IDE

> An AI-native code editor built for speed, privacy, and deep model integration.  
> Runs entirely on your machine — **no cloud, no login, no telemetry, fully open source.**

---

## Table of Contents

1. [Overview](#overview)
2. [Feature Set](#feature-set)
3. [Desktop App (Electron)](#desktop-app-electron)
4. [Architecture](#architecture)
5. [Project Layout](#project-layout)
6. [Quick Start](#quick-start)
7. [Configuration](#configuration)
8. [Model Providers](#model-providers)
9. [Context Engine](#context-engine)
10. [Chat & Session Management](#chat--session-management)
11. [Source Control](#source-control)
12. [Search](#search)
13. [Integrated Terminal](#integrated-terminal)
14. [Composer (AI Patch)](#composer-ai-patch)
15. [Keyboard Shortcuts](#keyboard-shortcuts)
16. [API Reference](#api-reference)
17. [Settings Reference](#settings-reference)
18. [Roadmap](#roadmap)
19. [Contributing](#contributing)

---

## Overview

Clarity is a fully self-hosted AI IDE built on a Node.js backend and a TypeScript/vanilla-JS frontend. It requires no VS Code extension host and no internet connection (unless using Groq). Every feature — editing, chat, AI composition, context retrieval, git integration — runs inside a single lightweight process. The optional Electron shell wraps the same server for a native desktop experience.

**Design goals:**

- **Zero login** — open the folder, run the server, start coding
- **Zero payment** — Groq offers a free API tier; LM Studio and Ollama are 100% free and offline
- **Local-first** — works fully offline with LM Studio or Ollama
- **Fully open source** — MIT licensed, no telemetry, no phoning home
- **Desktop + browser** — run in a browser tab or as a native desktop app via Electron
- **Configurable context window** — BM25 ranked chunking with per-session token budgets
- **Real editor** — textarea editing with syntax highlighting, Tab/auto-indent/bracket-close, auto-save, dirty tabs
- **Streaming everywhere** — all AI responses stream token-by-token via SSE

---

## Feature Set

### Editor
- Dual-layer editor: `<textarea>` for input, `<pre>` highlight layer behind it (same technique as CodeMirror lite)
- Syntax highlighting via highlight.js for 30+ languages
- Tab key inserts spaces (configurable tab size), Shift+Tab dedents selection
- Auto-close brackets: `(`, `[`, `{`, `"`, `'`, `` ` ``
- Auto-indent on Enter, extra indent after `{`/`(`/`[`
- `Ctrl+S` / `Cmd+S` force saves; auto-save debounced at 800ms
- Dirty indicator (`●`) on tab label until saved
- Multi-tab with close buttons; saves before switching tabs
- Line numbers with live update; cursor `Ln X, Col Y` in status bar
- Word-wrap toggle; configurable font size and family

### Explorer
- VS Code-style folder tree: chevron expand/collapse, amber folder icons, colored file-type SVG icons
- 40+ file type icons (TypeScript, JavaScript, Python, Rust, Go, JSON, Markdown, CSS, HTML, YAML, TOML, shell, Dockerfile, Git, lock files, env, config files…)
- Filter bar with live file count; collapse-all button
- Session-persistent open folder state (via `sessionStorage`)
- Click any file to open it in the editor

### Integrated Terminal
- xterm.js renderer with full VT100 / 256-color / Unicode support
- WebSocket backend — raw PTY via `node-pty` (not just `child_process`)
- Multiple terminal tabs — create, rename, close
- `Ctrl+\`` to toggle panel; resize-aware via `FitAddon`
- Opens in workspace root; inherits `$SHELL`

### Themes
- **Dark** (default), **Darker**, **Midnight Blue**, **Gruvbox Dark**, **Light**
- All themes implemented as CSS custom property overrides on `[data-theme]`
- Custom accent color picker (6 swatches) applied at runtime

### Search
- Full workspace text search — no external tools required, pure Node.js
- Live debounced results (350ms) as you type, Enter forces immediate
- Match case (`Aa`), whole word (`ab`), regex (`.*`) toggle buttons
- Include / exclude path filters
- Results grouped by file with collapsible sections
- Match highlights in golden yellow
- Click any match to open the file
- `Ctrl+Shift+F` / `Cmd+Shift+F` global shortcut

### Source Control (Git)
- No-repo empty state with **Initialize Repository** and **Publish to GitHub** buttons
- Branch name + ahead/behind sync badge
- Three sections: **Staged**, **Changes**, **Untracked** — all collapsible
- Per-file: Stage / Unstage / Discard (with confirmation) inline on hover
- Bulk: Stage all, Unstage all, Stage all untracked, Discard all
- Inline diff viewer (color-coded +/- lines) on file click; toggle by clicking same file again
- Commit message textarea + **AI Message** button (generates conventional commit from staged diff)
- Commit log (last 30 commits) — lazy-loaded when section is expanded; shows hash, subject, author, relative time
- Red badge on activity bar button showing total changed file count
- **Fetch** button (`git fetch --prune`)
- **Stash / Pop** buttons (`git stash push` / `git stash pop`)

### AI Chat
- Streaming responses via SSE from any configured provider
- **Session management**: up to 20 named sessions persisted in `localStorage`; history drawer slides in, sessions are titled from first user message
- **Rolling summary compression**: when history exceeds 85% of token budget, older messages are summarized via a separate LLM call and stored as a collapsible summary block
- **Token meter**: live progress bar at top of chat panel showing history + context token usage vs. budget
- **Auto-inject context**: BM25-ranked code chunks from the open file are automatically injected into every system prompt
- Markdown rendering in messages: fenced code blocks with syntax highlighting and copy button, inline code, timestamps
- Auto-resize textarea; Enter to send, Shift+Enter for newline
- **Slash commands**: `/fix`, `/explain`, `/test`, `/refactor`, `/optimize`, `/doc`, `/commit`
- "Send errors" button captures last 5 console errors and sends them to the model
- Compress button manually triggers history summarization
- Export session as Markdown (`Ctrl+Shift+S`)

### Composer (AI Patch)
- Describe a change in natural language → model generates a unified diff
- Diff preview with color-coded +/- lines
- One-click Apply writes the patch to disk and reloads the editor
- Discard clears the pending patch

### Context Panel
- Manual BM25 context ranking with configurable query, token budget, max chunks, chunks-per-file
- Token budget progress bar per search
- Per-chunk: file path, line range, BM25 score, token count, code preview
- Per-chunk inject button: pastes chunk into chat input and switches to chat tab
- Inject-all button: pastes all chunks and updates live context

### Models Panel
- Lists all models from LM Studio, Ollama, and Groq simultaneously
- Provider badges (LOCAL / CLOUD) with color coding
- Click to select active model; selection persisted across sessions
- Health indicators per provider

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              Browser (UI)  /  Tauri WebviewWindow            │
│  ui.ts → compiled to dist/ui.js                              │
│  index.html + styles.css + xterm.js                          │
│                                                              │
│  Panels: Explorer · Search · Git · Terminal · Chat           │
│          Composer · Context · Models · Settings              │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTP + SSE + WebSocket (/terminal)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│              server.mjs  (Node.js HTTP + WS)                 │
│                                                              │
│  /api/files            file tree walk                        │
│  /api/file/*           read/write/rename/delete/copy/create  │
│  /api/models/list      list all provider models              │
│  /api/providers/health provider health check                 │
│  /api/chat             SSE streaming chat                    │
│  /api/chat/summarize   SSE rolling summary                   │
│  /api/composer/patch   SSE diff generation                   │
│  /api/composer/apply   apply unified diff                    │
│  /api/context/rank     BM25 chunk ranking                    │
│  /api/search           workspace text search                 │
│  /api/search/replace   replace across files                  │
│  /api/git/*            status/diff/log/stage/commit/         │
│                        push/pull/branch/stash/fetch/blame    │
│  /api/autocomplete     FIM ghost-text completion             │
│  /api/explain          explain selected code                 │
│  /api/test/generate    generate unit tests                   │
│  /api/docstring        generate JSDoc/docstring              │
│  /api/git/commit-message  AI-generated commit message        │
│  /api/settings         read/write .clarity-settings.json     │
│  WS /terminal          raw PTY via node-pty                  │
└────────────────────────┬─────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┬──────────────┐
         ▼               ▼               ▼              ▼
    LM Studio         Ollama           Groq        OpenRouter
    (local)           (local)        (free cloud)  (50+ models)
```

---

## Desktop App (Electron)

Clarity ships a native desktop wrapper built with **Electron** under `apps/desktop/`.

### How it works

1. Electron's main process (`main.js`) finds a free TCP port
2. It spawns `apps/webview/server.mjs` as a child process with `--port <port>` and `CLARITY_DESKTOP=1`
3. It polls `GET /api/health` until the server is ready (up to 10 seconds)
4. Opens a `BrowserWindow` pointed at `http://127.0.0.1:<port>`
5. On app close the Node.js child process is killed cleanly

### Build & run

```bash
# Install Electron + electron-builder (first time only)
make desktop-install

# Run in dev mode
make desktop-dev

# Build unpacked app (fast, no installer)
make desktop-build

# Build distributable installers (.deb/.AppImage / .dmg / .exe)
make desktop-dist
```

**Requirements:** Node.js 20+  (no Rust, no system toolchain needed for dev)

### Electron features
- Free-port detection — no conflicts with other servers
- Native OS menu bar: File › Open Folder…, View, Help
- `File › Open Folder…` restarts the server in the chosen directory
- External links open in the OS browser, not inside the app
- `contextIsolation: true` + preload bridge — renderer has no direct Node access
- `CLARITY_DESKTOP=1` env var signals desktop mode to the server
- Bundled with `electron-builder`: `.AppImage` + `.deb` (Linux), `.dmg` (macOS), `.exe` NSIS installer (Windows)

### Key implementation details

- **BM25 ranking**: tokenize → IDF map → per-chunk BM25 score → greedy token-budget packing with per-file diversity cap
- **Semantic chunking**: splits on function/class boundaries using heuristics (blank line + indent reset), falls back to fixed-size chunks with token estimation (`chars / 4`)
- **SSE streaming**: all AI endpoints use chunked `text/event-stream`; client uses `ReadableStream` + `TextDecoder` to parse `data:` lines
- **Settings persistence**: `POST /api/settings` writes `.clarity-settings.json` in the workspace root; `GET /api/settings` reads it; UI also syncs to `localStorage`
- **Git**: all git operations use `execFile('git', ['-C', workspaceRoot, ...args])` — no `git` npm packages, just the system binary

---

## Project Layout

```
clarity/
├── apps/
│   ├── webview/                 # Main IDE (server + browser UI)
│   │   ├── server.mjs           # Node.js HTTP + WebSocket server
│   │   ├── index.html           # App shell (xterm.js, highlight.js)
│   │   ├── src/
│   │   │   ├── ui.ts            # All frontend logic (~3000 lines)
│   │   │   └── styles.css       # Design system + 5 themes
│   │   ├── dist/                # Compiled JS (tsc output)
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── desktop/                 # Electron native desktop wrapper
│       ├── package.json         # electron + electron-builder deps
│       ├── main.js              # Main process: port picker, Node spawn, BrowserWindow
│       └── preload.js           # Context-isolated IPC bridge to renderer
├── packages/
│   ├── context-engine/          # BM25 + chunking library
│   ├── model-gateway/           # Provider abstraction layer
│   ├── lsp-bridge/              # LSP diagnostics cache
│   └── shared-types/            # Shared TypeScript interfaces
├── docs/                        # Architecture and design docs
├── .clarity-settings.json       # Runtime settings (git-ignored)
├── tsconfig.base.json
└── package.json                 # Workspace root
```

---

## Quick Start

**Requirements:**
- Node.js 20+
- npm 10+
- Git (for source control features)
- Optionally: LM Studio, Ollama, or a Groq API key

```bash
# Install all workspace dependencies
npm install

# Build the webview TypeScript
npm run build --workspace @clarity/webview

# Start the IDE server
node apps/webview/server.mjs

# Open in browser
open http://localhost:5173
```

The server auto-detects the workspace root as the directory it's launched from.

---

## Configuration

Settings are stored in `.clarity-settings.json` at the workspace root and are also synced to `localStorage`. Open **Settings** (`Ctrl+,`) to configure everything in the UI.

### Basic mode settings

| Setting | Default | Description |
|---|---|---|
| Theme | `dark` | UI theme (`dark` / `darker` / `midnight` / `gruvbox` / `light`) |
| Accent color | `#3b82f6` | Accent color swatch |
| Font size | `13` | Editor font size (px) |
| Font family | `'JetBrains Mono'` | Editor monospace font |
| Word wrap | `false` | Wrap long lines |
| Line numbers | `true` | Show line numbers |
| Auto-save | `true` | Save on change (800ms debounce) |
| Tab size | `4` | Spaces per Tab keypress |
| System prompt | (built-in) | LLM system prompt prefix |

### Advanced mode settings

| Setting | Default | Description |
|---|---|---|
| Context tokens | `2000` | Token budget for BM25 context injection |
| Context chunks | `8` | Max chunks injected per prompt |
| Chunks per file | `3` | Max chunks from one file |
| Max files | `60` | Max files scanned during context ranking |
| BM25 weight | `0.3` | Weight of BM25 score vs. recency |
| Chunk tokens | `180` | Target tokens per semantic chunk |
| Streaming | `true` | Enable SSE streaming |
| Inject file context | `true` | Auto-inject BM25 chunks into chat |
| LM Studio URL | `http://127.0.0.1:1234/v1` | LM Studio OpenAI-compatible endpoint |
| Ollama URL | `http://127.0.0.1:11434` | Ollama base URL |
| Groq API key | `` | Groq API key (stored locally only) |
| Health poll interval | `8` | Seconds between provider health checks |
| Log level | `warn` | Console log verbosity |

---

## Model Providers

### LM Studio
1. Download [LM Studio](https://lmstudio.ai/)
2. Load any GGUF model
3. Start the local server (default port 1234)
4. Models auto-appear in the Models panel

### Ollama
1. Install [Ollama](https://ollama.ai/)
2. Pull a model: `ollama pull llama3`
3. Ollama runs automatically on port 11434
4. Models auto-appear in the Models panel

### Groq (free cloud)
1. Get a free API key at [console.groq.com](https://console.groq.com)
2. Paste the key in **Settings → Providers → Groq API Key**
3. Available models (always listed, no server needed):
   - `llama-3.3-70b-versatile` — best for chat and composition
   - `llama-3.1-8b-instant` — fastest responses
   - `mixtral-8x7b-32768` — large context window (32k)
   - `gemma2-9b-it` — Google Gemma 2

---

## Context Engine

The context engine automatically finds the most relevant code to inject into every AI prompt.

### How it works

1. **File walk** — scans workspace for supported file types (TS, JS, Python, Rust, Go, Markdown, JSON, CSS, HTML, Bash, YAML, TOML)
2. **Semantic chunking** — splits each file at function/class boundaries or every ~180 tokens
3. **BM25 ranking** — scores each chunk against the query (derived from current filename by default)
4. **Token-budget packing** — greedily selects top chunks until the token budget is exhausted, with a per-file cap to ensure diversity
5. **Injection** — selected chunks are prepended to the system prompt as fenced code blocks with file path and line range

### Manual context ranking

Open the **Context** panel and:
- Enter a custom query
- Adjust token budget, max chunks, chunks-per-file
- Click **Rank Context** to see scored results
- Click ⚡ on any chunk to inject it into the chat input
- Click **Inject All** to inject all results and switch to chat

---

## Chat & Session Management

### Sessions
- Each conversation is a **session** — up to 20 are persisted in `localStorage`
- Sessions are automatically titled from the first user message
- Click the clock icon to open the **history drawer** (slides in over the chat log)
- Click any session to restore it, including its summary block
- Delete sessions with the ✕ button
- Create a new session with the `+` button

### Context window management
- A **token meter** at the top of the chat panel shows live usage
  - Green: under 70% of budget
  - Amber: 70–90%
  - Red: over 90%
- When history exceeds **85% of the token budget**, the IDE automatically compresses older messages into a bullet-point summary via a secondary LLM call
- The summary is stored on the session and shown as a collapsible block at the top of the chat log
- You can trigger compression manually with the archive button
- History is trimmed before each API call to always fit within the budget

---

## Source Control

The git panel (activity bar → branch icon) provides:

| Feature | Notes |
|---|---|
| Branch display | Current branch name + ↑ahead ↓behind |
| Branch switcher | Dropdown with filter + create new branch |
| Staged files | Files added to the index |
| Changes | Modified tracked files |
| Untracked | New files not yet added |
| Inline diff | Click a file to see colored +/- diff |
| Stage / Unstage | Per-file or bulk |
| Discard | Restores file to HEAD (with confirmation) |
| Commit | Enter message + click Commit Staged |
| AI commit message | ✦ AI Message generates conventional commit from staged diff |
| Commit log | Last 30 commits, lazy-loaded |
| Push / Pull | Full push/pull with upstream awareness |
| Fetch | `git fetch --prune` |
| Stash / Pop | `git stash push` / `git stash pop` |
| Initialize repo | `git init` in workspace root |
| Publish to GitHub | Opens `github.com/new` |

**No-repo state**: if the workspace isn't a git repository, the panel shows an empty state with **Initialize Repository** and **Publish to GitHub** buttons.

---

## Search

Workspace-wide text search with no external dependencies:

- Type in the search box → results appear after 350ms debounce
- **Aa** — match case
- **ab** — whole word only
- **.\*** — treat query as regex
- **Include** field — filter to paths containing a substring (e.g. `src`)
- **Exclude** field — skip paths containing a substring (e.g. `dist`, `node_modules`)
- Results grouped by file; click a file header to collapse/expand its matches
- Click any match line to open the file in the editor
- `Ctrl+Shift+F` opens the search panel and focuses the input

---

## Integrated Terminal

The terminal panel (`Ctrl+\``) provides a full PTY terminal inside the IDE:

- **xterm.js** renders VT100, 256-color ANSI, Unicode
- **WebSocket** connects to the server's `/terminal` endpoint
- **node-pty** spawns a real PTY process (bash/zsh/fish/PowerShell)
- Multiple tabs — click **+** for a new session
- **Clear** button and keyboard `Ctrl+L`
- **Resize** — FitAddon automatically resizes the PTY on panel resize
- Opens in the workspace root; inherits your `$SHELL` environment

> **Note:** `node-pty` is an optional dependency. The terminal silently fails to connect if not installed. Install it with `npm install node-pty` in `apps/webview/`.

---

## Composer (AI Patch)

1. Open a file in the editor
2. Switch to the **Compose** tab (or press `Ctrl+Shift+P`)
3. Describe the change you want in natural language
4. Click **Generate Patch** — the model streams a unified diff
5. Review the colored diff preview
6. Click **Apply** to write the patch to disk and reload the editor, or **Discard** to cancel

The composer always operates on the currently open file. The model is given the full file content plus your instruction.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` / `Cmd+K` | Open command palette |
| `Ctrl+,` / `Cmd+,` | Open settings |
| `Ctrl+S` / `Cmd+S` | Save current file |
| `Ctrl+F` | In-editor find bar |
| `Ctrl+H` | In-editor find & replace bar |
| `Ctrl+G` | Go to line |
| `` Ctrl+` `` | Toggle integrated terminal |
| `Ctrl+Shift+F` | Open search panel |
| `Ctrl+Shift+A` | Focus chat input |
| `Ctrl+Shift+P` | Open composer tab |
| `Ctrl+Shift+X` | Open context panel + rank |
| `Ctrl+Shift+E` | Focus explorer filter |
| `Ctrl+Shift+S` | Export session as Markdown |
| `Tab` | Indent (or indent selection) |
| `Shift+Tab` | Dedent selection |
| `F3` / `Shift+F3` | Next / previous find match |
| `Enter` (in chat) | Send message |
| `Shift+Enter` (in chat) | Insert newline |

---

## API Reference

All endpoints are served by `server.mjs` on `http://localhost:5173`.

### Files

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/files` | List all workspace files |
| `GET` | `/api/file/:path` | Read file content + lang + line count |
| `POST` | `/api/file/write` | Write `{ path, content }` to disk |
| `POST` | `/api/file/create` | Create file or directory |
| `POST` | `/api/file/rename` | Rename / move `{ from, to }` |
| `POST` | `/api/file/delete` | Delete `{ path }` (recursive) |
| `POST` | `/api/file/copy` | Copy `{ from, to }` (recursive) |

### Models

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/models/list` | List models from all providers |
| `GET` | `/api/providers/health` | Health status of each provider |

### AI

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/chat` | `{ messages, model, provider }` | SSE streaming chat |
| `POST` | `/api/chat/summarize` | `{ messages, model, provider, keepLast }` | SSE rolling summary |
| `POST` | `/api/composer/patch` | `{ instruction, fileContent, filePath, model, provider }` | SSE diff generation |
| `POST` | `/api/composer/apply` | `{ path, content }` | Write patched file |
| `POST` | `/api/autocomplete` | `{ prefix, suffix, language, model, provider, maxTokens }` | SSE ghost-text completion |
| `POST` | `/api/explain` | `{ code, language, model, provider }` | SSE code explanation |
| `POST` | `/api/test/generate` | `{ code, language, framework, model, provider }` | SSE unit test generation |
| `POST` | `/api/docstring` | `{ code, language, model, provider }` | SSE JSDoc/docstring generation |
| `POST` | `/api/git/commit-message` | `{ model, provider }` | SSE conventional commit from staged diff |

### Context

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/context/rank` | `{ query, maxTokens, maxChunks, chunksPerFile, maxFiles, includeContent }` | BM25 chunk ranking |

Response shape:
```json
{
  "totalTokens": 1840,
  "budgetTokens": 2000,
  "chunks": [
    {
      "rank": 1,
      "filePath": "apps/webview/src/ui.ts",
      "startLine": 120,
      "endLine": 145,
      "tokens": 210,
      "score": 3.142,
      "lang": "typescript",
      "preview": "function openFile(filePath: string)...",
      "content": "..."
    }
  ]
}
```

### Search

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/search` | `{ query, caseSensitive, wholeWord, regex, includeGlob, excludeGlob, maxResults }` | Workspace text search |
| `POST` | `/api/search/replace` | `{ query, replacement, caseSensitive, wholeWord, regex, filePaths? }` | Replace across files |

### Git

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/api/git/branch` | — | Current branch name |
| `GET` | `/api/git/status` | — | Branch, files, ahead/behind |
| `POST` | `/api/git/diff` | `{ filePath, staged }` | Unified diff for a file |
| `GET` | `/api/git/log` | — | Last 30 commits |
| `POST` | `/api/git/stage` | `{ filePath }` | `git add` a file |
| `POST` | `/api/git/unstage` | `{ filePath }` | `git restore --staged` |
| `POST` | `/api/git/discard` | `{ filePath }` | `git restore` (discard changes) |
| `POST` | `/api/git/commit` | `{ message }` | `git commit -m` |
| `POST` | `/api/git/init` | — | `git init` in workspace root |
| `POST` | `/api/git/push` | — | Push current branch |
| `POST` | `/api/git/pull` | `{ rebase? }` | Pull with optional rebase |
| `GET` | `/api/git/branches` | — | List all branches |
| `POST` | `/api/git/checkout` | `{ branch, create? }` | Switch / create branch |
| `POST` | `/api/git/stash` | `{ action, message?, ref? }` | Stash push/pop/list/drop |
| `POST` | `/api/git/fetch` | — | `git fetch --prune` |
| `POST` | `/api/git/blame` | `{ filePath }` | Per-line blame (hash, author, date) |
| `GET` | `/api/git/conflicts` | — | Files with unresolved merge markers |

### Terminal (WebSocket)

| Upgrade | Path | Query params | Description |
|---|---|---|---|
| `WS` | `/terminal` | `cols`, `rows`, `shell` | Raw PTY session via `node-pty` |

### Settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/settings` | Read `.clarity-settings.json` |
| `POST` | `/api/settings` | Write `.clarity-settings.json` |

---

## Settings Reference

`.clarity-settings.json` (auto-generated, safe to commit or gitignore):

```json
{
  "theme": "dark",
  "accent": "#3b82f6",
  "fontSize": 13,
  "fontFamily": "'JetBrains Mono', 'Fira Code', monospace",
  "scanlines": true,
  "sidebarWidth": 260,
  "agentWidth": 400,
  "tabSize": 4,
  "wordWrap": false,
  "lineNumbers": true,
  "syntaxHl": true,
  "autoSave": true,
  "systemPrompt": "You are an expert coding assistant...",
  "ctxTokens": 2000,
  "ctxChunks": 8,
  "streaming": true,
  "injectFile": true,
  "bm25Weight": 0.3,
  "chunkTokens": 180,
  "maxFiles": 60,
  "chunksPerFile": 3,
  "lmstudioUrl": "http://127.0.0.1:1234/v1",
  "ollamaUrl": "http://127.0.0.1:11434",
  "groqApiKey": "",
  "healthInterval": 8,
  "reqTimeout": 3,
  "telemetry": false,
  "logLevel": "warn",
  "vectorCtx": false,
  "lspDiag": false,
  "multifile": false,
  "advancedMode": false
}
```

---

## Roadmap

See [`TODO.md`](./TODO.md) for the full tracked task list.

**Shipped (v0.2):**
- ✅ Integrated terminal (xterm.js + node-pty + WebSocket)
- ✅ 5 themes: Dark, Darker, Midnight, Gruvbox, Light
- ✅ AI commit message generation from staged diff
- ✅ Git: Fetch, Stash/Pop, Blame, Conflict detection
- ✅ File copy, search/replace across files
- ✅ AI autocomplete (ghost text), explain, test generation, docstring
- ✅ Desktop app (Electron) — native window, free-port spawn, OS menu bar
- ✅ `.gitignore` with full Node/Rust/OS/secrets coverage

**Near-term (v0.3):**
- Ghost-text inline autocomplete UI (Tab to accept)
- LSP integration — tsserver, Pyright, rust-analyzer
- Multi-file composer (patch across files in one diff)
- Vector embeddings context (semantic similarity)
- `@filename` mention autocomplete in chat

**Mid-term (v0.4):**
- Plugin/extension API (ES module loader + manifest)
- Tree-sitter syntax highlighting
- AI rename / refactor actions
- Remote workspace over SSH
- Docker + Homebrew + AUR distribution

**Long-term:**
- Debugger integration (DAP)
- Real-time collaboration via CRDT
- Mobile companion app

---

## Contributing

This is a monorepo managed with npm workspaces.

```bash
# Typecheck all packages
npm run typecheck

# Build webview
npm run build --workspace @clarity/webview

# Run the server in dev (auto-rebuild manually after edits)
node apps/webview/server.mjs
```

**Code style:**
- TypeScript strict mode throughout
- No runtime npm dependencies in the browser bundle — vanilla TS only
- All API endpoints in `server.mjs` (ESM, Node.js built-ins only)
- CSS variables for all colors — never hardcode hex in component styles

**Adding a new provider:**
1. Add an entry to `PROVIDERS` in `server.mjs`
2. Add a streaming function (or reuse `streamOpenAI` if OpenAI-compatible)
3. Route the new provider in `handleChat` and `handleComposerPatch`
4. Add the provider's models to `handleModelsList`
5. Add any API key field to `index.html` settings and `ui.ts` settings sync
