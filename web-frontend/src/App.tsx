import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, LogIn, UserPlus, Code, Search, Shield, Wifi, Bell, BarChart3, Eye, History, LogOut, Send, Loader2 } from "lucide-react";

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
    <div className="min-h-screen grid-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold tron-text tracking-widest">MCP</h1>
          <p className="text-sm text-orange-400/60 mt-2 tracking-widest uppercase">
            Grid Control System
          </p>
          <div className="w-24 h-px bg-gradient-to-r from-transparent via-orange-500 to-transparent mx-auto mt-4" />
        </div>

        {/* Auth Card */}
        <div className="tron-border tron-glow rounded-lg p-6">
          <div className="flex mb-6">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 py-2 text-sm tracking-wider border-b-2 transition-colors ${
                mode === "login"
                  ? "border-orange-500 text-orange-400"
                  : "border-transparent text-gray-500 hover:text-gray-400"
              }`}
            >
              <LogIn className="inline w-4 h-4 mr-1" /> ACCESS
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 text-sm tracking-wider border-b-2 transition-colors ${
                mode === "signup"
                  ? "border-orange-500 text-orange-400"
                  : "border-transparent text-gray-500 hover:text-gray-400"
              }`}
            >
              <UserPlus className="inline w-4 h-4 mr-1" /> REGISTER
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <input
                type="text"
                placeholder="USERNAME"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="tron-input w-full px-4 py-3 rounded text-sm tracking-wider"
                required
              />
            )}
            <input
              type="email"
              placeholder="EMAIL"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="tron-input w-full px-4 py-3 rounded text-sm tracking-wider"
              required
            />
            <input
              type="password"
              placeholder="PASSWORD"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="tron-input w-full px-4 py-3 rounded text-sm tracking-wider"
              required
            />
            {error && (
              <p className="text-red-400 text-xs tracking-wider">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="tron-btn w-full py-3 rounded text-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === "login" ? (
                <>
                  <LogIn className="w-4 h-4" /> INITIALIZE
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" /> CREATE IDENTITY
                </>
              )}
            </button>
          </form>

          {/* Guest access */}
          <button
            onClick={() => onAuth("", { id: 0, username: "guest", email: "" })}
            className="w-full mt-4 py-2 text-xs text-gray-500 hover:text-gray-400 tracking-wider transition-colors"
          >
            CONTINUE AS GUEST (no project history)
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar Commands ────────────────────────────────────────
const COMMANDS = [
  { cmd: "code", icon: Code, label: "CODE", desc: "Generate programs" },
  { cmd: "search", icon: Search, label: "SEARCH", desc: "AI-powered search" },
  { cmd: "access", icon: Shield, label: "ACCESS", desc: "System access" },
  { cmd: "scan", icon: Wifi, label: "SCAN", desc: "Network scan" },
  { cmd: "alert", icon: Bell, label: "ALERT", desc: "Set alerts" },
  { cmd: "report", icon: BarChart3, label: "REPORT", desc: "System report" },
  { cmd: "analyze", icon: Eye, label: "ANALYZE", desc: "Screen analysis" },
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

  return (
    <div className="min-h-screen grid-bg flex">
      {/* Sidebar */}
      <div className="w-56 tron-border border-t-0 border-b-0 border-l-0 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-orange-500/20">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-orange-500" />
            <span className="text-xl font-bold tron-text tracking-widest">MCP</span>
            <span className="text-xs text-gray-500 tracking-wider">GRID</span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <div
              className={`w-2 h-2 rounded-full ${
                status === "online"
                  ? "bg-green-400"
                  : status === "processing"
                  ? "bg-orange-400 tron-pulse"
                  : "bg-red-400"
              }`}
            />
            <span className="text-xs text-gray-500 uppercase tracking-wider">
              {status === "online" ? "ONLINE" : status === "processing" ? "PROCESSING" : "OFFLINE"}
            </span>
          </div>
        </div>

        {/* Commands */}
        <div className="flex-1 p-2 overflow-y-auto">
          <p className="text-xs text-gray-600 px-2 py-1 tracking-widest">COMMANDS</p>
          {COMMANDS.map(({ cmd, icon: Icon, label }) => (
            <button
              key={cmd}
              onClick={() => {
                setInput(`${cmd} `);
                document.getElementById("cmd-input")?.focus();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-orange-400 hover:bg-orange-500/5 rounded transition-colors"
            >
              <Icon className="w-4 h-4" />
              <span className="tracking-wider">{label}</span>
            </button>
          ))}
        </div>

        {/* History toggle */}
        <div className="p-2 border-t border-orange-500/20">
          {token && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-orange-400 hover:bg-orange-500/5 rounded transition-colors"
            >
              <History className="w-4 h-4" />
              <span className="tracking-wider">HISTORY</span>
              {projects.length > 0 && (
                <span className="ml-auto text-xs text-orange-500/60">{projects.length}</span>
              )}
            </button>
          )}
        </div>

        {/* User info */}
        <div className="p-3 border-t border-orange-500/20">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 tracking-wider truncate">
              {user.username.toUpperCase()}
            </span>
            <button
              onClick={onLogout}
              className="text-gray-600 hover:text-red-400 transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex">
        {/* Console */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="px-4 py-2 border-b border-orange-500/20 flex items-center justify-between">
            <span className="text-xs text-gray-500 tracking-widest">GRID CONSOLE</span>
            <span className="text-xs text-gray-600">
              {new Date().toLocaleTimeString()}
            </span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className="flex gap-3">
                <span
                  className={`text-xs font-bold mt-0.5 shrink-0 tracking-wider ${
                    msg.type === "user"
                      ? "text-green-400"
                      : msg.type === "mcp"
                      ? "text-orange-400"
                      : msg.type === "error"
                      ? "text-red-400"
                      : "text-cyan-400/60"
                  }`}
                >
                  [{msg.type === "user" ? "USER" : msg.type === "mcp" ? "MCP" : msg.type === "error" ? "ERR" : "SYS"}]
                </span>
                <div className="flex-1">
                  <p
                    className={`text-sm whitespace-pre-wrap ${
                      msg.type === "system" ? "text-cyan-400/50" : ""
                    }`}
                  >
                    {msg.text}
                  </p>
                  {msg.data && (
                    <div className="mt-2 tron-border rounded p-3 text-xs space-y-1">
                      {!!msg.data.status && (
                        <div>
                          <span className="text-gray-500">STATUS: </span>
                          <span
                            className={
                              msg.data.status === "success"
                                ? "text-green-400"
                                : msg.data.status === "partial"
                                ? "text-yellow-400"
                                : "text-red-400"
                            }
                          >
                            {String(msg.data.status).toUpperCase()}
                          </span>
                        </div>
                      )}
                      {msg.data.file_count !== undefined && (
                        <div>
                          <span className="text-gray-500">FILES: </span>
                          <span className="text-orange-400">{String(msg.data.file_count)}</span>
                        </div>
                      )}
                      {!!msg.data.language && (
                        <div>
                          <span className="text-gray-500">LANGUAGE: </span>
                          <span className="text-cyan-400">{String(msg.data.language)}</span>
                        </div>
                      )}
                      {!!msg.data.model && (
                        <div>
                          <span className="text-gray-500">MODEL: </span>
                          <span className="text-gray-400">{String(msg.data.model)}</span>
                        </div>
                      )}
                      {!!msg.data.output && (
                        <div className="mt-2">
                          <span className="text-gray-500">OUTPUT:</span>
                          <pre className="mt-1 p-2 bg-black/40 rounded text-green-300 overflow-x-auto max-h-48 overflow-y-auto">
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
              <div className="flex items-center gap-2 text-orange-400/60">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm tron-pulse tracking-wider">Processing...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-orange-500/20">
            <div className="flex gap-2">
              <span className="text-orange-500 text-sm mt-2.5 shrink-0 tracking-wider">MCP&gt;</span>
              <input
                id="cmd-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='Enter command... (e.g., "code a REST API", "search quantum computing")'
                className="tron-input flex-1 px-3 py-2 rounded text-sm"
                disabled={loading}
                autoFocus
              />
              <button
                onClick={() => sendCommand(input)}
                disabled={loading || !input.trim()}
                className="tron-btn px-4 py-2 rounded flex items-center gap-1"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Project History Panel */}
        {showHistory && token && (
          <div className="w-72 border-l border-orange-500/20 flex flex-col">
            <div className="p-3 border-b border-orange-500/20">
              <span className="text-xs text-gray-500 tracking-widest">PROJECT HISTORY</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {projects.length === 0 ? (
                <p className="text-xs text-gray-600 p-3 text-center">
                  No projects yet. Use the CODE command to generate one.
                </p>
              ) : (
                projects.map((proj) => (
                  <div
                    key={proj.id}
                    className="tron-border rounded p-3 text-xs space-y-1 hover:bg-orange-500/5 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-orange-400 truncate font-bold">
                        {proj.name}
                      </span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          proj.status === "success"
                            ? "bg-green-500/20 text-green-400"
                            : proj.status === "processing"
                            ? "bg-orange-500/20 text-orange-400"
                            : proj.status === "partial"
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {proj.status}
                      </span>
                    </div>
                    <div className="text-gray-500 flex gap-3">
                      <span>{proj.file_count} files</span>
                      <span>{proj.language}</span>
                    </div>
                    <div className="text-gray-600">
                      {new Date(proj.created_at * 1000).toLocaleDateString()}
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
