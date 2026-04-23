"use strict";

const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron");
const { spawn }      = require("child_process");
const { createServer } = require("net");
const path           = require("path");
const fs             = require("fs");

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

// ── Create main window ─────────────────────────────────────────────────────────
function createWindow(port) {
  mainWindow = new BrowserWindow({
    width:         1400,
    height:        900,
    minWidth:      800,
    minHeight:     600,
    title:         "Clarity IDE",
    backgroundColor: "#0a0a0f",
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
function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              title: "Open Workspace Folder",
              properties: ["openDirectory"],
            });
            if (!canceled && filePaths[0]) {
              // Restart server with new workspace root
              restartServer(filePaths[0]);
            }
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "GitHub Repository",
          click: () => shell.openExternal("https://github.com/clarity-ide/clarity"),
        },
        {
          label: "Report an Issue",
          click: () => shell.openExternal("https://github.com/clarity-ide/clarity/issues"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Start / restart Node server ────────────────────────────────────────────────
async function startServer(workspaceRoot) {
  const serverPath = resolveServerPath();
  const port       = await findFreePort(3579);
  serverPort       = port;

  nodeProcess = spawn("node", [serverPath, "--port", String(port)], {
    cwd:   workspaceRoot ?? (process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME),
    env:   { ...process.env, PORT: String(port), CLARITY_DESKTOP: "1" },
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
  mainWindow?.loadURL(`http://127.0.0.1:${port}`);
}

// ── IPC handlers ───────────────────────────────────────────────────────────────
ipcMain.handle("get-server-port", () => serverPort);

ipcMain.handle("open-folder-dialog", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Open Workspace Folder",
    properties: ["openDirectory"],
  });
  if (!canceled && filePaths[0]) {
    await restartServer(filePaths[0]);
    return filePaths[0];
  }
  return null;
});

// ── App lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  buildMenu();

  const port = await startServer();
  createWindow(port);

  app.on("activate", () => {
    // macOS: re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) createWindow(serverPort);
  });
});

app.on("window-all-closed", () => {
  if (nodeProcess) { nodeProcess.kill(); nodeProcess = null; }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (nodeProcess) { nodeProcess.kill(); nodeProcess = null; }
});
