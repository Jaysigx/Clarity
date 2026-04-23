"use strict";

const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron");
const { spawn }      = require("child_process");
const { createServer } = require("net");
const path           = require("path");
const fs             = require("fs");
const os             = require("os");

// ── Configuration & State ──────────────────────────────────────────────────────
const CONFIG_DIR = path.join(os.homedir(), ".config", "clarity");
const RECENTS_FILE = path.join(CONFIG_DIR, "recents.json");
const MAX_RECENTS = 10;

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// ── Find a free TCP port ───────────────────────────────────────────────────────
function findFreePort(start = 3579) {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(start, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", () => {
      // port busy — try next
      findFreePort(start + 1).then(resolve).catch(reject);
    });
  });
}

// ── Resolve path to server.mjs ─────────────────────────────────────────────────
function resolveServerPath() {
  // Bundled release: extraResources copies webview/ → <resourcesPath>/webview/
  const bundled = path.join(process.resourcesPath ?? "", "webview", "server.mjs");
  if (fs.existsSync(bundled)) return bundled;

  // Dev: two levels up from apps/desktop → project root
  const dev = path.resolve(__dirname, "..", "..", "apps", "webview", "server.mjs");
  if (fs.existsSync(dev)) return dev;

  // Same-directory fallback (flat bundle)
  return path.join(__dirname, "server.mjs");
}

// ── Wait for server to be ready ────────────────────────────────────────────────
function waitForServer(port, retries = 40, interval = 250) {
  return new Promise((resolve, reject) => {
    const http = require("http");
    let attempts = 0;
    const check = () => {
      http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode < 500) resolve(port);
        else retry();
      }).on("error", retry);
    };
    const retry = () => {
      if (++attempts >= retries) return reject(new Error(`Server not ready after ${retries} attempts`));
      setTimeout(check, interval);
    };
    check();
  });
}

// ── State ──────────────────────────────────────────────────────────────────────
let mainWindow  = null;
let nodeProcess = null;
let serverPort  = 0;
let currentWorkspace = null;
let startupFileToOpen = null;

// ── Recents Management ─────────────────────────────────────────────────────────
function loadRecents() {
  try {
    if (fs.existsSync(RECENTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RECENTS_FILE, "utf8"));
      return { folders: data.folders || [], files: data.files || [] };
    }
  } catch (e) {
    console.error("[clarity] Error loading recents:", e.message);
  }
  return { folders: [], files: [] };
}

function saveRecents(recents) {
  try {
    fs.writeFileSync(RECENTS_FILE, JSON.stringify(recents, null, 2));
  } catch (e) {
    console.error("[clarity] Error saving recents:", e.message);
  }
}

function addRecentFolder(folderPath) {
  const recents = loadRecents();
  recents.folders = recents.folders.filter(p => p !== folderPath);
  recents.folders.unshift(folderPath);
  recents.folders = recents.folders.slice(0, MAX_RECENTS);
  saveRecents(recents);
  updateRecentMenu();
}

function addRecentFile(filePath) {
  const recents = loadRecents();
  recents.files = recents.files.filter(p => p !== filePath);
  recents.files.unshift(filePath);
  recents.files = recents.files.slice(0, MAX_RECENTS);
  saveRecents(recents);
  updateRecentMenu();
}

function clearRecents() {
  saveRecents({ folders: [], files: [] });
  updateRecentMenu();
}

// ── Create main window ─────────────────────────────────────────────────────────
function createWindow(port) {
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width:           1400,
    height:          900,
    minWidth:        800,
    minHeight:       600,
    title:           "Clarity IDE",
    backgroundColor: "#0a0a0f",
    // Use custom titlebar on all platforms for unified look
    frame:           false,
    titleBarStyle:   "hidden",
    // Hide native menu bar - we use custom HTML menu
    autoHideMenuBar: true,
    webPreferences: {
      preload:              path.join(__dirname, "preload.js"),
      contextIsolation:     true,
      nodeIntegration:      false,
      webSecurity:          true,
      allowRunningInsecureContent: false,
    },
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // Show once ready to avoid flash of white
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
    console.log("[clarity] Window ready - using custom titlebar");
  });

  // Open external links in the OS browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── Application menu ───────────────────────────────────────────────────────────
let recentFoldersMenu = [];
let recentFilesMenu = [];

function getRecentMenuItems() {
  const recents = loadRecents();
  const items = [];

  if (recents.folders.length > 0) {
    items.push({ label: "Recent Folders", enabled: false });
    items.push(...recents.folders.map(folder => ({
      label: path.basename(folder),
      toolTip: folder,
      click: () => restartServer(folder),
    })));
  }

  if (recents.files.length > 0) {
    if (items.length > 0) items.push({ type: "separator" });
    items.push({ label: "Recent Files", enabled: false });
    items.push(...recents.files.map(file => ({
      label: path.basename(file),
      toolTip: file,
      click: () => openFile(file),
    })));
  }

  if (items.length > 0) {
    items.push({ type: "separator" });
    items.push({
      label: "Clear Recent",
      click: () => clearRecents(),
    });
  }

  return items;
}

function updateRecentMenu() {
  buildMenu();
}

function sendToRenderer(channel, ...args) {
  mainWindow?.webContents?.send(channel, ...args);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const recentItems = getRecentMenuItems();

  const template = [
    // App Menu (macOS only)
    ...(isMac ? [{
      label: app.getName(),
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : []),

    // File Menu
    {
      label: "File",
      submenu: [
        {
          label: "New File",
          accelerator: "CmdOrCtrl+N",
          click: () => sendToRenderer("menu-new-file"),
        },
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => createNewWindow(),
        },
        { type: "separator" },
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              title: "Open Workspace Folder",
              properties: ["openDirectory"],
            });
            if (!canceled && filePaths[0]) {
              await openFolder(filePaths[0]);
            }
          },
        },
        {
          label: "Open File…",
          accelerator: "CmdOrCtrl+Shift+O",
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              title: "Open File",
              properties: ["openFile"],
              filters: [
                { name: "All Files", extensions: ["*"] },
                { name: "JavaScript/TypeScript", extensions: ["js", "ts", "jsx", "tsx", "mjs"] },
                { name: "HTML/CSS", extensions: ["html", "htm", "css", "scss", "less"] },
                { name: "JSON", extensions: ["json"] },
                { name: "Markdown", extensions: ["md", "mdx"] },
                { name: "Python", extensions: ["py", "pyw"] },
                { name: "Rust", extensions: ["rs"] },
                { name: "Go", extensions: ["go"] },
              ],
            });
            if (!canceled && filePaths[0]) {
              await openFile(filePaths[0]);
            }
          },
        },
        {
          label: "Open Recent",
          submenu: recentItems.length > 0 ? recentItems : [{ label: "No Recent Folders", enabled: false }],
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => sendToRenderer("menu-save"),
        },
        {
          label: "Save All",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => sendToRenderer("menu-save-all"),
        },
        {
          label: "Auto Save",
          type: "checkbox",
          checked: true,
          click: (item) => sendToRenderer("menu-auto-save", item.checked),
        },
        { type: "separator" },
        {
          label: "Close File",
          accelerator: "CmdOrCtrl+W",
          click: () => sendToRenderer("menu-close-file"),
        },
        {
          label: "Close All Files",
          accelerator: "CmdOrCtrl+Shift+W",
          click: () => sendToRenderer("menu-close-all"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },

    // Edit Menu
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        {
          label: "Paste As Plain Text",
          accelerator: "CmdOrCtrl+Shift+V",
          click: () => sendToRenderer("menu-paste-plain"),
        },
        { role: "selectall" },
        { type: "separator" },
        {
          label: "Find",
          accelerator: "CmdOrCtrl+F",
          click: () => sendToRenderer("menu-find"),
        },
        {
          label: "Find and Replace",
          accelerator: "CmdOrCtrl+H",
          click: () => sendToRenderer("menu-find-replace"),
        },
        {
          label: "Find Next",
          accelerator: "F3",
          click: () => sendToRenderer("menu-find-next"),
        },
        {
          label: "Find Previous",
          accelerator: "Shift+F3",
          click: () => sendToRenderer("menu-find-prev"),
        },
        { type: "separator" },
        {
          label: "Go to Line…",
          accelerator: "CmdOrCtrl+G",
          click: () => sendToRenderer("menu-goto-line"),
        },
        {
          label: "Go to File…",
          accelerator: "CmdOrCtrl+P",
          click: () => sendToRenderer("menu-goto-file"),
        },
        {
          label: "Go to Symbol…",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => sendToRenderer("menu-goto-symbol"),
        },
      ],
    },

    // Selection Menu
    {
      label: "Selection",
      submenu: [
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          click: () => sendToRenderer("menu-select-all"),
        },
        {
          label: "Select Line",
          accelerator: "CmdOrCtrl+L",
          click: () => sendToRenderer("menu-select-line"),
        },
        {
          label: "Select Word",
          accelerator: "CmdOrCtrl+D",
          click: () => sendToRenderer("menu-select-word"),
        },
        {
          label: "Select Next Occurrence",
          accelerator: "CmdOrCtrl+Shift+D",
          click: () => sendToRenderer("menu-select-next"),
        },
        { type: "separator" },
        {
          label: "Expand Selection",
          accelerator: "Shift+Alt+Right",
          click: () => sendToRenderer("menu-expand-selection"),
        },
        {
          label: "Shrink Selection",
          accelerator: "Shift+Alt+Left",
          click: () => sendToRenderer("menu-shrink-selection"),
        },
        { type: "separator" },
        {
          label: "Copy Line Up",
          accelerator: "Shift+Alt+Up",
          click: () => sendToRenderer("menu-copy-line-up"),
        },
        {
          label: "Copy Line Down",
          accelerator: "Shift+Alt+Down",
          click: () => sendToRenderer("menu-copy-line-down"),
        },
        {
          label: "Move Line Up",
          accelerator: "Alt+Up",
          click: () => sendToRenderer("menu-move-line-up"),
        },
        {
          label: "Move Line Down",
          accelerator: "Alt+Down",
          click: () => sendToRenderer("menu-move-line-down"),
        },
        { type: "separator" },
        {
          label: "Add Cursor Above",
          accelerator: "CmdOrCtrl+Alt+Up",
          click: () => sendToRenderer("menu-cursor-above"),
        },
        {
          label: "Add Cursor Below",
          accelerator: "CmdOrCtrl+Alt+Down",
          click: () => sendToRenderer("menu-cursor-below"),
        },
        {
          label: "Add Cursor to Line Ends",
          accelerator: "Shift+Alt+I",
          click: () => sendToRenderer("menu-cursor-ends"),
        },
      ],
    },

    // View Menu
    {
      label: "View",
      submenu: [
        {
          label: "Command Palette…",
          accelerator: "CmdOrCtrl+Shift+P",
          click: () => sendToRenderer("menu-command-palette"),
        },
        {
          label: "Quick Open",
          accelerator: "CmdOrCtrl+P",
          click: () => sendToRenderer("menu-quick-open"),
        },
        { type: "separator" },
        {
          label: "Explorer",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => sendToRenderer("menu-toggle-explorer"),
        },
        {
          label: "Search",
          accelerator: "CmdOrCtrl+Shift+F",
          click: () => sendToRenderer("menu-toggle-search"),
        },
        {
          label: "Source Control",
          accelerator: "CmdOrCtrl+Shift+G",
          click: () => sendToRenderer("menu-toggle-git"),
        },
        {
          label: "AI Chat",
          accelerator: "CmdOrCtrl+Shift+A",
          click: () => sendToRenderer("menu-toggle-chat"),
        },
        {
          label: "Terminal",
          accelerator: "Ctrl+`",
          click: () => sendToRenderer("menu-toggle-terminal"),
        },
        {
          label: "Problems",
          accelerator: "CmdOrCtrl+Shift+M",
          click: () => sendToRenderer("menu-toggle-problems"),
        },
        { type: "separator" },
        {
          label: "Show Welcome",
          accelerator: "CmdOrCtrl+Shift+W",
          click: () => showWelcomeScreen(),
        },
        {
          label: "Show All Commands",
          click: () => sendToRenderer("menu-show-commands"),
        },
        { type: "separator" },
        {
          label: "Appearance",
          submenu: [
            {
              label: "Zoom In",
              accelerator: "CmdOrCtrl+=",
              click: () => sendToRenderer("menu-zoom-in"),
            },
            {
              label: "Zoom Out",
              accelerator: "CmdOrCtrl+-",
              click: () => sendToRenderer("menu-zoom-out"),
            },
            {
              label: "Reset Zoom",
              accelerator: "CmdOrCtrl+0",
              click: () => sendToRenderer("menu-zoom-reset"),
            },
            { type: "separator" },
            {
              label: "Toggle Full Screen",
              accelerator: "F11",
              click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()),
            },
            {
              label: "Toggle Menu Bar",
              accelerator: "Alt",
              click: () => {
                const isVisible = mainWindow?.isMenuBarVisible() ?? true;
                mainWindow?.setMenuBarVisibility(!isVisible);
              },
            },
            { type: "separator" },
            {
              label: "Toggle Sidebar",
              accelerator: "CmdOrCtrl+B",
              click: () => sendToRenderer("menu-toggle-sidebar"),
            },
            {
              label: "Toggle AI Panel",
              accelerator: "CmdOrCtrl+J",
              click: () => sendToRenderer("menu-toggle-ai-panel"),
            },
            {
              label: "Toggle Terminal",
              accelerator: "Ctrl+`",
              click: () => sendToRenderer("menu-toggle-terminal"),
            },
            {
              label: "Toggle Status Bar",
              click: () => sendToRenderer("menu-toggle-status-bar"),
            },
            { type: "separator" },
            {
              label: "Word Wrap",
              type: "checkbox",
              checked: false,
              click: (item) => sendToRenderer("menu-word-wrap", item.checked),
            },
            {
              label: "Show Line Numbers",
              type: "checkbox",
              checked: true,
              click: (item) => sendToRenderer("menu-line-numbers", item.checked),
            },
            {
              label: "Show Minimap",
              type: "checkbox",
              checked: false,
              click: (item) => sendToRenderer("menu-minimap", item.checked),
            },
            {
              label: "Show Breadcrumbs",
              type: "checkbox",
              checked: false,
              click: (item) => sendToRenderer("menu-breadcrumbs", item.checked),
            },
            {
              label: "Render Whitespace",
              submenu: [
                { label: "None", type: "radio", checked: true, click: () => sendToRenderer("menu-whitespace", "none") },
                { label: "Boundary", type: "radio", click: () => sendToRenderer("menu-whitespace", "boundary") },
                { label: "Selection", type: "radio", click: () => sendToRenderer("menu-whitespace", "selection") },
                { label: "Trailing", type: "radio", click: () => sendToRenderer("menu-whitespace", "trailing") },
                { label: "All", type: "radio", click: () => sendToRenderer("menu-whitespace", "all") },
              ],
            },
          ],
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
      ],
    },

    // Go Menu
    {
      label: "Go",
      submenu: [
        {
          label: "Back",
          accelerator: "Alt+Left",
          click: () => sendToRenderer("menu-nav-back"),
        },
        {
          label: "Forward",
          accelerator: "Alt+Right",
          click: () => sendToRenderer("menu-nav-forward"),
        },
        {
          label: "Last Edit Location",
          accelerator: "CmdOrCtrl+K CmdOrCtrl+Q",
          click: () => sendToRenderer("menu-last-edit"),
        },
        { type: "separator" },
        {
          label: "Switch Editor",
          submenu: [
            {
              label: "Next Editor",
              accelerator: "CmdOrCtrl+Tab",
              click: () => sendToRenderer("menu-next-editor"),
            },
            {
              label: "Previous Editor",
              accelerator: "CmdOrCtrl+Shift+Tab",
              click: () => sendToRenderer("menu-prev-editor"),
            },
            {
              label: "Next Used Editor",
              accelerator: "Ctrl+PageDown",
              click: () => sendToRenderer("menu-next-used"),
            },
            {
              label: "Previous Used Editor",
              accelerator: "Ctrl+PageUp",
              click: () => sendToRenderer("menu-prev-used"),
            },
          ],
        },
        {
          label: "Switch Group",
          submenu: [
            {
              label: "Group 1",
              accelerator: "CmdOrCtrl+1",
              click: () => sendToRenderer("menu-group", 1),
            },
            {
              label: "Group 2",
              accelerator: "CmdOrCtrl+2",
              click: () => sendToRenderer("menu-group", 2),
            },
            {
              label: "Group 3",
              accelerator: "CmdOrCtrl+3",
              click: () => sendToRenderer("menu-group", 3),
            },
          ],
        },
        { type: "separator" },
        {
          label: "Go to File…",
          accelerator: "CmdOrCtrl+P",
          click: () => sendToRenderer("menu-goto-file"),
        },
        {
          label: "Go to Symbol in Workspace…",
          accelerator: "CmdOrCtrl+T",
          click: () => sendToRenderer("menu-goto-symbol-workspace"),
        },
        {
          label: "Go to Symbol in Editor…",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => sendToRenderer("menu-goto-symbol"),
        },
        {
          label: "Go to Definition",
          accelerator: "F12",
          click: () => sendToRenderer("menu-goto-def"),
        },
        {
          label: "Go to Type Definition",
          accelerator: "CmdOrCtrl+Shift+F12",
          click: () => sendToRenderer("menu-goto-type-def"),
        },
        {
          label: "Go to Implementation",
          accelerator: "CmdOrCtrl+F12",
          click: () => sendToRenderer("menu-goto-impl"),
        },
        {
          label: "Go to References",
          accelerator: "Shift+F12",
          click: () => sendToRenderer("menu-goto-refs"),
        },
        { type: "separator" },
        {
          label: "Go to Line/Column…",
          accelerator: "CmdOrCtrl+G",
          click: () => sendToRenderer("menu-goto-line"),
        },
        {
          label: "Go to Bracket",
          accelerator: "CmdOrCtrl+Shift+\\",
          click: () => sendToRenderer("menu-goto-bracket"),
        },
      ],
    },

    // Run Menu
    {
      label: "Run",
      submenu: [
        {
          label: "Start Debugging",
          accelerator: "F5",
          click: () => sendToRenderer("menu-debug-start"),
        },
        {
          label: "Run Without Debugging",
          accelerator: "Ctrl+F5",
          click: () => sendToRenderer("menu-run"),
        },
        {
          label: "Stop",
          accelerator: "Shift+F5",
          click: () => sendToRenderer("menu-stop"),
        },
        {
          label: "Restart",
          accelerator: "Ctrl+Shift+F5",
          click: () => sendToRenderer("menu-restart"),
        },
        { type: "separator" },
        {
          label: "Build",
          accelerator: "CmdOrCtrl+Shift+B",
          click: () => sendToRenderer("menu-build"),
        },
        {
          label: "Test",
          accelerator: "CmdOrCtrl+;",
          click: () => sendToRenderer("menu-test"),
        },
        { type: "separator" },
        {
          label: "AI: Explain Code",
          click: () => sendToRenderer("menu-ai-explain"),
        },
        {
          label: "AI: Fix Errors",
          click: () => sendToRenderer("menu-ai-fix"),
        },
        {
          label: "AI: Generate Tests",
          click: () => sendToRenderer("menu-ai-test"),
        },
        {
          label: "AI: Generate Docstring",
          click: () => sendToRenderer("menu-ai-docstring"),
        },
        {
          label: "AI: Improve Code",
          click: () => sendToRenderer("menu-ai-improve"),
        },
        { type: "separator" },
        {
          label: "Composer: Generate Patch",
          accelerator: "CmdOrCtrl+Shift+P",
          click: () => sendToRenderer("menu-composer"),
        },
      ],
    },

    // Terminal Menu
    {
      label: "Terminal",
      submenu: [
        {
          label: "New Terminal",
          accelerator: "Ctrl+Shift+`",
          click: () => sendToRenderer("menu-new-terminal"),
        },
        {
          label: "Split Terminal",
          click: () => sendToRenderer("menu-split-terminal"),
        },
        {
          label: "Kill Terminal",
          click: () => sendToRenderer("menu-kill-terminal"),
        },
        { type: "separator" },
        {
          label: "Focus Terminal",
          accelerator: "Ctrl+`",
          click: () => sendToRenderer("menu-focus-terminal"),
        },
        {
          label: "Focus Active Editor",
          accelerator: "CmdOrCtrl+1",
          click: () => sendToRenderer("menu-focus-editor"),
        },
        { type: "separator" },
        {
          label: "Clear Terminal",
          click: () => sendToRenderer("menu-clear-terminal"),
        },
        {
          label: "Select All in Terminal",
          click: () => sendToRenderer("menu-select-all-terminal"),
        },
        { type: "separator" },
        {
          label: "Run Selected Text in Terminal",
          accelerator: "CmdOrCtrl+Enter",
          click: () => sendToRenderer("menu-run-selected"),
        },
        {
          label: "Run Active File in Terminal",
          click: () => sendToRenderer("menu-run-file"),
        },
      ],
    },

    // Window Menu
    {
      label: "Window",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => createNewWindow(),
        },
        { type: "separator" },
        {
          label: "Minimize",
          accelerator: "CmdOrCtrl+M",
          click: () => mainWindow?.minimize(),
        },
        {
          label: "Zoom",
          click: () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize(),
        },
        { type: "separator" },
        {
          label: "Bring All to Front",
          role: isMac ? "front" : undefined,
          click: () => {
            BrowserWindow.getAllWindows().forEach(w => {
              if (!w.isVisible()) w.show();
              w.focus();
            });
          },
        },
        ...(isMac ? [
          { type: "separator" },
          { role: "window" }
        ] : []),
      ],
    },

    // Help Menu
    {
      role: "help",
      submenu: [
        {
          label: "Welcome",
          click: () => showWelcomeScreen(),
        },
        {
          label: "Show All Commands",
          accelerator: "CmdOrCtrl+Shift+P",
          click: () => sendToRenderer("menu-command-palette"),
        },
        {
          label: "Documentation",
          accelerator: "F1",
          click: () => shell.openExternal("https://github.com/clarity-ide/clarity#readme"),
        },
        {
          label: "Keyboard Shortcuts Reference",
          accelerator: "CmdOrCtrl+K CmdOrCtrl+R",
          click: () => sendToRenderer("menu-keyboard-ref"),
        },
        {
          label: "Command Palette",
          accelerator: "CmdOrCtrl+Shift+P",
          click: () => sendToRenderer("menu-command-palette"),
        },
        { type: "separator" },
        {
          label: "AI: Ask a Question…",
          accelerator: "CmdOrCtrl+Shift+A",
          click: () => sendToRenderer("menu-ai-ask"),
        },
        {
          label: "AI: Show Context Panel",
          click: () => sendToRenderer("menu-toggle-context"),
        },
        { type: "separator" },
        {
          label: "Check for Updates",
          click: () => sendToRenderer("menu-check-update"),
        },
        {
          label: "Release Notes",
          click: () => shell.openExternal("https://github.com/clarity-ide/clarity/releases"),
        },
        { type: "separator" },
        {
          label: "Report Issue",
          click: () => shell.openExternal("https://github.com/clarity-ide/clarity/issues/new"),
        },
        {
          label: "View License",
          click: () => shell.openExternal("https://github.com/clarity-ide/clarity/blob/main/LICENSE"),
        },
        {
          label: "Privacy Statement",
          click: () => shell.openExternal("https://github.com/clarity-ide/clarity/blob/main/PRIVACY.md"),
        },
        { type: "separator" },
        {
          label: "Toggle Developer Tools",
          accelerator: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I",
          click: () => mainWindow?.webContents?.toggleDevTools(),
        },
        {
          label: "Open Process Explorer",
          click: () => sendToRenderer("menu-process-explorer"),
        },
        { type: "separator" },
        {
          label: "About Clarity IDE",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About Clarity IDE",
              message: "Clarity IDE",
              detail: `Version: ${app.getVersion() || "0.2.0"}\nElectron: ${process.versions.electron}\nNode.js: ${process.versions.node}\nChrome: ${process.versions.chrome}`,
              buttons: ["OK"],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Workspace & File Operations ──────────────────────────────────────────────
async function openFolder(folderPath) {
  if (!fs.existsSync(folderPath)) {
    dialog.showErrorBox("Error", `Folder not found: ${folderPath}`);
    return;
  }
  currentWorkspace = folderPath;
  addRecentFolder(folderPath);
  await restartServer(folderPath);
}

async function openFile(filePath) {
  if (!fs.existsSync(filePath)) {
    dialog.showErrorBox("Error", `File not found: ${filePath}`);
    return;
  }
  addRecentFile(filePath);

  // If no workspace is open, open the file's parent folder as workspace
  const parentDir = path.dirname(filePath);
  if (!currentWorkspace || !fs.existsSync(currentWorkspace)) {
    currentWorkspace = parentDir;
    await restartServer(parentDir);
  }

  // Notify the renderer to open the specific file
  mainWindow?.webContents?.send("open-file", filePath);
}

function showWelcomeScreen() {
  currentWorkspace = null;
  mainWindow?.webContents?.send("show-welcome");
}

async function createNewWindow() {
  const recents = loadRecents();
  const lastFolder = recents.folders[0];
  const port = await startServer(lastFolder);
  createWindow(port);
}

// ── Start / restart Node server ────────────────────────────────────────────────
async function startServer(workspaceRoot) {
  const serverPath = resolveServerPath();
  const port       = await findFreePort(3579);
  serverPort       = port;

  // Pass workspace info to server
  const env = {
    ...process.env,
    PORT: String(port),
    CLARITY_DESKTOP: "1",
    CLARITY_WORKSPACE: workspaceRoot || "",
  };

  nodeProcess = spawn("node", [serverPath, "--port", String(port)], {
    cwd:   workspaceRoot ?? (process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  nodeProcess.stdout?.on("data", (d) => process.stdout.write(`[server] ${d}`));
  nodeProcess.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));

  nodeProcess.on("exit", (code) => {
    console.log(`[clarity] server exited with code ${code}`);
  });

  try {
    await waitForServer(port);
    console.log(`[clarity] server ready on port ${port}`);
  } catch (err) {
    console.error("[clarity] server failed to start:", err.message);
  }

  return port;
}

async function restartServer(workspaceRoot) {
  if (nodeProcess) { nodeProcess.kill(); nodeProcess = null; }
  const port = await startServer(workspaceRoot);
  // Use loadURL with a query param to indicate workspace
  const url = workspaceRoot
    ? `http://127.0.0.1:${port}?workspace=${encodeURIComponent(workspaceRoot)}`
    : `http://127.0.0.1:${port}`;
  mainWindow?.loadURL(url);
}

// ── IPC handlers ───────────────────────────────────────────────────────────────
ipcMain.handle("get-server-port", () => serverPort);
ipcMain.on("titlebar-minimize",  () => mainWindow?.minimize());
ipcMain.on("titlebar-maximize",  () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on("titlebar-close",     () => mainWindow?.close());
ipcMain.handle("titlebar-is-maximized", () => mainWindow?.isMaximized() ?? false);

ipcMain.handle("open-folder-dialog", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Open Workspace Folder",
    properties: ["openDirectory"],
  });
  if (!canceled && filePaths[0]) {
    await openFolder(filePaths[0]);
    return filePaths[0];
  }
  return null;
});

ipcMain.handle("open-file-dialog", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Open File",
    properties: ["openFile"],
    filters: [
      { name: "All Files", extensions: ["*"] },
      { name: "JavaScript/TypeScript", extensions: ["js", "ts", "jsx", "tsx", "mjs"] },
      { name: "HTML/CSS", extensions: ["html", "htm", "css", "scss", "less"] },
      { name: "JSON", extensions: ["json"] },
      { name: "Markdown", extensions: ["md", "mdx"] },
      { name: "Python", extensions: ["py", "pyw"] },
    ],
  });
  if (!canceled && filePaths[0]) {
    await openFile(filePaths[0]);
    return filePaths[0];
  }
  return null;
});

ipcMain.handle("get-recents", () => loadRecents());

ipcMain.handle("get-workspace", () => currentWorkspace);

ipcMain.handle("get-startup-file", () => {
  const file = startupFileToOpen;
  startupFileToOpen = null; // Clear after retrieval
  return file;
});

ipcMain.handle("clear-recents", () => {
  clearRecents();
});

// ── CLI & Startup File Handling ──────────────────────────────────────────────
function processCLIArgs() {
  const args = process.argv.slice(1); // Skip executable

  // Filter out Electron-specific args
  const cleanArgs = args.filter(arg =>
    !arg.startsWith("--") &&
    !arg.includes("electron") &&
    arg !== "."
  );

  if (cleanArgs.length > 0) {
    const target = path.resolve(cleanArgs[0]);
    if (fs.existsSync(target)) {
      const stats = fs.statSync(target);
      if (stats.isDirectory()) {
        return { type: "folder", path: target };
      } else if (stats.isFile()) {
        return { type: "file", path: target };
      }
    }
  }
  return null;
}

// ── Drag & Drop Handling ───────────────────────────────────────────────────────
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    openFile(filePath);
  } else {
    startupFileToOpen = filePath;
  }
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  // Handle clarity:// protocol if needed
  console.log("[clarity] Open URL:", url);
});

// ── App lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  console.log("[clarity] Building application menu...");
  buildMenu();
  console.log("[clarity] Menu set, platform:", process.platform);

  // Process CLI arguments
  const cliTarget = processCLIArgs();

  if (cliTarget?.type === "folder") {
    currentWorkspace = cliTarget.path;
    const port = await startServer(cliTarget.path);
    createWindow(port);
    addRecentFolder(cliTarget.path);
  } else if (cliTarget?.type === "file") {
    const parentDir = path.dirname(cliTarget.path);
    currentWorkspace = parentDir;
    startupFileToOpen = cliTarget.path;
    const port = await startServer(parentDir);
    createWindow(port);
    addRecentFile(cliTarget.path);
  } else {
    // No CLI args - start with default/home or show welcome
    const recents = loadRecents();
    const lastFolder = recents.folders[0];
    const port = await startServer(lastFolder);
    createWindow(port);
  }

  app.on("activate", () => {
    // macOS: re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
      const recents = loadRecents();
      const lastFolder = recents.folders[0];
      startServer(lastFolder).then(port => createWindow(port));
    }
  });
});

app.on("window-all-closed", () => {
  if (nodeProcess) { nodeProcess.kill(); nodeProcess = null; }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (nodeProcess) { nodeProcess.kill(); nodeProcess = null; }
});
