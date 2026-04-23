"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Expose a minimal, safe API to the renderer (the webview served from server.mjs).
// The renderer runs in a browser context with contextIsolation=true, so it cannot
// access Node APIs directly — only what is explicitly bridged here.
contextBridge.exposeInMainWorld("clarityDesktop", {
  /** Returns the TCP port the embedded Node server is listening on. */
  getServerPort: () => ipcRenderer.invoke("get-server-port"),

  /** Opens a native folder picker and restarts the server in the chosen directory. */
  openFolder: () => ipcRenderer.invoke("open-folder-dialog"),

  /** True when running inside the Electron shell. */
  isDesktop: true,
});
