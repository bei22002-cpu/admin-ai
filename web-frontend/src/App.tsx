import { useCallback, useEffect, useRef, useState } from "react";
import {
  Terminal, LogIn, UserPlus, Code, Search, Shield, Wifi, Bell,
  BarChart3, Eye, History, LogOut, Send, Loader2, Zap, ChevronRight,
  Clock, FileCode, ArrowRight, User as UserIcon, X,
  GitBranch, FolderOpen, CalendarClock, TestTube2, FileText,
  Database, Puzzle, Image, Mic, Clipboard, BellRing, Users,
  Smartphone, Play, FlaskConical, TerminalSquare, MessageSquare,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

interface Message {
  type: "user" | "mcp" | "system" | "error";
  text: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

interface Project {
  id: number;
  name: string;
  status: string;
  file_count: number;
  language: string;
  created_at: number;
}

interface User {
  id: number;
  username: string;
  email: string;
}

// ─── Auth Screen ─────────────────────────────────────────────
function AuthScreen({ onAuth }: { onAuth: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/signup";
      const body = mode === "login"
        ? { email, password }
        : { username, email, password };
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.status === "success") {
        localStorage.setItem("mcp_token", data.token);
        localStorage.setItem("mcp_user", JSON.stringify(data.user));
        onAuth(data.token, data.user);
      } else {
        setError(data.message || "Authentication failed");
      }
    } catch {
      setError("Connection failed. Is the MCP backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen auth-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-4xl font-bold gradient-text tracking-tight" style={{ fontFamily: "'Inter', sans-serif" }}>
              MCP
            </h1>
          </div>
          <p className="text-xs text-zinc-500 tracking-widest uppercase font-medium">
            Grid Control System
          </p>
          <div className="accent-divider w-16 mx-auto mt-5" />
        </div>

        {/* Auth Card */}
        <div className="glass-card accent-glow p-7">
          {/* Tabs */}
          <div className="flex gap-1 mb-7 p-1 rounded-lg bg-black/20">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 py-2.5 text-xs font-medium tracking-wider rounded-md transition-all ${
                mode === "login"
                  ? "bg-gradient-to-r from-orange-500/15 to-orange-600/10 text-orange-400 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-400"
              }`}
            >
              <LogIn className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" /> Sign In
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 py-2.5 text-xs font-medium tracking-wider rounded-md transition-all ${
                mode === "signup"
                  ? "bg-gradient-to-r from-orange-500/15 to-orange-600/10 text-orange-400 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-400"
              }`}
            >
              <UserPlus className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" /> Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === "signup" && (
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5 font-medium tracking-wide">Username</label>
                <input
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pro-input w-full px-4 py-3 rounded-lg"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5 font-medium tracking-wide">Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pro-input w-full px-4 py-3 rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5 font-medium tracking-wide">Password</label>
              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pro-input w-full px-4 py-3 rounded-lg"
                required
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/8 px-3 py-2 rounded-lg border border-red-500/15">
                <X className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="pro-btn pro-btn-filled w-full py-3 rounded-lg text-sm flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  {mode === "login" ? "Sign In" : "Create Account"}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-xs text-zinc-600">or</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          {/* Guest access */}
          <button
            onClick={() => onAuth("", { id: 0, username: "guest", email: "" })}
            className="pro-btn w-full py-2.5 rounded-lg text-xs flex items-center justify-center gap-2"
          >
            <UserIcon className="w-3.5 h-3.5" />
            Continue as Guest
          </button>
          <p className="text-center text-xs text-zinc-600 mt-2">
            Guest mode does not save project history
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-zinc-700 mt-6">
          Powered by AI &middot; Built on the Grid
        </p>
      </div>
    </div>
  );
}

// ─── Sidebar Commands ────────────────────────────────────────
const COMMANDS = [
  // Core
  { cmd: "code", icon: Code, label: "Code", desc: "Generate programs" },
  { cmd: "search", icon: Search, label: "Search", desc: "AI-powered search" },
  { cmd: "access", icon: Shield, label: "Access", desc: "System access" },
  { cmd: "scan", icon: Wifi, label: "Scan", desc: "Network scan" },
  { cmd: "alert", icon: Bell, label: "Alert", desc: "Set alerts" },
  { cmd: "report", icon: BarChart3, label: "Report", desc: "System report" },
  { cmd: "analyze", icon: Eye, label: "Analyze", desc: "Screen analysis" },
  // AI Coding
  { cmd: "review", icon: MessageSquare, label: "Review", desc: "Code review" },
  { cmd: "test", icon: FlaskConical, label: "Tests", desc: "Generate tests" },
  { cmd: "preview", icon: Play, label: "Preview", desc: "Live preview" },
  { cmd: "github", icon: GitBranch, label: "GitHub", desc: "Git integration" },
  { cmd: "docs", icon: FileText, label: "Docs", desc: "Generate docs" },
  { cmd: "template", icon: FileCode, label: "Templates", desc: "Project scaffolds" },
  // Productivity
  { cmd: "files", icon: FolderOpen, label: "Files", desc: "File management" },
  { cmd: "shell", icon: TerminalSquare, label: "Shell", desc: "Shell assistant" },
  { cmd: "schedule", icon: CalendarClock, label: "Schedule", desc: "Task scheduling" },
  { cmd: "notify", icon: BellRing, label: "Notify", desc: "Notifications" },
  { cmd: "clip", icon: Clipboard, label: "Clipboard", desc: "Clip manager" },
  { cmd: "db", icon: Database, label: "Database", desc: "DB management" },
  { cmd: "apitest", icon: TestTube2, label: "API Test", desc: "Test APIs" },
  // Platform
  { cmd: "plugin", icon: Puzzle, label: "Plugins", desc: "Custom plugins" },
  { cmd: "gallery", icon: Image, label: "Gallery", desc: "Project gallery" },
  { cmd: "collab", icon: Users, label: "Collab", desc: "Collaboration" },
  { cmd: "voice", icon: Mic, label: "Voice", desc: "Voice commands" },
  { cmd: "mobile", icon: Smartphone, label: "Mobile", desc: "Mobile access" },
];

// ─── Console Screen ──────────────────────────────────────────
function ConsoleScreen({
  user,
  token,
  onLogout,
}: {
  user: User;
  token: string;
  onLogout: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([
    {
      type: "system",
      text: "MCP online. Grid initialized. Awaiting user input.",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [status, setStatus] = useState<"online" | "offline" | "processing">("online");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Fetch projects on mount
  useEffect(() => {
    if (token) {
      fetch(`${API}/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "success") setProjects(data.projects);
        })
        .catch(() => {});
    }
  }, [token]);

  // Health check
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${API}/health`);
        if (res.ok) setStatus((s) => (s === "processing" ? s : "online"));
        else setStatus("offline");
      } catch {
        setStatus("offline");
      }
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  const sendCommand = async (cmdText: string) => {
    if (!cmdText.trim() || loading) return;

    const userMsg: Message = {
      type: "user",
      text: cmdText,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setStatus("processing");

    // Parse command
    let cmd = cmdText.trim().toLowerCase();
    let args = "";
    if (cmd.startsWith("mcp ")) cmd = cmd.slice(4);
    const spaceIdx = cmd.indexOf(" ");
    if (spaceIdx > 0) {
      args = cmd.slice(spaceIdx + 1);
      cmd = cmd.slice(0, spaceIdx);
    }

    try {
      const endpoint = token ? "/command/auth" : "/command";
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ command: cmd, args }),
      });
      const data = await res.json();

      const mcpMsg: Message = {
        type: data.status === "success" ? "mcp" : "error",
        text: data.message,
        timestamp: Date.now(),
        data: data.data || undefined,
      };
      setMessages((prev) => [...prev, mcpMsg]);

      if (data.tron_quote) {
        setMessages((prev) => [
          ...prev,
          { type: "system", text: data.tron_quote, timestamp: Date.now() },
        ]);
      }

      // Refresh projects
      if (token && cmd === "code") {
        const projRes = await fetch(`${API}/projects`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const projData = await projRes.json();
        if (projData.status === "success") setProjects(projData.projects);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          type: "error",
          text: "Connection to MCP backend failed. Check if server is running.",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
      setStatus("online");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCommand(input);
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-screen grid-bg flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-60 sidebar flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/15">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-base font-semibold gradient-text tracking-tight">MCP Grid</span>
            </div>
          </div>
          {/* Status */}
          <div className="flex items-center gap-2 mt-3 ml-0.5">
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                status === "online"
                  ? "bg-emerald-400 shadow-sm shadow-emerald-400/50"
                  : status === "processing"
                  ? "bg-orange-400 pulse-glow shadow-sm shadow-orange-400/50"
                  : "bg-red-400 shadow-sm shadow-red-400/50"
              }`}
            />
            <span className="text-xs text-zinc-500 font-medium">
              {status === "online" ? "Online" : status === "processing" ? "Processing" : "Offline"}
            </span>
          </div>
        </div>

        <div className="accent-divider mx-4" />

        {/* Commands */}
        <div className="flex-1 px-3 py-3 overflow-y-auto">
          <p className="text-xs text-zinc-600 px-2 py-1.5 font-semibold tracking-wider uppercase">Commands</p>
          <div className="space-y-0.5 mt-1">
            {COMMANDS.map(({ cmd, icon: Icon, label, desc }) => (
              <button
                key={cmd}
                onClick={() => {
                  setInput(`${cmd} `);
                  document.getElementById("cmd-input")?.focus();
                }}
                className="cmd-btn w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-400 hover:text-orange-400 group"
              >
                <Icon className="w-4 h-4 text-zinc-600 group-hover:text-orange-500 transition-colors" />
                <div className="flex flex-col items-start">
                  <span className="font-medium text-xs">{label}</span>
                  <span className="text-xs text-zinc-600 group-hover:text-zinc-500 transition-colors">{desc}</span>
                </div>
                <ChevronRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-50 transition-opacity text-orange-500" />
              </button>
            ))}
          </div>
        </div>

        {/* History toggle */}
        {token && (
          <>
            <div className="accent-divider mx-4" />
            <div className="px-3 py-2">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`cmd-btn w-full flex items-center gap-2.5 px-3 py-2 text-sm group ${
                  showHistory ? "text-orange-400 bg-orange-500/8" : "text-zinc-400 hover:text-orange-400"
                }`}
              >
                <History className={`w-4 h-4 ${showHistory ? "text-orange-500" : "text-zinc-600 group-hover:text-orange-500"} transition-colors`} />
                <span className="font-medium text-xs">History</span>
                {projects.length > 0 && (
                  <span className="ml-auto status-badge bg-orange-500/15 text-orange-400">{projects.length}</span>
                )}
              </button>
            </div>
          </>
        )}

        {/* User info */}
        <div className="accent-divider mx-4" />
        <div className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center border border-zinc-700/50">
              <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-300 truncate">
                {user.username.charAt(0).toUpperCase() + user.username.slice(1)}
              </p>
              {user.email && (
                <p className="text-xs text-zinc-600 truncate">{user.email}</p>
              )}
            </div>
            <button
              onClick={onLogout}
              className="text-zinc-600 hover:text-red-400 transition-colors p-1 rounded-md hover:bg-red-500/5"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex min-w-0">
        {/* Console */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-5 py-3 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <Terminal className="w-4 h-4 text-zinc-600" />
              <span className="text-sm font-medium text-zinc-400">Console</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-600">
              <Clock className="w-3 h-3" />
              {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className="flex gap-3 fade-in">
                {/* Tag */}
                <span
                  className={`msg-tag mt-0.5 shrink-0 ${
                    msg.type === "user"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : msg.type === "mcp"
                      ? "bg-orange-500/10 text-orange-400"
                      : msg.type === "error"
                      ? "bg-red-500/10 text-red-400"
                      : "bg-cyan-500/8 text-cyan-400/70"
                  }`}
                >
                  {msg.type === "user" ? "YOU" : msg.type === "mcp" ? "MCP" : msg.type === "error" ? "ERR" : "SYS"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <p
                      className={`text-sm whitespace-pre-wrap leading-relaxed ${
                        msg.type === "system"
                          ? "text-cyan-400/40 italic"
                          : msg.type === "error"
                          ? "text-red-300/80"
                          : "text-zinc-300"
                      }`}
                    >
                      {msg.text}
                    </p>
                    <span className="text-xs text-zinc-700 shrink-0">{formatTime(msg.timestamp)}</span>
                  </div>
                  {msg.data && (
                    <div className="mt-2 data-panel text-xs">
                      {!!msg.data.status && (
                        <div className="data-row">
                          <span className="text-zinc-500 w-16 shrink-0">Status</span>
                          <span
                            className={`status-badge ${
                              msg.data.status === "success"
                                ? "bg-emerald-500/15 text-emerald-400"
                                : msg.data.status === "partial"
                                ? "bg-yellow-500/15 text-yellow-400"
                                : "bg-red-500/15 text-red-400"
                            }`}
                          >
                            {String(msg.data.status)}
                          </span>
                        </div>
                      )}
                      {msg.data.file_count !== undefined && (
                        <div className="data-row">
                          <span className="text-zinc-500 w-16 shrink-0">Files</span>
                          <span className="text-orange-400 font-medium">{String(msg.data.file_count)}</span>
                        </div>
                      )}
                      {!!msg.data.language && (
                        <div className="data-row">
                          <span className="text-zinc-500 w-16 shrink-0">Lang</span>
                          <span className="text-cyan-400 font-medium">{String(msg.data.language)}</span>
                        </div>
                      )}
                      {!!msg.data.model && (
                        <div className="data-row">
                          <span className="text-zinc-500 w-16 shrink-0">Model</span>
                          <span className="text-zinc-400 font-mono text-xs">{String(msg.data.model)}</span>
                        </div>
                      )}
                      {!!msg.data.output && (
                        <div className="p-3 border-t border-zinc-800/50">
                          <span className="text-zinc-500 text-xs font-medium">Output</span>
                          <pre className="mt-2 p-3 bg-black/30 rounded-md text-emerald-300/90 overflow-x-auto max-h-48 overflow-y-auto font-mono text-xs leading-relaxed">
                            {String(msg.data.output).slice(0, 1000)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-3 py-2 fade-in">
                <div className="msg-tag bg-orange-500/10 text-orange-400">MCP</div>
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                  <span className="text-sm text-zinc-500">Processing your request...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-5 py-4 border-t border-zinc-800/80 shrink-0">
            <div className="flex gap-2 items-center">
              <div className="flex items-center gap-1.5 shrink-0">
                <ChevronRight className="w-4 h-4 text-orange-500" />
              </div>
              <input
                id="cmd-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a command... (e.g., code a REST API)"
                className="pro-input flex-1 px-4 py-2.5 rounded-lg text-sm"
                disabled={loading}
                autoFocus
              />
              <button
                onClick={() => sendCommand(input)}
                disabled={loading || !input.trim()}
                className="pro-btn px-4 py-2.5 rounded-lg flex items-center gap-1.5 shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span className="text-xs font-medium hidden sm:inline">Send</span>
              </button>
            </div>
          </div>
        </div>

        {/* Project History Panel */}
        {showHistory && token && (
          <div className="w-80 border-l border-zinc-800/80 flex flex-col shrink-0 slide-in-right" style={{ background: "rgba(14,14,20,0.6)" }}>
            <div className="px-5 py-3 border-b border-zinc-800/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-zinc-600" />
                <span className="text-sm font-medium text-zinc-400">Project History</span>
              </div>
              <button onClick={() => setShowHistory(false)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {projects.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <FileCode className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                  <p className="text-sm text-zinc-600 mb-1">No projects yet</p>
                  <p className="text-xs text-zinc-700">
                    Use the Code command to generate your first project
                  </p>
                </div>
              ) : (
                projects.map((proj) => (
                  <div
                    key={proj.id}
                    className="glass-card p-3.5 text-xs space-y-2 hover:border-orange-500/20 cursor-pointer transition-all group"
                    style={{ borderRadius: "10px" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-zinc-200 truncate font-medium text-sm group-hover:text-orange-400 transition-colors">
                        {proj.name}
                      </span>
                      <span
                        className={`status-badge shrink-0 ${
                          proj.status === "success"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : proj.status === "processing"
                            ? "bg-orange-500/15 text-orange-400"
                            : proj.status === "partial"
                            ? "bg-yellow-500/15 text-yellow-400"
                            : "bg-red-500/15 text-red-400"
                        }`}
                      >
                        {proj.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-zinc-600">
                      <span className="flex items-center gap-1">
                        <FileCode className="w-3 h-3" />
                        {proj.file_count} files
                      </span>
                      <span className="flex items-center gap-1">
                        <Code className="w-3 h-3" />
                        {proj.language}
                      </span>
                    </div>
                    <div className="text-zinc-700 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(proj.created_at * 1000).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────
function App() {
  const [token, setToken] = useState<string>(
    () => localStorage.getItem("mcp_token") || ""
  );
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem("mcp_user");
    return stored ? JSON.parse(stored) : null;
  });

  const handleAuth = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
  };

  const handleLogout = () => {
    setToken("");
    setUser(null);
    localStorage.removeItem("mcp_token");
    localStorage.removeItem("mcp_user");
  };

  if (!user) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  return (
    <ConsoleScreen user={user} token={token} onLogout={handleLogout} />
  );
}

export default App;
