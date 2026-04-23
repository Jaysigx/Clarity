"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Menu event handler registry
const menuHandlers = new Map();

// Subscribe to all menu events from main process
const menuChannels = [
  // File menu
  "menu-new-file", "menu-save", "menu-save-all", "menu-auto-save",
  "menu-close-file", "menu-close-all",
  // Edit menu
  "menu-find", "menu-find-replace", "menu-find-next", "menu-find-prev",
  "menu-goto-line", "menu-goto-file", "menu-goto-symbol",
  "menu-paste-plain", "menu-select-all",
  // Selection menu
  "menu-select-line", "menu-select-word", "menu-select-next",
  "menu-expand-selection", "menu-shrink-selection",
  "menu-copy-line-up", "menu-copy-line-down", "menu-move-line-up", "menu-move-line-down",
  "menu-cursor-above", "menu-cursor-below", "menu-cursor-ends",
  // View menu
  "menu-command-palette", "menu-quick-open",
  "menu-toggle-explorer", "menu-toggle-search", "menu-toggle-git",
  "menu-toggle-chat", "menu-toggle-terminal", "menu-toggle-problems",
  "menu-show-commands", "menu-toggle-sidebar", "menu-toggle-ai-panel",
  "menu-toggle-status-bar", "menu-zoom-in", "menu-zoom-out", "menu-zoom-reset",
  "menu-word-wrap", "menu-line-numbers", "menu-minimap", "menu-breadcrumbs", "menu-whitespace",
  // Go menu
  "menu-nav-back", "menu-nav-forward", "menu-last-edit",
  "menu-next-editor", "menu-prev-editor", "menu-next-used", "menu-prev-used",
  "menu-group", "menu-goto-symbol-workspace", "menu-goto-def", "menu-goto-type-def",
  "menu-goto-impl", "menu-goto-refs", "menu-goto-bracket",
  // Run menu
  "menu-debug-start", "menu-run", "menu-stop", "menu-restart",
  "menu-build", "menu-test",
  "menu-ai-explain", "menu-ai-fix", "menu-ai-test", "menu-ai-docstring", "menu-ai-improve",
  "menu-composer",
  // Terminal menu
  "menu-new-terminal", "menu-split-terminal", "menu-kill-terminal",
  "menu-focus-terminal", "menu-focus-editor",
  "menu-clear-terminal", "menu-select-all-terminal",
  "menu-run-selected", "menu-run-file",
  // Help menu
  "menu-ai-ask", "menu-toggle-context", "menu-check-update",
  "menu-keyboard-ref", "menu-process-explorer",
  // Welcome
  "show-welcome", "open-file",
];

// Register all menu channels
menuChannels.forEach(channel => {
  ipcRenderer.on(channel, (_event, ...args) => {
    const handlers = menuHandlers.get(channel);
    if (handlers) {
      handlers.forEach(cb => cb(...args));
    }
  });
});

// Expose a minimal, safe API to the renderer (the webview served from server.mjs).
// The renderer runs in a browser context with contextIsolation=true, so it cannot
// access Node APIs directly — only what is explicitly bridged here.
contextBridge.exposeInMainWorld("clarityDesktop", {
  /** Returns the TCP port the embedded Node server is listening on. */
  getServerPort: () => ipcRenderer.invoke("get-server-port"),

  /** Opens a native folder picker and restarts the server in the chosen directory. */
  openFolder: () => ipcRenderer.invoke("open-folder-dialog"),

  /** Opens a native file picker and opens the selected file. */
  openFile: () => ipcRenderer.invoke("open-file-dialog"),

  /** Returns the list of recent folders and files. */
  getRecents: () => ipcRenderer.invoke("get-recents"),

  /** Clears the recent files and folders list. */
  clearRecents: () => ipcRenderer.invoke("clear-recents"),

  /** Returns the current workspace path or null. */
  getWorkspace: () => ipcRenderer.invoke("get-workspace"),

  /** Returns any file to open on startup (from CLI), then clears it. */
  getStartupFile: () => ipcRenderer.invoke("get-startup-file"),

  /** Subscribe to file open events from main process. */
  onOpenFile: (callback) => {
    const wrapped = (_event, filePath) => callback(filePath);
    ipcRenderer.on("open-file", wrapped);
    return () => ipcRenderer.removeListener("open-file", wrapped);
  },

  /** Subscribe to show-welcome events from main process. */
  onShowWelcome: (callback) => {
    const wrapped = () => callback();
    ipcRenderer.on("show-welcome", wrapped);
    return () => ipcRenderer.removeListener("show-welcome", wrapped);
  },

  /** Subscribe to menu events from main process. */
  onMenuEvent: (channel, callback) => {
    if (!menuHandlers.has(channel)) {
      menuHandlers.set(channel, new Set());
    }
    menuHandlers.get(channel).add(callback);
    return () => menuHandlers.get(channel).delete(callback);
  },

  /** Titlebar window controls */
  minimize:     () => ipcRenderer.send("titlebar-minimize"),
  maximize:     () => ipcRenderer.send("titlebar-maximize"),
  close:        () => ipcRenderer.send("titlebar-close"),
  isMaximized:  () => ipcRenderer.invoke("titlebar-is-maximized"),

  /** True when running inside the Electron shell. */
  isDesktop: true,

  /** List of available menu channels for subscription */
  menuChannels: menuChannels,
});
