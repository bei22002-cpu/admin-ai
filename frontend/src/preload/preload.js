/**
 * MCP Grid - Preload Script
 * Exposes safe IPC bridge to renderer process.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mcp", {
  // Send a command to the backend
  sendCommand: (command, args) =>
    ipcRenderer.invoke("send-command", command, args),

  // Get/set configuration
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (key, value) => ipcRenderer.invoke("set-config", key, value),

  // Window controls
  closeWindow: () => ipcRenderer.invoke("close-window"),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  closeQuickInput: () => ipcRenderer.invoke("close-quick-input"),

  // Listen for command responses
  onCommandResponse: (callback) => {
    ipcRenderer.on("command-response", (event, data) => callback(data));
  },

  // Listen for system messages
  onSystemMessage: (callback) => {
    ipcRenderer.on("system-message", (event, data) => callback(data));
  },

  // --- Vision / Desktop Assistant ---

  // Screen capture
  captureScreen: () => ipcRenderer.invoke("vision-capture-screen"),
  captureWindow: () => ipcRenderer.invoke("vision-capture-window"),

  // Vision analysis & OCR
  analyzeScreen: (prompt) => ipcRenderer.invoke("vision-analyze", prompt),
  ocrScreen: () => ipcRenderer.invoke("vision-ocr"),

  // Overlay controls
  toggleOverlay: () => ipcRenderer.invoke("vision-toggle-overlay"),
  closeOverlay: () => ipcRenderer.invoke("overlay-close"),
  minimizeOverlay: () => ipcRenderer.invoke("overlay-minimize"),

  // Monitoring controls
  startMonitoring: (interval) =>
    ipcRenderer.invoke("vision-start-monitoring", interval),
  stopMonitoring: () => ipcRenderer.invoke("vision-stop-monitoring"),

  // Context memory
  getVisionContext: () => ipcRenderer.invoke("vision-get-context"),
  clearVisionContext: () => ipcRenderer.invoke("vision-clear-context"),

  // Window listing
  listWindows: () => ipcRenderer.invoke("vision-list-windows"),

  // Listen for vision results from main process
  onVisionResult: (callback) => {
    ipcRenderer.on("vision-result", (event, data) => callback(data));
  },

  // Listen for monitoring updates
  onMonitoringUpdate: (callback) => {
    ipcRenderer.on("monitoring-update", (event, data) => callback(data));
  },

  // Listen for OCR results
  onOcrResult: (callback) => {
    ipcRenderer.on("ocr-result", (event, data) => callback(data));
  },
});
