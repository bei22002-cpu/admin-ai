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
});
