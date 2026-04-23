# Clarity IDE — TODO

> Full tracked task list. Goal: **best IDE with zero accounts, zero payment, fully open source**.
> Status: `[x]` done · `[ ]` pending · `[~]` in-progress · **[v1.0]** required for first release

## v1.0 Critical Path 🎯

### MUST HAVE for v1.0:
- [ ] LICENSE file — MIT **[v1.0]**
- [ ] Fix placeholder menu handlers (remove "Coming soon" for core features) **[v1.0]**
- [ ] Connect all Settings toggles to actual functionality **[v1.0]**
- [ ] Working editor scrolling (just fixed!) **[v1.0]** ✅
- [ ] Basic keyboard shortcuts all functional **[v1.0]**
- [ ] Git stash UI working **[v1.0]** ✅
- [ ] File operations (new/rename/delete) working **[v1.0]** ✅

### SHOULD HAVE for v1.0:
- [ ] E2E smoke test (open → edit → save → close)
- [ ] Windows/Linux/macOS builds working
- [ ] README quickstart guide
- [ ] First release on GitHub

---

---

## Foundation & Monorepo

- [x] Monorepo scaffold (`apps/*`, `packages/*`) with npm workspaces
- [x] TypeScript workspace setup with shared `tsconfig.base.json`
- [x] Root `README.md` with full feature, API, and settings docs
- [x] Architecture and implementation plan docs in `docs/`
- [x] `shared-types` package with common interfaces
- [x] `CHANGELOG.md` with semantic versioning entries
- [x] `.nvmrc` pinning Node.js 20
- [x] `Makefile` with `dev`, `build`, `clean`, `install`, `typecheck`, `desktop-*` targets
- [ ] `docker-compose.yml` — zero-setup local dev (Node + Ollama sidecar)
- [ ] `docker-compose.gpu.yml` — GPU-enabled Ollama variant
- [ ] `LICENSE` file — MIT
- [ ] `CONTRIBUTING.md` — guide for open-source contributors
- [ ] `CODE_OF_CONDUCT.md`
- [ ] `SECURITY.md` — responsible disclosure policy
- [ ] `GOVERNANCE.md` — project decision-making process
- [ ] Generate TypeDoc API docs from JSDoc comments, publish to GitHub Pages
- [ ] GitHub issue templates (bug report, feature request, LSP request)
- [ ] GitHub PR template with checklist

---

## Server (`server.mjs`)

### Core
- [x] Single-file Node.js HTTP server (no Express, ESM only)
- [x] CORS headers on all responses
- [x] Static file serving for compiled UI assets
- [x] JSON error helper with status codes
- [x] `readBody` for POST payloads
- [x] Workspace root auto-detected from CWD
- [x] Settings read/write (`/api/settings` GET + POST, `.clarity-settings.json`)
- [x] `--port` CLI arg + `PORT` env for custom port binding
- [x] WebSocket upgrade handler (needed by terminal + live reload)
- [ ] Live reload — push `data: reload` SSE event when any source file changes
- [ ] `/api/files/watch` — SSE stream of filesystem change events
- [ ] Binary file detection — serve as base64 for images, block edit on binary
- [ ] `/api/open-folder` — open a different workspace directory at runtime
- [ ] Request logging middleware (structured JSON logs, respects logLevel)
- [ ] Rate limiting on AI endpoints (prevent accidental runaway loops)

### File system
- [x] `walkDir` recursive file tree with lang detection and size
- [x] `/api/files` — list all workspace files
- [x] `/api/file/:path` — read file with content, lang, line count
- [x] `/api/file/write` — write to disk with path validation
- [x] `/api/file/rename` — rename/move a file or folder
- [x] `/api/file/delete` — delete with path guard
- [x] `/api/file/create` — create new file or directory
- [x] `/api/file/copy` — copy file or folder
- [ ] `/api/file/exists` — check if path exists (for safe create)
- [ ] Gitignore-aware file walk (exclude `.gitignore` patterns from tree)

### Git
- [x] `git()` helper — `execFile` wrapper, workspaceRoot `-C` flag
- [x] `/api/git/branch` — current branch name
- [x] `/api/git/status` — staged/unstaged/untracked, ahead/behind
- [x] `/api/git/diff` — per-file unified diff, staged or unstaged
- [x] `/api/git/log` — last 30 commits (hash, subject, author, relative time)
- [x] `/api/git/stage` — `git add`
- [x] `/api/git/unstage` — `git restore --staged`
- [x] `/api/git/discard` — `git restore`
- [x] `/api/git/commit` — `git commit -m`
- [x] `/api/git/init` — `git init`
- [x] `/api/git/push` — push current branch
- [x] `/api/git/pull` — pull with rebase option
- [x] `/api/git/branches` — list local branches
- [x] `/api/git/checkout` — switch or create branch
- [x] `/api/git/stash` — `git stash` push/pop/list/drop
- [x] `/api/git/stash/list` — list all stash entries
- [x] `/api/git/blame` — per-line blame (hash, author, date)
- [ ] `/api/git/show` — file content at a specific commit
- [x] `/api/git/conflicts` — parse `<<<<`/`====`/`>>>>` markers (conflict file list)
- [ ] `/api/git/resolve` — mark conflict file as resolved
- [ ] `/api/git/cherry-pick` — apply a specific commit
- [ ] `/api/git/tag` — create annotated tag
- [x] `/api/git/fetch` — `git fetch --prune`
- [ ] `/api/git/rebase` — interactive rebase support
- [ ] `/api/git/remote` — list / add / remove remotes
- [x] Root `.gitignore` — Node, Rust/Tauri, OS, secrets, editor files covered
- [ ] `.gitignore` quick-add — append path to `.gitignore` from explorer context menu

### Search
- [x] `/api/search` — full workspace text search, no external deps
- [x] Regex / case-sensitive / whole-word modes
- [x] Include/exclude path glob filters
- [x] Match range collection for highlight offsets
- [x] Sort results by match count desc
- [x] `/api/search/replace` — replace across files server-side
- [ ] File-name-only search mode (fast path, no content read)
- [ ] Symbol search — extract function/class names from AST or regex heuristics
- [ ] Automatically exclude `node_modules`, `dist`, `.git`, `__pycache__` (configurable)

### AI providers
- [x] LM Studio provider (OpenAI-compatible)
- [x] Ollama provider (native API + `/api/tags` model list)
- [x] Groq provider (free, OpenAI-compatible, 5 models)
- [x] OpenRouter provider (50+ models, generous free tier, no CC required)
- [x] `streamGroq` / `streamOpenAI` / `streamOllama` / `streamOpenRouter` SSE passthrough
- [x] `listModels` per provider with error handling
- [ ] Google Gemini provider (Gemini 2.0 Flash — free tier, no CC)
- [ ] Mistral AI provider (La Plateforme, free tier models)
- [ ] Together AI provider (open-source models, free tier)
- [ ] Hugging Face Inference API provider (free serverless endpoints)
- [ ] Jan.ai provider (OpenAI-compatible, fully local)
- [ ] llamafile support (single-binary model server)
- [ ] Provider health check with TTFB measurement
- [ ] Retry + exponential backoff on 429 / 5xx
- [ ] Model capability registry (context length, vision, function calling)
- [ ] Configurable request timeout per provider

### AI endpoints
- [x] `/api/chat` — SSE streaming chat with provider routing
- [x] `/api/chat/summarize` — SSE rolling history summarization
- [x] `/api/composer/patch` — SSE diff generation from instruction + file content
- [x] `/api/composer/apply` — write patched content to disk
- [x] `/api/context/rank` — BM25 chunk ranking with token-budget packing
- [ ] `/api/composer/multifile` — diff across multiple files in one instruction
- [ ] `/api/composer/preview` — return patched text without writing (for split preview)
- [x] `/api/autocomplete` — inline ghost-text completion (FIM + chat-model fallback)
- [x] `/api/explain` — explain selected code as SSE stream
- [ ] `/api/refactor` — extract function / rename symbol / inline variable
- [x] `/api/test/generate` — generate unit tests for a file or function
- [x] `/api/docstring` — generate JSDoc / docstring for a function
- [ ] `/api/fix` — diagnose and fix LSP errors in active file
- [x] `/api/git/commit-message` — generate commit message from staged diff
- [ ] `/api/review` — code review with inline comments

---

## Context Engine

- [x] `tokenize()` — lowercase word tokenizer for BM25
- [x] `buildIdf()` — inverse document frequency map over corpus
- [x] `bm25Score()` — BM25 scoring (k1=1.5, b=0.75)
- [x] `estimateTokens()` — `chars / 4` approximation
- [x] `chunkText()` — semantic chunking on function/class boundaries
- [x] Token-budget packing with per-file diversity cap
- [x] `includeContent` flag for fast listing
- [x] Language support: TS, JS, Python, Rust, Go, MD, JSON, CSS, HTML, Bash, YAML, TOML
- [ ] Tree-sitter WASM chunking — split at exact AST function/class boundaries
- [ ] Extend language support: Ruby, PHP, Java, C/C++, Swift, Kotlin, Elixir, Zig
- [ ] Vector embedding pipeline — embed chunks via Ollama `nomic-embed-text`
- [ ] FAISS / hnswlib in-memory vector index for semantic search
- [ ] Hybrid retrieval — BM25 + vector reranking via RRF fusion
- [ ] Persistent vector index — save/load embeddings to disk, skip unchanged files
- [ ] Diagnostics-first packing — always include chunks containing LSP error lines
- [ ] Context staleness penalty — down-rank chunks from files not recently touched
- [ ] Symbol index — extract all exported names per file for symbol search
- [ ] Cross-file reference tracing — include callers/callees of active function
- [ ] Gitignore-aware context scan (never embed `.gitignore`d files)

---

## Editor

- [x] Dual-layer editor — `<textarea>` input, `<pre>` highlight behind
- [x] Syntax highlighting via highlight.js (30+ languages)
- [x] Scroll sync between textarea and highlight pre
- [x] Tab key → configurable spaces (no focus trap)
- [x] Shift+Tab → dedent selected lines
- [x] Auto-close brackets: `(`, `[`, `{`, `"`, `'`, `` ` ``
- [x] Enter → auto-indent, extra indent after `{`/`(`/`[`
- [x] Ctrl+S / Cmd+S → force save
- [x] Auto-save on change (800ms debounce)
- [x] Dirty indicator `●` on tab label
- [x] Save before switching tabs
- [x] Multi-tab with close buttons
- [x] Line numbers with live update
- [x] Cursor position `Ln X, Col Y` in status bar
- [x] Word-wrap toggle
- [x] Configurable font size and family
- [x] Find & replace in editor (Ctrl+F / Ctrl+H) — case/word/regex, Prev/Next, Replace One/All
- [x] Go to line (Ctrl+G)
- [ ] Inline AI ghost-text autocomplete — debounce keyup → `/api/autocomplete` → overlay text, Tab to accept
- [ ] Multiple cursors — Alt+Click to add, Ctrl+D to select next occurrence
- [ ] Column / box selection — Alt+Shift+drag
- [ ] Code folding — collapse blocks at `{` / indent level, gutter chevrons
- [ ] Minimap — right-side pixel-density scroll overview with viewport indicator
- [ ] Sticky scroll — pin current function/class header at top of viewport
- [ ] Bracket pair colorization — CSS variable color cycling per depth
- [ ] Indent guides — vertical lines at each indent level
- [ ] Selection word highlight — all occurrences of selected word underlined
- [ ] Occurrence count badge — "3 occurrences" in status bar on selection
- [ ] Jump to definition (Ctrl+Click) via LSP
- [ ] Hover documentation popup via LSP `textDocument/hover`
- [ ] Inline error squiggles from LSP diagnostics (canvas overlay)
- [ ] Problems panel — list all diagnostics for open file
- [ ] Quick fix lightbulb — LSP `codeAction` context menu on error
- [ ] Rename symbol (F2) via LSP `textDocument/rename`
- [ ] Split editor panes — two editors side-by-side (Ctrl+\)
- [ ] Diff editor — original vs. modified split view for composer preview
- [ ] Vim keybindings mode — toggle in settings, normal/insert/visual mode
- [ ] Replace highlight.js with Tree-sitter WASM for accurate incremental highlighting
- [ ] Drag-and-drop file onto editor to open it
- [ ] Breadcrumb navigation in editor header — file › class › function, clickable
- [ ] Image preview — render PNG/JPEG/SVG/GIF inline instead of raw bytes
- [ ] Read-only mode for non-editable files (binary, very large)
- [ ] Format on save — run Prettier / language formatter via LSP `textDocument/formatting`
- [ ] Undo/redo stack (beyond browser default) with 100-step history

---

## Explorer

- [x] VS Code-style folder tree — chevron expand/collapse
- [x] Amber folder icons (open/closed)
- [x] 40+ colored SVG file-type icons
- [x] Sort: dirs first, both alphabetical
- [x] Filter bar with live file count
- [x] Collapse-all button
- [x] Session-persistent open folder state
- [x] Click file → open in editor
- [x] Refresh button
- [x] Active file highlighted with accent bar
- [x] Right-click context menu: New File, New Folder, Rename, Delete, Copy Path
- [ ] Drag-and-drop to move files/folders
- [ ] Inline file rename — double-click label
- [ ] Inline new file/folder — click `+` icon in tree header
- [ ] Dirty indicator dot on tree items for unsaved tabs
- [ ] Show/hide dotfiles toggle (`.env`, `.gitignore`, etc.)
- [ ] Show/hide `node_modules` / `dist` / `.git` toggle
- [ ] File size and last-modified tooltip on hover
- [ ] Multi-select — Ctrl+Click / Shift+Click, then bulk delete/move
- [ ] Copy relative path to clipboard
- [ ] Reveal active file in explorer (`Ctrl+Shift+E` already focuses filter)
- [ ] Open file in OS file manager button

---

## Search Panel

- [x] Full workspace text search — pure Node.js, no external deps
- [x] Live debounced results (350ms), Enter forces immediate
- [x] Match case, whole word, regex toggles
- [x] Include / exclude path filters
- [x] Results grouped by file, collapsible
- [x] Character-level match highlights (golden yellow)
- [x] Click match → open file in editor
- [x] Ctrl+Shift+F global shortcut
- [x] Result count ("47 matches in 8 files")
- [x] F3 / Shift+F3 match navigation
- [x] Replace mode — replace one or all
- [ ] Search history — last 10 queries, dropdown on focus
- [ ] Save search as named bookmark (persisted in localStorage)
- [ ] Auto-exclude `node_modules`, `dist`, `.git`, `__pycache__` (configurable)
- [ ] Symbol search — search function/class names only (AST-aware)
- [ ] Structural search — match code patterns (e.g. `console.log(...)`)

---

## Source Control Panel

- [x] No-repo empty state with Initialize Repository + Publish to GitHub
- [x] Branch name display
- [x] Ahead/behind sync badge (↑↓)
- [x] Staged / Changes / Untracked collapsible sections
- [x] File-type icons per row
- [x] Status badge per file (M, A, D, ?, colored)
- [x] Stage / Unstage / Discard per file (hover buttons)
- [x] Bulk: Stage all, Unstage all, Stage untracked, Discard all
- [x] Inline unified diff viewer (click to toggle)
- [x] Commit message textarea + Commit Staged
- [x] Commit log (last 30, lazy-loaded)
- [x] Red badge on activity bar (changed file count)
- [x] Push button
- [x] Pull button (with rebase)
- [x] Branch switcher dropdown (list + create + checkout)
- [ ] Stash / pop stash with stash list
- [ ] Merge conflict viewer — per-hunk Accept Ours / Accept Theirs / Accept Both
- [ ] Word-level diff highlighting (not just line-level)
- [ ] Commit graph — SVG branch visualization in log
- [ ] AI-generated commit message from staged diff (`/api/commit-message`)
- [ ] Cherry-pick commit from log
- [ ] Annotated tag creation
- [ ] `git fetch --prune` button
- [ ] Remote management (list / add / remove)
- [ ] `.gitignore` quick-add via context menu
- [ ] Amend last commit option
- [ ] Signed commits (GPG key config in settings)

---

## AI Chat

- [x] Streaming SSE responses for all providers
- [x] Session management — up to 20 sessions, localStorage persistence
- [x] Auto-title sessions from first user message
- [x] History drawer (slides over chat log)
- [x] Session restore (messages + summary block)
- [x] Delete session with confirmation
- [x] New session button
- [x] Rolling summary compression at 85% token budget
- [x] Manual compress button
- [x] Summary block as collapsible bullet list
- [x] Token meter — live bar (green/amber/red), count label
- [x] Auto-inject BM25 context chunks into system prompt
- [x] Context inject count badge
- [x] Markdown rendering — fenced code with copy button, inline code, tables
- [x] Message timestamps
- [x] "Send errors" button — injects last 5 console errors
- [x] Clear chat button
- [x] Abort streaming (stop button)
- [x] Slash commands (`/explain`, `/fix`, `/test`, `/summarize`, `/improve`, `/docstring`)
- [x] Export session as Markdown download
- [ ] `@filename` mention autocomplete — type `@` to search files, injects content
- [ ] `@url` mention — fetch URL content and inject into prompt
- [ ] Image attachment — paste screenshot (PNG/JPEG) into chat (vision models)
- [ ] File attachment — attach file contents via paperclip button
- [ ] Diff blocks in assistant messages — render `+/-` with Apply button inline
- [ ] Model switching mid-session without losing history
- [ ] Pin / star important messages
- [ ] React to messages (thumbs up/down for quality feedback)
- [ ] Multi-turn tool use — model can call `/api/search`, `/api/file`, `/api/git` autonomously
- [ ] Agent mode — model plans and executes multi-step file edits with approval gate
- [ ] Conversation branching — fork from any message into a new session
- [ ] Voice input — Web Speech API for hands-free prompting
- [ ] Chat search — search within conversation history
- [ ] Message copy as Markdown button

---

## Composer (AI Patch)

- [x] Instruction textarea
- [x] SSE streaming diff generation
- [x] Color-coded diff preview (+/- lines)
- [x] Apply button — writes to disk, reloads editor
- [x] Discard button
- [x] Current file name in header
- [ ] Multi-file composer — list target files, generate one combined patch
- [ ] Step-by-step hunk review — accept/reject each hunk individually
- [ ] Rollback — restore file to pre-patch state (one-click)
- [ ] Patch history — last 10 patches per file, revertable
- [ ] Split diff preview — original left / patched right in diff editor
- [ ] Test-driven mode — generate failing tests first, then patch to pass
- [ ] `@file` reference in instruction — auto-injects named file content
- [ ] Run tests after apply — execute configured test command, show pass/fail

---

## Context Panel

- [x] Manual BM25 context ranking with query input
- [x] Token budget progress bar
- [x] Per-chunk: file path, line range, score, token count, preview
- [x] Per-chunk inject button → pastes into chat
- [x] Inject-all button
- [x] Auto-rank on file open
- [x] `chunksPerFile` cap
- [x] `includeContent` flag
- [ ] Expand chunk to full content on click
- [ ] Pin chunks to always inject
- [ ] Exclude chunk from auto-injection
- [ ] Live view of which chunks are currently in the system prompt
- [ ] Query suggestions from current file name + LSP errors
- [ ] Vector similarity mode toggle (BM25 vs. embeddings)
- [ ] Chunk source file preview — hover to see surrounding code

---

## Models Panel

- [x] List LM Studio models
- [x] List Ollama models
- [x] List Groq free models (static)
- [x] List OpenRouter free models (static)
- [x] Provider badge (LOCAL / CLOUD / FREE)
- [x] Click to select active model
- [x] Selection persisted to localStorage
- [x] Health indicator per provider (green/amber/red dot)
- [x] Model display name + ID chip
- [ ] Model card — context window, parameters, quantization, license
- [ ] Filter models by provider, context length, or free-tier flag
- [ ] Sort by context length or name
- [ ] Favorite / pin frequently-used models (persisted)
- [ ] Pull Ollama model from UI — `ollama pull <name>` with progress SSE
- [ ] Delete Ollama model from UI
- [ ] Test model — send ping prompt, report TTFB and tokens/sec
- [ ] Benchmark view — compare TTFB across all healthy providers for same prompt
- [ ] Show token/sec for last response in status bar

---

## Settings

- [x] Settings overlay (Ctrl+,)
- [x] Basic / Advanced mode toggle
- [x] Theme selection (dark, darker, midnight)
- [x] Accent color swatches
- [x] Font size input
- [x] Font family selector
- [x] Word wrap toggle
- [x] Line numbers toggle
- [x] Auto-save toggle
- [x] Tab size selector
- [x] Scanlines effect toggle
- [x] System prompt textarea
- [x] LM Studio URL input
- [x] Ollama URL input
- [x] Groq API key input
- [x] OpenRouter API key input
- [x] Context token budget, chunks, chunks-per-file, max files
- [x] BM25 weight, chunk token target
- [x] Streaming toggle, inject file context toggle
- [x] Health poll interval, request timeout
- [x] Log level selector
- [x] Advanced flags: vector ctx, LSP diagnostics, multi-file, telemetry
- [x] Persist to `.clarity-settings.json`
- [x] Sync from server on load
- [x] Settings search bar — filter all rows by keyword
- [ ] Light theme
- [ ] High-contrast accessibility theme (WCAG AA)
- [ ] Import settings from JSON file
- [ ] Export settings to JSON file
- [ ] Keybinding editor — remap any keyboard shortcut
- [ ] Per-language settings — tab size, formatter, LSP binary path
- [ ] Profile presets — "Minimal" / "Full AI" / "Privacy Mode" / "Performance"
- [ ] Google Gemini API key input (free tier)
- [ ] Mistral API key input (free tier)
- [ ] Together AI API key input (free tier)
- [ ] Hugging Face token input (free tier)
- [ ] Format on save toggle + formatter command
- [ ] Git user name / email fields (for commits)
- [ ] Terminal shell path config

---

## Command Palette

- [x] Overlay triggered by Ctrl+K / Cmd+K
- [x] Fuzzy search over commands + file shortcuts
- [x] Arrow key navigation, Enter to select
- [x] Commands: Open settings, New session, Switch view, Rank context, Run composer
- [x] File commands: "Open: {path}" for all workspace files
- [ ] Recent files section at top when query empty
- [ ] Command history — re-run last N commands
- [ ] Custom command registration (plugin API)
- [ ] Symbol search — "Go to symbol" (`@` prefix)
- [ ] Git commands — "Git: Commit", "Git: Push", "Git: Pull"
- [ ] AI commands — "AI: Explain File", "AI: Fix Errors", "AI: Generate Tests"
- [ ] Terminal commands — "Terminal: New", "Terminal: Clear"

---

## Integrated Terminal

- [x] Terminal panel — split below editor, toggleable with Ctrl+`
- [x] xterm.js frontend renderer (full VT100/256-color/Unicode support)
- [x] WebSocket backend via `node-pty` (PTY, not just `child_process`)
- [x] Multiple terminal tabs — create, close
- [x] Shell detection — inherits `$SHELL` env var
- [x] Terminal resize — FitAddon sends resize on panel resize
- [ ] Paste from clipboard (Ctrl+Shift+V in terminal)
- [x] Clear terminal button (Ctrl+L)
- [ ] Configurable shell path, startup args, env vars in settings
- [ ] Click-to-open file paths printed in terminal
- [ ] AI command suggestions — right-click terminal output → "Explain this error"
- [ ] Run npm/cargo/python test command and stream output into a test results panel
- [ ] Split terminal panes (horizontal)

---

## LSP Integration

- [x] Scaffold `lsp-bridge` package
- [x] Diagnostics cache keyed by document version
- [x] Scaffold `indexer` package with semantic chunking
- [ ] JSON-RPC transport over stdio (connect to any LSP binary)
- [ ] `initialize` / `initialized` handshake
- [ ] `textDocument/didOpen` / `didChange` / `didClose` lifecycle
- [ ] `textDocument/publishDiagnostics` — pipe errors into editor squiggles + Problems panel
- [ ] `textDocument/hover` — popup on Ctrl+hover
- [ ] `textDocument/definition` — Ctrl+Click jump to definition
- [ ] `textDocument/references` — find all usages panel
- [ ] `textDocument/completion` — autocomplete dropdown with icons
- [ ] `textDocument/signatureHelp` — function signature tooltip
- [ ] `textDocument/rename` — F2 rename symbol workspace-wide
- [ ] `textDocument/formatting` — format on save
- [ ] `textDocument/codeAction` — lightbulb quick fixes
- [ ] `workspace/symbol` — global symbol search
- [ ] TypeScript — auto-start `typescript-language-server` (bundled in node_modules)
- [ ] Python — auto-start `pyright` (pip-installed or bundled)
- [ ] Rust — detect and connect to `rust-analyzer` binary
- [ ] Go — detect and connect to `gopls`
- [ ] HTML/CSS/JSON — built-in VS Code language servers (MIT)
- [ ] LSP server path auto-detection from PATH + common install locations
- [ ] LSP status indicator in status bar (connecting / ready / error)

---

## AI Inline Autocomplete (Ghost Text)

- [x] `/api/autocomplete` endpoint — FIM prompt for DeepSeek/StarCoder/CodeLlama; chat-model fallback
- [ ] Debounce keyup (400ms) → send cursor context to `/api/autocomplete` from editor UI
- [ ] Ghost text overlay rendered in editor (grey, after cursor)
- [ ] Tab to accept full suggestion
- [ ] Ctrl+→ to accept word-by-word
- [ ] Escape to dismiss
- [ ] Configurable: enable/disable, debounce ms, max tokens, temperature
- [ ] FIM (fill-in-the-middle) prompt format for supported models (DeepSeek, StarCoder, CodeGemma)
- [ ] Context: preceding 50 lines + following 20 lines (suffix)
- [ ] Respect LSP completion when available (prefer LSP over AI for known symbols)
- [ ] Telemetry-free — no keystrokes or completions leave the machine (local models)

---

## UI / UX Polish

- [x] Activity bar with Explorer, Search, Git, Settings buttons
- [x] Sidebar panel switching
- [x] Agent tab bar: Chat, Compose, Context, Models
- [x] Resizable sidebar and agent pane (drag splitters)
- [x] Status bar: branch, language, line count, cursor position, model name
- [x] Command palette
- [x] Keyboard shortcuts for all major actions
- [x] Lucide icon set throughout
- [x] Smooth hover transitions
- [x] CRT scanlines effect (toggleable)
- [x] Custom accent color theming via CSS variable injection
- [x] Welcome screen when no file is open (recent files + quick actions)
- [x] Notification toast system (success / error / info)
- [x] Settings search bar
- [x] Slash command autocomplete popup in chat
- [x] Export session as Markdown
- [ ] Light theme (CSS variable swap)
- [ ] High-contrast accessibility theme (WCAG AA, prefers-contrast media query)
- [ ] System-preferred color scheme detection (`prefers-color-scheme`)
- [ ] Breadcrumb navigation — file › class › function, clickable
- [ ] Loading skeleton states (instead of spinner text)
- [ ] Drag-and-drop file onto editor to open
- [ ] Zen mode — hide all panels, full-screen editor (Ctrl+Shift+Z)
- [ ] Split view layout — editor left, preview/terminal right
- [ ] Minimap toggle button in editor gutter
- [ ] Panel collapse to icon-only (ultra-narrow sidebar)
- [ ] Onboarding tour — first-run interactive highlight of key features
- [ ] "What's new" changelog popup on version bump
- [ ] Mobile / tablet responsive layout (touch-friendly panels)
- [ ] Right-to-left (RTL) language support
- [ ] Font ligatures toggle
- [ ] Tab bar scroll when many tabs open
- [ ] Tab overflow — "N more…" chip when tabs exceed width
- [ ] Unsaved dot on browser tab title
- [ ] Customizable status bar items (drag to reorder / hide)

---

## Accessibility

- [ ] Full keyboard navigation for all panels (no mouse required)
- [ ] ARIA roles and labels on all interactive elements
- [ ] Focus trap management in overlays (settings, palette, find bar)
- [ ] Screen reader announcements for streaming responses (ARIA live regions)
- [ ] High-contrast theme (WCAG AA contrast ratios)
- [ ] Reduced motion mode (`prefers-reduced-motion` — disable animations)
- [ ] Skip-to-content link
- [ ] Color-blind friendly palette option

---

## Plugin / Extension System

- [ ] Define stable plugin API surface (`clarity.editor`, `clarity.chat`, `clarity.ai`)
- [ ] Plugin loader — load ES module plugins from `plugins/` directory
- [ ] Plugin manifest (`clarity-plugin.json` — name, version, permissions)
- [ ] Editor API — register commands, keybindings, status bar items
- [ ] Chat API — register slash commands, message transforms
- [ ] AI API — register custom providers, completions
- [ ] Plugin settings UI — per-plugin settings rendered in Settings panel
- [ ] Plugin marketplace listing — curated JSON file in the repo
- [ ] Example plugin: `clarity-prettier` — format on save via Prettier
- [ ] Example plugin: `clarity-eslint` — inline ESLint diagnostics
- [ ] Example plugin: `clarity-open-in-github` — open file at commit in GitHub

---

## Desktop App (Electron)

- [x] `apps/desktop/main.js` — Electron main process: free-port finder, Node child spawn, BrowserWindow
- [x] `apps/desktop/preload.js` — context-isolated IPC bridge (`clarityDesktop.openFolder`, `getServerPort`)
- [x] `apps/desktop/package.json` — `electron` + `electron-builder` deps, full `build` config for all platforms
- [x] `Makefile` targets: `desktop-install`, `desktop-dev`, `desktop-build`, `desktop-dist`, `desktop-clean`
- [x] `--port` CLI flag + `PORT` env on `server.mjs` for Electron port injection
- [x] `CLARITY_DESKTOP=1` env var set by main process
- [x] Kill Node server cleanly on `window-all-closed` / `before-quit`
- [x] Native OS menu bar — File (Open Folder…), Edit, View (DevTools, Zoom), Help
- [x] `File › Open Folder…` — native dialog, restarts server in new workspace
- [x] External links routed to OS browser via `setWindowOpenHandler`
- [x] `waitForServer` polls `/api/health` before opening window (graceful startup)
- [ ] System tray icon with quick-launch menu
- [ ] Auto-update via `electron-updater` — check GitHub releases
- [ ] macOS code-signing + notarization
- [ ] Bundle Node.js runtime via `electron-forge` or pkg (no system Node required)
- [ ] Bundle Ollama binary for one-click AI setup (opt-in)
- [ ] Deep link handling — `clarity://open?path=...` URL scheme
- [ ] Window state persistence (size, position, maximized) via `electron-store`
- [ ] Multi-window support — open second workspace in new window
- [ ] Native notifications for long AI tasks

---

## Quality & Testing

- [ ] Unit tests for BM25 scoring and chunking (`node:test`)
- [ ] Unit tests for git porcelain parser
- [ ] Unit tests for search regex/match-range logic
- [ ] Unit tests for session trim and rolling summary
- [ ] Unit tests for SSE stream parsing (`consumeSSE`)
- [ ] Integration tests for every `/api/*` endpoint
- [ ] Integration tests with mocked SSE provider servers
- [ ] E2E browser tests with Playwright — edit → save → reload cycle
- [ ] E2E: chat send → streaming response → session persist
- [ ] E2E: composer generate → apply → file updated
- [ ] CI pipeline — typecheck + lint + tests on every push (GitHub Actions)
- [ ] CI: matrix test on Node 20 / 22, Ubuntu / macOS / Windows
- [ ] Benchmark: context rank latency for 1k-file workspace
- [ ] Benchmark: SSE time-to-first-token per provider
- [ ] Coverage report (c8) with ≥70% target
- [ ] ESLint config with `@typescript-eslint` strict rules
- [ ] Prettier enforced in CI
- [ ] `npm audit` clean (zero high/critical vulnerabilities)
- [ ] Dependabot / Renovate for dependency updates

---

## Release & Distribution

- [ ] `LICENSE` — MIT
- [ ] Define v0.2 acceptance criteria checklist (terminal + LSP + ghost text)
- [ ] Semantic versioning + conventional commits policy
- [ ] `npx clarity-ide` zero-install launcher (published to npm)
- [ ] GitHub Releases with auto-generated changelogs
- [ ] macOS `.dmg` (Tauri)
- [ ] Linux `.AppImage` + `.deb` (Tauri)
- [ ] Windows `.msi` (Tauri)
- [ ] Docker image — `ghcr.io/clarity-ide/clarity:latest` (Node + app, no Ollama)
- [ ] Homebrew formula — `brew install clarity-ide`
- [ ] AUR package for Arch Linux
- [ ] `.flatpakref` for Flatpak (Linux universal)
- [ ] `winget` package manifest
- [ ] Public landing page (`clarity-ide.dev`) — hero, demo GIF, install instructions
- [ ] Demo screencast video (< 90 seconds)
- [ ] README badges: build, version, license, npm downloads
- [ ] Open Collective / GitHub Sponsors page (100% optional — project stays free)

---

## Privacy & Security

- [ ] Audit: confirm zero telemetry in default build
- [ ] Confirm: no data leaves the machine when using local models
- [ ] Confirm: API keys stored only in `.clarity-settings.json` (gitignored by default)
- [ ] Add `.gitignore` template that excludes `.clarity-settings.json`
- [ ] Content Security Policy headers on all server responses
- [ ] Path traversal prevention audit on all `/api/file/*` endpoints (already guarded, verify)
- [ ] `SECURITY.md` with responsible disclosure policy
- [ ] Dependency supply-chain audit (only MIT/Apache-2 deps allowed)
