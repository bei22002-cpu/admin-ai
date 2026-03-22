/**
 * MCP Grid - Renderer Application
 * TRON-themed AI Desktop Assistant UI
 */

// ─── State ──────────────────────────────────────────────────────

const state = {
  phase: 1,
  backendUrl: "http://localhost:1337",
  isConnected: false,
  commandHistory: [],
  historyIndex: -1,
};

// ─── DOM Elements ───────────────────────────────────────────────

const chatContainer = document.getElementById("chatContainer");
const commandInput = document.getElementById("commandInput");
const sendBtn = document.getElementById("sendBtn");
const statusIndicator = document.getElementById("statusIndicator");
const statusText = document.getElementById("statusText");
const phaseBadge = document.getElementById("phaseBadge");
const cpuDisplay = document.getElementById("cpuDisplay");
const memDisplay = document.getElementById("memDisplay");
const timeDisplay = document.getElementById("timeDisplay");
const minimizeBtn = document.getElementById("minimizeBtn");
const closeBtn = document.getElementById("closeBtn");

// ─── Boot Sequence ──────────────────────────────────────────────

function showBootSequence() {
  const boot = document.createElement("div");
  boot.className = "boot-sequence";
  boot.innerHTML = `
    <div class="boot-logo">MCP</div>
    <div class="boot-text">INITIALIZING GRID PROTOCOL...</div>
    <div class="boot-bar"><div class="boot-bar-fill"></div></div>
  `;
  document.body.appendChild(boot);

  // Remove after animation
  setTimeout(() => {
    if (boot.parentNode) {
      boot.parentNode.removeChild(boot);
    }
  }, 5500);
}

// ─── Message Display ────────────────────────────────────────────

function addMessage(type, prefix, content, data) {
  const msg = document.createElement("div");
  msg.className = `chat-message ${type}-message`;

  let dataHtml = "";
  if (data && typeof data === "object") {
    dataHtml = '<div class="data-grid">';
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== "object") {
        dataHtml += `
          <div class="data-row">
            <span class="data-key">${key}</span>
            <span class="data-value">${value}</span>
          </div>
        `;
      }
    }
    dataHtml += "</div>";
  }

  msg.innerHTML = `
    <div class="message-prefix">${prefix}</div>
    <div class="message-content">${escapeHtml(content)}${dataHtml}</div>
  `;

  chatContainer.appendChild(msg);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function addLoadingMessage() {
  const msg = document.createElement("div");
  msg.className = "chat-message system-message";
  msg.id = "loadingMessage";
  msg.innerHTML = `
    <div class="message-prefix">[MCP]</div>
    <div class="message-content">
      Processing
      <div class="loading-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  chatContainer.appendChild(msg);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeLoadingMessage() {
  const loading = document.getElementById("loadingMessage");
  if (loading) {
    loading.remove();
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ─── Command Execution ─────────────────────────────────────────

async function executeCommand(rawInput) {
  if (!rawInput.trim()) return;

  // Add to history
  state.commandHistory.unshift(rawInput);
  state.historyIndex = -1;

  // Parse command
  let command = rawInput;
  let args = "";

  if (rawInput.toLowerCase().startsWith("mcp ")) {
    const parts = rawInput.substring(4).trim().split(" ");
    command = parts[0].toLowerCase();
    args = parts.slice(1).join(" ");
  } else {
    const parts = rawInput.trim().split(" ");
    command = parts[0].toLowerCase();
    args = parts.slice(1).join(" ");
  }

  // Handle phase assimilation
  if (
    command === "assimilate" &&
    args.toLowerCase().startsWith("phase")
  ) {
    const phaseNum = parseInt(args.replace(/\D/g, ""), 10);
    if (phaseNum >= 1 && phaseNum <= 4) {
      addMessage("user", "[USER]", rawInput);
      await assimilatePhase(phaseNum);
      return;
    }
  }

  // Display user command
  addMessage("user", "[USER]", rawInput);
  addLoadingMessage();

  try {
    let response;

    // Try Electron IPC first
    if (window.mcp) {
      response = await window.mcp.sendCommand(command, args);
    } else {
      // Direct HTTP fallback (for browser testing)
      const res = await fetch(`${state.backendUrl}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, args }),
      });
      response = await res.json();
    }

    removeLoadingMessage();

    if (response) {
      const msgType = response.status === "error" ? "error" : "response";
      addMessage(msgType, "[MCP]", response.message);

      if (response.tron_quote) {
        addMessage("system", "[SYS]", response.tron_quote);
      }

      if (response.data) {
        displayResponseData(response.data);
      }
    }
  } catch (error) {
    removeLoadingMessage();
    addMessage(
      "error",
      "[ERR]",
      `Backend connection failed: ${error.message}. Is MCP backend running on port 1337?`
    );
  }

  commandInput.value = "";
  commandInput.focus();
}

function displayResponseData(data) {
  if (!data || typeof data !== "object") return;

  // Filter out complex nested objects for display
  const displayData = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      displayData[key] = value;
    } else if (Array.isArray(value)) {
      displayData[key] = `[${value.length} items]`;
    }
  }

  if (Object.keys(displayData).length > 0) {
    addMessage("response", "[DATA]", "", displayData);
  }
}

async function assimilatePhase(phaseNum) {
  addLoadingMessage();

  try {
    let response;
    if (window.mcp) {
      response = await window.mcp.sendCommand("phase", String(phaseNum));
    } else {
      const res = await fetch(`${state.backendUrl}/phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: phaseNum }),
      });
      response = await res.json();
    }

    removeLoadingMessage();

    state.phase = phaseNum;
    phaseBadge.textContent = `PHASE ${phaseNum}`;
    addMessage(
      "system",
      "[MCP]",
      `Phase ${phaseNum} assimilated. New capabilities unlocked. Sector secured.`
    );
  } catch (error) {
    removeLoadingMessage();
    addMessage("error", "[ERR]", `Phase assimilation failed: ${error.message}`);
  }
}

// ─── Backend Health Check ───────────────────────────────────────

async function checkBackendHealth() {
  try {
    const res = await fetch(`${state.backendUrl}/health`, { method: "GET" });
    const data = await res.json();
    state.isConnected = data.status === "operational";
  } catch {
    state.isConnected = false;
  }

  if (state.isConnected) {
    statusIndicator.className = "status-indicator online";
    statusText.textContent = "MCP ONLINE";
  } else {
    statusIndicator.className = "status-indicator offline";
    statusText.textContent = "MCP OFFLINE";
  }
}

// ─── System Stats ───────────────────────────────────────────────

async function updateStats() {
  try {
    const res = await fetch(`${state.backendUrl}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "report", args: "status" }),
    });
    const data = await res.json();

    if (data.data && data.data.resources) {
      cpuDisplay.textContent = `CPU: ${data.data.resources.cpu_percent}%`;
      memDisplay.textContent = `MEM: ${data.data.resources.memory_percent}%`;
    }
  } catch {
    // Silent fail - stats are non-critical
  }
}

function updateClock() {
  const now = new Date();
  timeDisplay.textContent = now.toLocaleTimeString("en-US", { hour12: false });
}

// ─── Event Listeners ────────────────────────────────────────────

// Send command on Enter
commandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    executeCommand(commandInput.value);
  } else if (e.key === "ArrowUp") {
    // Navigate command history
    if (state.historyIndex < state.commandHistory.length - 1) {
      state.historyIndex++;
      commandInput.value = state.commandHistory[state.historyIndex];
    }
    e.preventDefault();
  } else if (e.key === "ArrowDown") {
    if (state.historyIndex > 0) {
      state.historyIndex--;
      commandInput.value = state.commandHistory[state.historyIndex];
    } else {
      state.historyIndex = -1;
      commandInput.value = "";
    }
    e.preventDefault();
  }
});

// Send button
sendBtn.addEventListener("click", () => {
  executeCommand(commandInput.value);
});

// Command grid buttons
document.querySelectorAll(".cmd-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const cmd = btn.dataset.cmd;
    commandInput.value = `MCP ${cmd} `;
    commandInput.focus();
  });
});

// Window controls
if (minimizeBtn) {
  minimizeBtn.addEventListener("click", () => {
    if (window.mcp) window.mcp.minimizeWindow();
  });
}

if (closeBtn) {
  closeBtn.addEventListener("click", () => {
    if (window.mcp) window.mcp.closeWindow();
  });
}

// Listen for backend responses (IPC)
if (window.mcp) {
  window.mcp.onCommandResponse((data) => {
    removeLoadingMessage();
    if (data) {
      addMessage("response", "[MCP]", data.message || "Command executed.");
    }
  });
}

// ─── Initialization ─────────────────────────────────────────────

async function init() {
  // Show boot sequence
  showBootSequence();

  // Load config
  if (window.mcp) {
    const config = await window.mcp.getConfig();
    state.phase = config.phase || 1;
    state.backendUrl = config.backendUrl || "http://localhost:1337";
    phaseBadge.textContent = `PHASE ${state.phase}`;
  }

  // Check backend
  await checkBackendHealth();

  // Start intervals
  setInterval(updateClock, 1000);
  setInterval(checkBackendHealth, 10000);
  setInterval(updateStats, 30000);

  updateClock();
  commandInput.focus();

  console.log("MCP Grid UI initialized. Phase:", state.phase);
}

// Start
init();
