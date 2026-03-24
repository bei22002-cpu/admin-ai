/**
 * MCP Grid - Electron Main Process
 * TRON-themed AI Desktop Assistant with Screen Vision
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
  desktopCapturer,
  screen,
} = require("electron");
const path = require("path");
const Store = require("electron-store");

const store = new Store({
  defaults: {
    phase: 1,
    backendUrl: "http://127.0.0.1:1337",
    theme: "tron",
    voiceEnabled: true,
    startOnLogin: true,
    visionEnabled: true,
    monitoringEnabled: false,
    monitoringInterval: 10,
    overlayPosition: { x: -1, y: -1 },
    overlayVisible: false,
  },
});

let mainWindow = null;
let quickInputWindow = null;
let overlayWindow = null;
let tray = null;
let monitoringTimer = null;

const BACKEND_URL = store.get("backendUrl");

// --- Create Main Chat Window ---

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
  mainWindow.once("ready-to-show", function () { mainWindow.show(); });
  mainWindow.on("close", function (e) { e.preventDefault(); mainWindow.hide(); });
}

// --- Create Quick Input Popup ---

function createQuickInput() {
  if (quickInputWindow && !quickInputWindow.isDestroyed()) {
    quickInputWindow.show();
    quickInputWindow.focus();
    return;
  }

  quickInputWindow = new BrowserWindow({
    width: 600, height: 80, frame: false, transparent: true,
    backgroundColor: "#00000000", alwaysOnTop: true, skipTaskbar: true, resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true, nodeIntegration: false,
    },
    show: false,
  });

  quickInputWindow.loadFile(path.join(__dirname, "..", "renderer", "quick-input.html"));
  quickInputWindow.once("ready-to-show", function () {
    quickInputWindow.center(); quickInputWindow.show(); quickInputWindow.focus();
  });
  quickInputWindow.on("blur", function () {
    if (quickInputWindow && !quickInputWindow.isDestroyed()) quickInputWindow.hide();
  });
}

// --- Create Floating Overlay Window ---

function createOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show(); overlayWindow.focus(); return;
  }

  var display = screen.getPrimaryDisplay();
  var workArea = display.workAreaSize;
  var savedPos = store.get("overlayPosition");
  var posX = savedPos.x >= 0 ? savedPos.x : workArea.width - 380;
  var posY = savedPos.y >= 0 ? savedPos.y : workArea.height - 520;

  overlayWindow = new BrowserWindow({
    width: 360, height: 500, x: posX, y: posY,
    frame: false, transparent: true, backgroundColor: "#00000000",
    alwaysOnTop: true, skipTaskbar: true, resizable: true,
    minimizable: false, maximizable: false, hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true, nodeIntegration: false,
    },
    show: false,
  });

  overlayWindow.loadFile(path.join(__dirname, "..", "renderer", "overlay.html"));
  overlayWindow.once("ready-to-show", function () {
    overlayWindow.show(); store.set("overlayVisible", true);
  });
  overlayWindow.on("moved", function () {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      var bounds = overlayWindow.getBounds();
      store.set("overlayPosition", { x: bounds.x, y: bounds.y });
    }
  });
  overlayWindow.on("closed", function () {
    overlayWindow = null; store.set("overlayVisible", false);
  });
}

function toggleOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (overlayWindow.isVisible()) {
      overlayWindow.hide(); store.set("overlayVisible", false);
    } else {
      overlayWindow.show(); store.set("overlayVisible", true);
    }
  } else { createOverlay(); }
}

// --- Screen Capture ---

async function captureScreen() {
  try {
    var sources = await desktopCapturer.getSources({
      types: ["screen"], thumbnailSize: { width: 1920, height: 1080 },
    });
    if (sources.length === 0) return null;

    var primarySource = sources[0];
    var thumbnail = primarySource.thumbnail;
    var pngBuffer = thumbnail.toPNG();

    return {
      base64: pngBuffer.toString("base64"),
      size: pngBuffer.length,
      width: thumbnail.getSize().width,
      height: thumbnail.getSize().height,
      source: primarySource.name,
    };
  } catch (error) {
    console.error("Screen capture failed:", error);
    return null;
  }
}

async function captureActiveWindow() {
  try {
    var sources = await desktopCapturer.getSources({
      types: ["window"], thumbnailSize: { width: 1920, height: 1080 },
    });
    if (sources.length === 0) return null;

    var filteredSources = sources.filter(function (s) {
      return !s.name.includes("MCP Grid") && !s.name.includes("Overlay") && s.name !== "";
    });

    var activeSource = filteredSources[0] || sources[0];
    var thumbnail = activeSource.thumbnail;
    var pngBuffer = thumbnail.toPNG();

    return {
      base64: pngBuffer.toString("base64"),
      size: pngBuffer.length,
      width: thumbnail.getSize().width,
      height: thumbnail.getSize().height,
      source: activeSource.name,
      windowName: activeSource.name,
    };
  } catch (error) {
    console.error("Window capture failed:", error);
    return null;
  }
}

// --- Vision Analysis ---

async function analyzeScreen(prompt) {
  var capture = await captureScreen();
  if (!capture) {
    return { status: "error", message: "Screen capture failed. No displays found." };
  }

  try {
    var fetch = require("node-fetch");
    var response = await fetch(BACKEND_URL + "/vision/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: capture.base64, prompt: prompt || "", include_context: true,
      }),
    });
    var data = await response.json();
    var captureInfo = { width: capture.width, height: capture.height, source: capture.source };

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("vision-result", Object.assign({}, data, { capture: captureInfo }));
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("vision-result", Object.assign({}, data, { capture: captureInfo }));
    }
    return data;
  } catch (error) {
    return { status: "error", message: "Vision analysis failed: " + error.message };
  }
}

async function ocrScreen() {
  var capture = await captureScreen();
  if (!capture) return { status: "error", message: "Screen capture failed." };

  try {
    var fetch = require("node-fetch");
    var response = await fetch(BACKEND_URL + "/vision/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: capture.base64 }),
    });
    return await response.json();
  } catch (error) {
    return { status: "error", message: "OCR failed: " + error.message };
  }
}

// --- Continuous Monitoring ---

function startMonitoring(intervalSec) {
  stopMonitoring();
  var seconds = Math.max(5, Math.min(300, intervalSec || 10));
  store.set("monitoringEnabled", true);
  store.set("monitoringInterval", seconds);

  monitoringTimer = setInterval(async function () {
    var result = await analyzeScreen("Brief status update: what changed on screen?");
    if (result.status === "success" && overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("monitoring-update", result);
    }
  }, seconds * 1000);

  console.log("[MCP Vision] Monitoring started: every " + seconds + "s");
  return { status: "success", message: "Monitoring started: every " + seconds + "s" };
}

function stopMonitoring() {
  if (monitoringTimer) { clearInterval(monitoringTimer); monitoringTimer = null; }
  store.set("monitoringEnabled", false);
  return { status: "success", message: "Monitoring stopped" };
}

// --- System Tray ---

function getTrayIcon() {
  var iconSize = 22;
  var canvas = nativeImage.createEmpty();
  var iconPath = path.join(__dirname, "..", "..", "assets", "tray-icon.png");
  try {
    return nativeImage.createFromPath(iconPath).resize({ width: iconSize, height: iconSize });
  } catch (e) { return canvas; }
}

function createTray() {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = new Tray(getTrayIcon());
  tray.setToolTip("MCP Grid - Desktop Assistant Online");

  var contextMenu = Menu.buildFromTemplate([
    { label: "MCP Grid - Desktop Assistant", enabled: false, icon: getTrayIcon() },
    { type: "separator" },
    { label: "Open MCP Console", accelerator: "CmdOrCtrl+Shift+Space", click: function () { createMainWindow(); } },
    { label: "Quick Command", accelerator: "CmdOrCtrl+Space", click: function () { createQuickInput(); } },
    { type: "separator" },
    {
      label: "Vision Assistant",
      submenu: [
        { label: "Toggle Overlay", accelerator: "CmdOrCtrl+Shift+O", click: function () { toggleOverlay(); } },
        { label: "Analyze Screen Now", accelerator: "CmdOrCtrl+Shift+V", click: function () { analyzeScreen(); } },
        { label: "Extract Screen Text (OCR)", accelerator: "CmdOrCtrl+Shift+T", click: function () { ocrScreen(); } },
        { type: "separator" },
        {
          label: store.get("monitoringEnabled") ? "Stop Monitoring" : "Start Monitoring",
          click: function () {
            if (store.get("monitoringEnabled")) stopMonitoring();
            else startMonitoring(store.get("monitoringInterval"));
            createTray();
          },
        },
      ],
    },
    { type: "separator" },
    { label: "MCP code", click: function () { sendCommand("code", ""); } },
    { label: "MCP search", click: function () { sendCommand("search", ""); } },
    { label: "MCP scan", click: function () { sendCommand("scan", ""); } },
    { label: "MCP report status", click: function () { sendCommand("report", "status"); } },
    { type: "separator" },
    { label: "Phase: " + store.get("phase"), enabled: false },
    { label: "Assimilate Next Phase", click: function () { assimilatePhase(); } },
    { type: "separator" },
    { label: "Quit MCP", click: function () { stopMonitoring(); app.isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("click", function () { createMainWindow(); });
}

// --- Global Hotkeys ---

function registerHotkeys() {
  globalShortcut.register("CommandOrControl+Space", function () { createQuickInput(); });
  globalShortcut.register("CommandOrControl+Shift+Space", function () { createMainWindow(); });

  globalShortcut.register("CommandOrControl+Shift+V", function () {
    analyzeScreen().then(function (result) {
      if (result.status === "success") {
        showNotification("Screen Analysis", result.analysis ? result.analysis.substring(0, 200) + "..." : "Analysis complete.");
      } else {
        showNotification("Vision Error", result.message || "Analysis failed.");
      }
    });
  });

  globalShortcut.register("CommandOrControl+Shift+O", function () { toggleOverlay(); });

  globalShortcut.register("CommandOrControl+Shift+T", function () {
    ocrScreen().then(function (result) {
      if (result.status === "success") {
        showNotification("Text Extracted", result.text ? result.text.substring(0, 200) + "..." : "No text found.");
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send("ocr-result", result);
        }
      }
    });
  });
}

// --- Backend Communication ---

async function sendCommand(command, args) {
  try {
    var fetch = require("node-fetch");
    var response = await fetch(BACKEND_URL + "/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: command, args: args }),
    });
    var data = await response.json();
    showNotification(data.tron_quote || "Command executed.", data.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("command-response", data);
    }
    return data;
  } catch (error) {
    showNotification("MCP Error", "Backend connection failed: " + error.message);
    return { status: "error", message: error.message };
  }
}

async function assimilatePhase() {
  var currentPhase = store.get("phase");
  var nextPhase = Math.min(currentPhase + 1, 4);
  try {
    var fetch = require("node-fetch");
    var response = await fetch(BACKEND_URL + "/phase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase: nextPhase }),
    });
    var data = await response.json();
    store.set("phase", nextPhase);
    showNotification("Phase Assimilation", "Phase " + nextPhase + " assimilated.");
    createTray();
    return data;
  } catch (error) {
    showNotification("MCP Error", "Phase assimilation failed: " + error.message);
  }
}

// --- Notifications ---

function showNotification(title, body) {
  if (Notification.isSupported()) {
    var notification = new Notification({
      title: "MCP: " + title, body: body, icon: getTrayIcon(), silent: false,
    });
    notification.show();
  }
}

// --- IPC Handlers ---

ipcMain.handle("send-command", async function (event, command, args) {
  return await sendCommand(command, args);
});

ipcMain.handle("get-config", function () {
  return {
    phase: store.get("phase"), backendUrl: store.get("backendUrl"),
    theme: store.get("theme"), voiceEnabled: store.get("voiceEnabled"),
    visionEnabled: store.get("visionEnabled"), monitoringEnabled: store.get("monitoringEnabled"),
    monitoringInterval: store.get("monitoringInterval"), overlayVisible: store.get("overlayVisible"),
  };
});

ipcMain.handle("set-config", function (event, key, value) { store.set(key, value); return true; });
ipcMain.handle("close-quick-input", function () { if (quickInputWindow && !quickInputWindow.isDestroyed()) quickInputWindow.hide(); });
ipcMain.handle("close-window", function () { var win = BrowserWindow.getFocusedWindow(); if (win) win.hide(); });
ipcMain.handle("minimize-window", function () { var win = BrowserWindow.getFocusedWindow(); if (win) win.minimize(); });

// Vision IPC handlers
ipcMain.handle("vision-capture-screen", async function () { return await captureScreen(); });
ipcMain.handle("vision-capture-window", async function () { return await captureActiveWindow(); });
ipcMain.handle("vision-analyze", async function (event, prompt) { return await analyzeScreen(prompt || ""); });
ipcMain.handle("vision-ocr", async function () { return await ocrScreen(); });
ipcMain.handle("vision-toggle-overlay", function () { toggleOverlay(); return { visible: overlayWindow ? overlayWindow.isVisible() : false }; });
ipcMain.handle("vision-start-monitoring", async function (event, interval) { return startMonitoring(interval || store.get("monitoringInterval")); });
ipcMain.handle("vision-stop-monitoring", function () { return stopMonitoring(); });

ipcMain.handle("vision-get-context", async function () {
  try {
    var fetch = require("node-fetch");
    var response = await fetch(BACKEND_URL + "/vision/context");
    return await response.json();
  } catch (error) { return { status: "error", message: error.message }; }
});

ipcMain.handle("vision-clear-context", async function () {
  try {
    var fetch = require("node-fetch");
    var response = await fetch(BACKEND_URL + "/vision/context", { method: "DELETE" });
    return await response.json();
  } catch (error) { return { status: "error", message: error.message }; }
});

ipcMain.handle("overlay-close", function () { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close(); });
ipcMain.handle("overlay-minimize", function () {
  if (overlayWindow && !overlayWindow.isDestroyed()) { overlayWindow.hide(); store.set("overlayVisible", false); }
});

ipcMain.handle("vision-list-windows", async function () {
  try {
    var sources = await desktopCapturer.getSources({ types: ["window"] });
    return sources.filter(function (s) { return s.name && !s.name.includes("MCP Grid"); })
      .map(function (s) { return { id: s.id, name: s.name }; });
  } catch (e) { return []; }
});

// --- App Lifecycle ---

app.whenReady().then(function () {
  createTray();
  registerHotkeys();
  createMainWindow();

  if (store.get("overlayVisible")) createOverlay();
  if (store.get("monitoringEnabled")) startMonitoring(store.get("monitoringInterval"));

  console.log("========================================");
  console.log("    MCP GRID - DESKTOP ASSISTANT ONLINE  ");
  console.log("========================================");
  console.log("  Ctrl+Space:       Quick Command");
  console.log("  Ctrl+Shift+Space: Full Console");
  console.log("  Ctrl+Shift+V:     Analyze Screen");
  console.log("  Ctrl+Shift+O:     Toggle Overlay");
  console.log("  Ctrl+Shift+T:     Extract Text (OCR)");
  console.log("========================================");
});

app.on("window-all-closed", function (e) { if (e && e.preventDefault) e.preventDefault(); });
app.on("before-quit", function () { stopMonitoring(); globalShortcut.unregisterAll(); });
app.on("activate", function () { createMainWindow(); });

if (store.get("startOnLogin")) {
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
}
