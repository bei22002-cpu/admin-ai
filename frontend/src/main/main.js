/**
 * MCP Grid - Electron Main Process
 * TRON-themed AI Desktop Assistant
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  nativeImage,
  Notification,
  ipcMain,
} = require("electron");
const path = require("path");
const Store = require("electron-store");

const store = new Store({
  defaults: {
    phase: 1,
    backendUrl: "http://localhost:1337",
    theme: "tron",
    voiceEnabled: true,
    startOnLogin: true,
  },
});

let mainWindow = null;
let quickInputWindow = null;
let tray = null;

const BACKEND_URL = store.get("backendUrl");

// ─── Create Main Chat Window ────────────────────────────────────

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: getTrayIcon(),
    title: "MCP Grid",
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("close", (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

// ─── Create Quick Input Popup ───────────────────────────────────

function createQuickInput() {
  if (quickInputWindow && !quickInputWindow.isDestroyed()) {
    quickInputWindow.show();
    quickInputWindow.focus();
    return;
  }

  quickInputWindow = new BrowserWindow({
    width: 600,
    height: 80,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  quickInputWindow.loadFile(
    path.join(__dirname, "..", "renderer", "quick-input.html")
  );

  quickInputWindow.once("ready-to-show", () => {
    quickInputWindow.center();
    quickInputWindow.show();
    quickInputWindow.focus();
  });

  quickInputWindow.on("blur", () => {
    if (quickInputWindow && !quickInputWindow.isDestroyed()) {
      quickInputWindow.hide();
    }
  });
}

// ─── System Tray ────────────────────────────────────────────────

function getTrayIcon() {
  // Create a simple MCP icon programmatically
  const iconSize = 22;
  const canvas = nativeImage.createEmpty();

  // Use a built-in icon as fallback
  const iconPath = path.join(__dirname, "..", "..", "assets", "tray-icon.png");
  try {
    return nativeImage.createFromPath(iconPath).resize({
      width: iconSize,
      height: iconSize,
    });
  } catch {
    return canvas;
  }
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip("MCP Grid - Online");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "MCP Grid",
      enabled: false,
      icon: getTrayIcon(),
    },
    { type: "separator" },
    {
      label: "Open MCP Console",
      accelerator: "CmdOrCtrl+Shift+Space",
      click: () => createMainWindow(),
    },
    {
      label: "Quick Command",
      accelerator: "CmdOrCtrl+Space",
      click: () => createQuickInput(),
    },
    { type: "separator" },
    {
      label: "MCP code",
      click: () => sendCommand("code", ""),
    },
    {
      label: "MCP search",
      click: () => sendCommand("search", ""),
    },
    {
      label: "MCP scan",
      click: () => sendCommand("scan", ""),
    },
    {
      label: "MCP report status",
      click: () => sendCommand("report", "status"),
    },
    { type: "separator" },
    {
      label: `Phase: ${store.get("phase")}`,
      enabled: false,
    },
    {
      label: "Assimilate Next Phase",
      click: () => assimilatePhase(),
    },
    { type: "separator" },
    {
      label: "Quit MCP",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    createMainWindow();
  });
}

// ─── Global Hotkeys ─────────────────────────────────────────────

function registerHotkeys() {
  // Ctrl+Space → Quick text input popup
  globalShortcut.register("CommandOrControl+Space", () => {
    createQuickInput();
  });

  // Ctrl+Shift+Space → Full chat window
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    createMainWindow();
  });
}

// ─── Backend Communication ──────────────────────────────────────

async function sendCommand(command, args) {
  try {
    const fetch = require("node-fetch");
    const response = await fetch(`${BACKEND_URL}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, args }),
    });
    const data = await response.json();

    // Show notification
    showNotification(data.tron_quote || "Command executed.", data.message);

    // Send to renderer if window is open
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("command-response", data);
    }

    return data;
  } catch (error) {
    showNotification("MCP Error", `Backend connection failed: ${error.message}`);
    return { status: "error", message: error.message };
  }
}

async function assimilatePhase() {
  const currentPhase = store.get("phase");
  const nextPhase = Math.min(currentPhase + 1, 4);

  try {
    const fetch = require("node-fetch");
    const response = await fetch(`${BACKEND_URL}/phase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase: nextPhase }),
    });
    const data = await response.json();
    store.set("phase", nextPhase);
    showNotification(
      "Phase Assimilation",
      `Phase ${nextPhase} assimilated. New capabilities unlocked.`
    );
    createTray(); // Rebuild tray menu
    return data;
  } catch (error) {
    showNotification("MCP Error", `Phase assimilation failed: ${error.message}`);
  }
}

// ─── Notifications ──────────────────────────────────────────────

function showNotification(title, body) {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: `MCP: ${title}`,
      body: body,
      icon: getTrayIcon(),
      silent: false,
    });
    notification.show();
  }
}

// ─── IPC Handlers ───────────────────────────────────────────────

ipcMain.handle("send-command", async (event, command, args) => {
  return await sendCommand(command, args);
});

ipcMain.handle("get-config", () => {
  return {
    phase: store.get("phase"),
    backendUrl: store.get("backendUrl"),
    theme: store.get("theme"),
    voiceEnabled: store.get("voiceEnabled"),
  };
});

ipcMain.handle("set-config", (event, key, value) => {
  store.set(key, value);
  return true;
});

ipcMain.handle("close-quick-input", () => {
  if (quickInputWindow && !quickInputWindow.isDestroyed()) {
    quickInputWindow.hide();
  }
});

ipcMain.handle("close-window", () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.hide();
});

ipcMain.handle("minimize-window", () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});

// ─── App Lifecycle ──────────────────────────────────────────────

app.whenReady().then(() => {
  createTray();
  registerHotkeys();
  createMainWindow();

  console.log("╔══════════════════════════════════════════╗");
  console.log("║       MCP GRID - ELECTRON ONLINE         ║");
  console.log("║       Ctrl+Space: Quick Command           ║");
  console.log("║       Ctrl+Shift+Space: Console           ║");
  console.log("╚══════════════════════════════════════════╝");
});

app.on("window-all-closed", (e) => {
  // Don't quit - keep in tray
  e?.preventDefault?.();
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("activate", () => {
  createMainWindow();
});

// Auto-start on login
if (store.get("startOnLogin")) {
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
  });
}
