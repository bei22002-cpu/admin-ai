import { useCallback, useEffect, useRef, useState } from "react";
import {
  Terminal, LogIn, UserPlus, Code, Search, Shield, Wifi, Bell,
  BarChart3, Eye, History, LogOut, Send, Loader2, Zap, ChevronRight,
  Clock, FileCode, ArrowRight, User as UserIcon, X,
  GitBranch, FolderOpen, CalendarClock, TestTube2, FileText,
  Database, Puzzle, Image, Mic, Clipboard, BellRing, Users,
  Smartphone, Play, FlaskConical, TerminalSquare, MessageSquare,
  CreditCard, Crown, Sparkles, Check, ExternalLink,
  Copy, Download, ChevronDown, ChevronUp, File,
  PanelLeftClose, PanelLeft, Activity, Layers,
  type LucideIcon,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// === Types ===
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
  plan?: string;
}

interface PlanInfo {
  id: string;
  name: string;
  price_monthly: number;
  price_yearly: number;
  commands_per_day: number;
  ai_providers: string[];
  features: string[];
  max_projects: number;
}

interface CommandDef {
  cmd: string;
  icon: LucideIcon;
  label: string;
  desc: string;
}

interface CommandCategory {
  name: string;
  icon: LucideIcon;
  commands: CommandDef[];
}

// === Command Categories ===
const COMMAND_CATEGORIES: CommandCategory[] = [
  {
    name: "AI & Code",
    icon: Code,
    commands: [
      { cmd: "code", icon: Code, label: "Code", desc: "Generate programs" },
      { cmd: "review", icon: MessageSquare, label: "Review", desc: "Code review" },
      { cmd: "test", icon: FlaskConical, label: "Tests", desc: "Generate tests" },
      { cmd: "docs", icon: FileText, label: "Docs", desc: "Generate docs" },
      { cmd: "preview", icon: Play, label: "Preview", desc: "Live preview" },
      { cmd: "template", icon: FileCode, label: "Templates", desc: "Project scaffolds" },
    ],
  },
  {
    name: "Search & Analysis",
    icon: Search,
    commands: [
      { cmd: "search", icon: Search, label: "Search", desc: "AI-powered search" },
      { cmd: "analyze", icon: Eye, label: "Analyze", desc: "Screen analysis" },
      { cmd: "scan", icon: Wifi, label: "Scan", desc: "Network scan" },
      { cmd: "report", icon: BarChart3, label: "Report", desc: "System vitals" },
    ],
  },
  {
    name: "DevOps & Tools",
    icon: TerminalSquare,
    commands: [
      { cmd: "github", icon: GitBranch, label: "GitHub", desc: "Git integration" },
      { cmd: "shell", icon: TerminalSquare, label: "Shell", desc: "Shell assistant" },
      { cmd: "apitest", icon: TestTube2, label: "API Test", desc: "Test APIs" },
      { cmd: "db", icon: Database, label: "Database", desc: "DB management" },
    ],
  },
  {
    name: "Productivity",
    icon: CalendarClock,
    commands: [
      { cmd: "files", icon: FolderOpen, label: "Files", desc: "File management" },
      { cmd: "schedule", icon: CalendarClock, label: "Schedule", desc: "Task scheduling" },
      { cmd: "alert", icon: Bell, label: "Alert", desc: "Set alerts" },
      { cmd: "notify", icon: BellRing, label: "Notify", desc: "Notifications" },
      { cmd: "clip", icon: Clipboard, label: "Clipboard", desc: "Clip manager" },
    ],
  },
  {
    name: "Platform",
    icon: Layers,
    commands: [
      { cmd: "access", icon: Shield, label: "Access", desc: "System access" },
      { cmd: "plugin", icon: Puzzle, label: "Plugins", desc: "Custom plugins" },
      { cmd: "gallery", icon: Image, label: "Gallery", desc: "Project gallery" },
      { cmd: "collab", icon: Users, label: "Collab", desc: "Collaboration" },
      { cmd: "voice", icon: Mic, label: "Voice", desc: "Voice control" },
      { cmd: "mobile", icon: Smartphone, label: "Mobile", desc: "Mobile access" },
    ],
  },
];

const ALL_COMMANDS = COMMAND_CATEGORIES.flatMap((c) => c.commands);

// === Smart Data Renderer ===
function SmartDataView({ data }: { data: Record<string, unknown> }) {
  const renderValue = (key: string, value: unknown): React.ReactNode => {
    if (value === null || value === undefined) return null;

    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-zinc-600 italic">empty</span>;
      if (typeof value[0] === "object" && value[0] !== null) {
        const keys = Object.keys(value[0] as Record<string, unknown>);
        return (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800/60">
                  {keys.map((k) => (
                    <th key={k} className="text-left py-1.5 px-2 text-zinc-500 font-medium uppercase tracking-wider" style={{ fontSize: "0.6rem" }}>
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {value.slice(0, 20).map((row, ri) => (
                  <tr key={ri} className="border-b border-zinc-800/30 hover:bg-zinc-800/20">
                    {keys.map((k) => (
                      <td key={k} className="py-1.5 px-2 text-zinc-300 font-mono" style={{ fontSize: "0.7rem" }}>
                        {String((row as Record<string, unknown>)[k] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {value.length > 20 && (
              <p className="text-xs text-zinc-600 px-2 py-1">...and {value.length - 20} more</p>
            )}
          </div>
        );
      }
      return (
        <div className="flex flex-wrap gap-1 mt-1">
          {value.map((v, i) => (
            <span key={i} className="inline-block px-2 py-0.5 rounded bg-zinc-800/50 text-zinc-400 text-xs font-mono">
              {String(v)}
            </span>
          ))}
        </div>
      );
    }

    if (typeof value === "object") {
      return (
        <div className="mt-1 pl-3 border-l-2 border-zinc-800/40">
          {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
            <div key={k} className="py-0.5">
              <span className="text-zinc-500 text-xs">{k}: </span>
              <span className="text-zinc-300 text-xs font-mono">{String(v)}</span>
            </div>
          ))}
        </div>
      );
    }

    if (typeof value === "boolean") {
      return (
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${value ? "text-emerald-400" : "text-zinc-500"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${value ? "bg-emerald-400" : "bg-zinc-600"}`} />
          {value ? "Yes" : "No"}
        </span>
      );
    }

    if (typeof value === "number") {
      return <span className="text-cyan-400 font-mono text-xs font-medium">{value.toLocaleString()}</span>;
    }

    const strVal = String(value);
    if (strVal.length > 200 || strVal.includes("\n")) {
      return (
        <pre className="mt-1 p-2.5 bg-black/30 rounded-md text-xs font-mono leading-relaxed text-zinc-300 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
          {strVal.slice(0, 2000)}
          {strVal.length > 2000 && "\n...truncated"}
        </pre>
      );
    }

    if (key === "status") {
      const statusColors: Record<string, string> = {
        success: "bg-emerald-500/15 text-emerald-400",
        partial: "bg-yellow-500/15 text-yellow-400",
        error: "bg-red-500/15 text-red-400",
        active: "bg-emerald-500/15 text-emerald-400",
        inactive: "bg-zinc-500/15 text-zinc-400",
        enabled: "bg-emerald-500/15 text-emerald-400",
        disabled: "bg-zinc-500/15 text-zinc-400",
      };
      return (
        <span className={`status-badge ${statusColors[strVal.toLowerCase()] || "bg-zinc-500/15 text-zinc-400"}`}>
          {strVal}
        </span>
      );
    }

    return <span className="text-zinc-300 font-mono text-xs">{strVal}</span>;
  };

  const skipKeys = new Set(["file_contents", "project_name", "tron_quote"]);
  const entries = Object.entries(data).filter(
    ([k, v]) => !skipKeys.has(k) && v !== null && v !== undefined && v !== ""
  );

  if (entries.length === 0) return null;

  return (
    <div className="mt-2.5 data-panel text-xs">
      {entries.map(([key, value]) => {
        const isComplex = Array.isArray(value) || (typeof value === "object" && value !== null);
        return (
          <div key={key} className={`data-row ${isComplex ? "flex-col items-start" : ""}`}>
            <span className="text-zinc-500 shrink-0 capitalize font-medium min-w-[70px]">
              {key.replace(/_/g, " ")}
            </span>
            {renderValue(key, value)}
          </div>
        );
      })}
    </div>
  );
}

// === Auth Screen ===
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
      <div className="w-full max-w-[420px] fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl shadow-orange-500/25 ring-1 ring-orange-400/20">
              <Zap className="w-6 h-6 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-1">
            MCP Grid
          </h1>
          <p className="text-sm text-zinc-500">
            AI-powered command control system
          </p>
        </div>

        {/* Auth Card */}
        <div className="glass-card p-8">
          {/* Tabs */}
          <div className="flex gap-1 mb-7 p-1 rounded-xl bg-black/30">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                mode === "login"
                  ? "bg-white/[0.07] text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <LogIn className="inline w-4 h-4 mr-1.5 -mt-0.5" /> Sign In
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                mode === "signup"
                  ? "bg-white/[0.07] text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <UserPlus className="inline w-4 h-4 mr-1.5 -mt-0.5" /> Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="block text-xs text-zinc-400 mb-2 font-medium">Username</label>
                <input
                  type="text"
                  placeholder="Choose a username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pro-input w-full px-4 py-3 rounded-xl"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-zinc-400 mb-2 font-medium">Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pro-input w-full px-4 py-3 rounded-xl"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-2 font-medium">Password</label>
              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pro-input w-full px-4 py-3 rounded-xl"
                required
              />
            </div>
            {error && (
              <div className="flex items-center gap-2.5 text-red-400 text-sm bg-red-500/10 px-4 py-3 rounded-xl border border-red-500/20">
                <X className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="pro-btn pro-btn-filled w-full py-3 rounded-xl text-sm flex items-center justify-center gap-2 mt-2 font-semibold"
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
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-zinc-800/80" />
            <span className="text-xs text-zinc-600 font-medium">or</span>
            <div className="flex-1 h-px bg-zinc-800/80" />
          </div>

          {/* Guest access */}
          <button
            onClick={() => onAuth("", { id: 0, username: "guest", email: "" })}
            className="pro-btn w-full py-3 rounded-xl text-sm flex items-center justify-center gap-2"
          >
            <UserIcon className="w-4 h-4" />
            Continue as Guest
          </button>
          <p className="text-center text-xs text-zinc-600 mt-3">
            Guest mode does not save project history
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-zinc-700 mt-8">
          Powered by AI &middot; Built on the Grid
        </p>
      </div>
    </div>
  );
}

// === Code File Block ===
function CodeFileBlock({ file, projectName }: { file: { path: string; content: string }; projectName?: string }) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = () => {
    if (projectName) {
      window.open(`${API}/files/${projectName}/${file.path}`, "_blank");
    } else {
      const blob = new Blob([file.content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.path.split("/").pop() || "file.txt";
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const ext = file.path.split(".").pop()?.toLowerCase() || "";
  const langLabel: Record<string, string> = {
    py: "Python", js: "JavaScript", ts: "TypeScript", html: "HTML",
    css: "CSS", json: "JSON", md: "Markdown", rs: "Rust", go: "Go",
    java: "Java", rb: "Ruby", txt: "Text", yaml: "YAML", yml: "YAML",
    toml: "TOML", sh: "Shell", sql: "SQL", jsx: "JSX", tsx: "TSX",
  };

  const langColors: Record<string, string> = {
    py: "text-blue-400", js: "text-yellow-400", ts: "text-blue-400",
    html: "text-orange-400", css: "text-purple-400", json: "text-yellow-300",
    rs: "text-orange-400", go: "text-cyan-400", java: "text-red-400",
    rb: "text-red-400", sql: "text-green-400", sh: "text-green-400",
  };

  return (
    <div className="border-t border-zinc-800/40">
      <div
        className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <File className={`w-3.5 h-3.5 shrink-0 ${langColors[ext] || "text-zinc-500"}`} />
          <span className="text-xs text-zinc-300 font-mono truncate">{file.path}</span>
          {langLabel[ext] && (
            <span className={`shrink-0 px-1.5 py-0.5 rounded bg-zinc-800/40 ${langColors[ext] || "text-zinc-500"}`} style={{ fontSize: "0.6rem" }}>
              {langLabel[ext]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <button
            onClick={(e) => { e.stopPropagation(); copyCode(); }}
            className="p-1.5 rounded-md hover:bg-zinc-700/40 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Copy code"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); downloadFile(); }}
            className="p-1.5 rounded-md hover:bg-zinc-700/40 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Download file"
          >
            <Download className="w-3 h-3" />
          </button>
          {expanded ? <ChevronUp className="w-3 h-3 text-zinc-600" /> : <ChevronDown className="w-3 h-3 text-zinc-600" />}
        </div>
      </div>
      {expanded && (
        <div className="px-3.5 pb-3">
          <pre className="overflow-x-auto max-h-96 overflow-y-auto rounded-lg" style={{ background: "rgba(0,0,0,0.35)" }}>
            <code className="block p-3.5 text-xs font-mono leading-relaxed text-zinc-300 whitespace-pre">
              {file.content}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
}

// === Sidebar Category ===
function SidebarCategory({
  category,
  expanded,
  onToggle,
  onSelectCommand,
}: {
  category: CommandCategory;
  expanded: boolean;
  onToggle: () => void;
  onSelectCommand: (cmd: string) => void;
}) {
  const Icon = category.icon;
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-300 transition-colors group"
      >
        <Icon className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
        <span className="uppercase tracking-wider flex-1 text-left">{category.name}</span>
        <ChevronDown className={`w-3 h-3 text-zinc-700 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="space-y-px pb-1">
          {category.commands.map(({ cmd, icon: CmdIcon, label, desc }) => (
            <button
              key={cmd}
              onClick={() => onSelectCommand(cmd)}
              className="cmd-btn w-full flex items-center gap-2.5 px-4 py-1.5 text-zinc-400 hover:text-white group"
            >
              <CmdIcon className="w-3.5 h-3.5 text-zinc-600 group-hover:text-orange-400 transition-colors" />
              <span className="text-xs font-medium flex-1 text-left">{label}</span>
              <span className="text-xs text-zinc-700 group-hover:text-zinc-500 transition-colors hidden lg:block">{desc}</span>
              <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity text-orange-400" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// === Console Screen ===
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
      text: "MCP Grid initialized. Type a command or click one from the sidebar to begin.",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [usage, setUsage] = useState<{ commands_today: number; commands_limit: number }>({ commands_today: 0, commands_limit: 10 });
  const [currentPlan, setCurrentPlan] = useState("free");
  const [status, setStatus] = useState<"online" | "offline" | "processing">("online");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(COMMAND_CATEGORIES.map((c) => c.name))
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

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

  useEffect(() => {
    fetch(`${API}/billing/plans`)
      .then((r) => r.json())
      .then((data) => {
        if (data.status === "success") setPlans(data.plans);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (token && showBilling) {
      fetch(`${API}/billing/usage`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "success") {
            setCurrentPlan(data.plan);
            setUsage(data.usage);
          }
        })
        .catch(() => {});
    }
  }, [token, showBilling]);

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

  const selectCommand = (cmd: string) => {
    setInput(`${cmd} `);
    document.getElementById("cmd-input")?.focus();
  };

  const toggleCategory = (name: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="h-screen grid-bg flex overflow-hidden">
      {/* Sidebar */}
      <div className={`sidebar flex flex-col shrink-0 transition-all duration-300 ${sidebarCollapsed ? "w-0 overflow-hidden" : "w-64"}`}>
        {/* Logo + Status */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20 ring-1 ring-orange-400/20">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-base font-bold text-white tracking-tight">MCP Grid</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    status === "online"
                      ? "bg-emerald-400 shadow-sm shadow-emerald-400/50"
                      : status === "processing"
                      ? "bg-orange-400 pulse-glow shadow-sm shadow-orange-400/50"
                      : "bg-red-400 shadow-sm shadow-red-400/50"
                  }`}
                />
                <span className="text-xs text-zinc-500">
                  {status === "online" ? "Connected" : status === "processing" ? "Processing" : "Offline"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="h-px mx-4 bg-zinc-800/60" />

        {/* Quick Stats */}
        <div className="px-4 py-3 flex gap-2">
          <div className="flex-1 rounded-lg bg-white/[0.03] px-3 py-2 border border-zinc-800/50">
            <p className="text-xs text-zinc-600 mb-0.5">Commands</p>
            <p className="text-sm font-semibold text-zinc-300">{ALL_COMMANDS.length}</p>
          </div>
          <div className="flex-1 rounded-lg bg-white/[0.03] px-3 py-2 border border-zinc-800/50">
            <p className="text-xs text-zinc-600 mb-0.5">Projects</p>
            <p className="text-sm font-semibold text-zinc-300">{projects.length}</p>
          </div>
        </div>

        <div className="h-px mx-4 bg-zinc-800/60" />

        {/* Command Categories */}
        <div className="flex-1 overflow-y-auto py-2">
          {COMMAND_CATEGORIES.map((cat) => (
            <SidebarCategory
              key={cat.name}
              category={cat}
              expanded={expandedCategories.has(cat.name)}
              onToggle={() => toggleCategory(cat.name)}
              onSelectCommand={selectCommand}
            />
          ))}
        </div>

        <div className="h-px mx-4 bg-zinc-800/60" />

        {/* Bottom Actions */}
        {token && (
          <div className="px-3 py-2 space-y-0.5">
            <button
              onClick={() => { setShowHistory(!showHistory); setShowBilling(false); }}
              className={`cmd-btn w-full flex items-center gap-2.5 px-3 py-2 text-sm group ${
                showHistory ? "text-orange-400 bg-orange-500/8" : "text-zinc-400 hover:text-white"
              }`}
            >
              <History className={`w-4 h-4 ${showHistory ? "text-orange-500" : "text-zinc-600 group-hover:text-orange-500"} transition-colors`} />
              <span className="font-medium text-xs">History</span>
              {projects.length > 0 && (
                <span className="ml-auto status-badge bg-orange-500/15 text-orange-400">{projects.length}</span>
              )}
            </button>
            <button
              onClick={() => { setShowBilling(!showBilling); setShowHistory(false); }}
              className={`cmd-btn w-full flex items-center gap-2.5 px-3 py-2 text-sm group ${
                showBilling ? "text-orange-400 bg-orange-500/8" : "text-zinc-400 hover:text-white"
              }`}
            >
              <CreditCard className={`w-4 h-4 ${showBilling ? "text-orange-500" : "text-zinc-600 group-hover:text-orange-500"} transition-colors`} />
              <span className="font-medium text-xs">Billing</span>
              <span className={`ml-auto status-badge text-xs ${
                currentPlan === "enterprise" ? "bg-purple-500/15 text-purple-400" :
                currentPlan === "pro" ? "bg-orange-500/15 text-orange-400" :
                "bg-zinc-700/50 text-zinc-400"
              }`}>
                {currentPlan === "enterprise" ? "ENT" : currentPlan === "pro" ? "PRO" : "FREE"}
              </span>
            </button>
          </div>
        )}

        <div className="h-px mx-4 bg-zinc-800/60" />

        {/* User */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500/20 to-orange-600/10 flex items-center justify-center border border-orange-500/20">
              <UserIcon className="w-3.5 h-3.5 text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-zinc-200 truncate">
                {user.username.charAt(0).toUpperCase() + user.username.slice(1)}
              </p>
              {user.email && (
                <p className="text-xs text-zinc-600 truncate">{user.email}</p>
              )}
            </div>
            <button
              onClick={onLogout}
              className="text-zinc-600 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-500/10"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex min-w-0">
        {/* Console */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header Bar */}
          <div className="h-12 border-b border-zinc-800/60 flex items-center justify-between px-4 shrink-0" style={{ background: "rgba(14,14,20,0.5)" }}>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="p-1.5 rounded-lg hover:bg-white/[0.05] text-zinc-500 hover:text-zinc-300 transition-colors"
                title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
              >
                {sidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
              </button>
              <div className="h-5 w-px bg-zinc-800/60" />
              <Terminal className="w-4 h-4 text-zinc-600" />
              <span className="text-sm font-medium text-zinc-400">Console</span>
              <span className="text-xs text-zinc-700 font-mono">v2.0</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Activity className={`w-3.5 h-3.5 ${status === "online" ? "text-emerald-500" : status === "processing" ? "text-orange-400 animate-pulse" : "text-red-400"}`} />
                <span className="text-xs text-zinc-500 font-mono">
                  {usage.commands_today}/{usage.commands_limit === -1 ? "\u221e" : usage.commands_limit}
                </span>
              </div>
              <div className="h-5 w-px bg-zinc-800/60" />
              <div className="flex items-center gap-1.5 text-zinc-600 text-xs">
                <Clock className="w-3 h-3" />
                {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className="fade-in group">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    msg.type === "user"
                      ? "bg-emerald-500/10 ring-1 ring-emerald-500/20"
                      : msg.type === "mcp"
                      ? "bg-orange-500/10 ring-1 ring-orange-500/20"
                      : msg.type === "error"
                      ? "bg-red-500/10 ring-1 ring-red-500/20"
                      : "bg-cyan-500/5 ring-1 ring-cyan-500/10"
                  }`}>
                    <span className={`text-xs font-bold ${
                      msg.type === "user" ? "text-emerald-400"
                      : msg.type === "mcp" ? "text-orange-400"
                      : msg.type === "error" ? "text-red-400"
                      : "text-cyan-400/60"
                    }`}>
                      {msg.type === "user" ? "U" : msg.type === "mcp" ? "M" : msg.type === "error" ? "!" : "S"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold ${
                        msg.type === "user" ? "text-emerald-400"
                        : msg.type === "mcp" ? "text-orange-400"
                        : msg.type === "error" ? "text-red-400"
                        : "text-cyan-400/50"
                      }`}>
                        {msg.type === "user" ? "You" : msg.type === "mcp" ? "MCP Grid" : msg.type === "error" ? "Error" : "System"}
                      </span>
                      <span className="text-xs text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                    <p className={`text-sm whitespace-pre-wrap leading-relaxed ${
                      msg.type === "system"
                        ? "text-zinc-500 italic"
                        : msg.type === "error"
                        ? "text-red-300/80"
                        : "text-zinc-300"
                    }`}>
                      {msg.text}
                    </p>

                    {/* Smart Data Rendering */}
                    {msg.data && <SmartDataView data={msg.data} />}

                    {/* Generated Code Files */}
                    {msg.data && Array.isArray(msg.data.file_contents) && (msg.data.file_contents as {path: string; content: string}[]).length > 0 && (
                      <div className="mt-3 rounded-xl overflow-hidden border border-zinc-800/50" style={{ background: "rgba(0,0,0,0.2)" }}>
                        <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-800/40">
                          <span className="text-zinc-300 text-xs font-semibold flex items-center gap-2">
                            <FileCode className="w-3.5 h-3.5 text-orange-400" />
                            Generated Files ({(msg.data.file_contents as {path: string; content: string}[]).length})
                          </span>
                          <div className="flex items-center gap-2">
                            {!!msg.data.project_name && (
                              <button
                                onClick={() => {
                                  window.open(`${API}/files/${String(msg.data!.project_name)}/zip`, "_blank");
                                }}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 text-xs transition-colors font-medium border border-orange-500/20"
                              >
                                <Download className="w-3 h-3" />
                                Download ZIP
                              </button>
                            )}
                          </div>
                        </div>
                        {(msg.data.file_contents as {path: string; content: string}[]).map((file: {path: string; content: string}, fi: number) => (
                          <CodeFileBlock key={fi} file={file} projectName={msg.data?.project_name as string | undefined} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-start gap-3 fade-in">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-orange-500/10 ring-1 ring-orange-500/20 mt-0.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-orange-400 mb-1 block">MCP Grid</span>
                  <span className="text-sm text-zinc-500">Processing your request...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="px-6 py-4 border-t border-zinc-800/60 shrink-0" style={{ background: "rgba(14,14,20,0.3)" }}>
            {/* Quick command chips */}
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
              {["code", "search", "report", "review", "shell", "github"].map((cmd) => {
                const cmdDef = ALL_COMMANDS.find((c) => c.cmd === cmd);
                if (!cmdDef) return null;
                const CmdIcon = cmdDef.icon;
                return (
                  <button
                    key={cmd}
                    onClick={() => selectCommand(cmd)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-zinc-800/50 text-zinc-500 hover:text-orange-400 hover:border-orange-500/20 hover:bg-orange-500/5 text-xs font-medium transition-all shrink-0"
                  >
                    <CmdIcon className="w-3 h-3" />
                    {cmdDef.label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3 items-center">
              <div className="flex-1 relative">
                <ChevronRight className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-500/70" />
                <input
                  id="cmd-input"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a command... (e.g., code a REST API, search for React tutorials)"
                  className="pro-input w-full pl-10 pr-4 py-3 rounded-xl text-sm"
                  disabled={loading}
                  autoFocus
                />
              </div>
              <button
                onClick={() => sendCommand(input)}
                disabled={loading || !input.trim()}
                className="pro-btn pro-btn-filled px-5 py-3 rounded-xl flex items-center gap-2 shrink-0"
              >
                <Send className="w-4 h-4" />
                <span className="text-sm font-semibold hidden sm:inline">Send</span>
              </button>
            </div>
          </div>
        </div>

        {/* Billing Panel */}
        {showBilling && token && (
          <div className="w-96 border-l border-zinc-800/60 flex flex-col shrink-0 slide-in-right" style={{ background: "rgba(14,14,20,0.6)" }}>
            <div className="h-12 border-b border-zinc-800/60 flex items-center justify-between px-5 shrink-0">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-zinc-500" />
                <span className="text-sm font-semibold text-zinc-300">Plans & Billing</span>
              </div>
              <button onClick={() => setShowBilling(false)} className="text-zinc-600 hover:text-zinc-300 transition-colors p-1 rounded-md hover:bg-white/[0.05]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Usage Stats */}
              <div className="rounded-xl p-4 bg-white/[0.03] border border-zinc-800/50">
                <p className="text-xs font-semibold text-zinc-400 mb-3 uppercase tracking-wider">Usage Today</p>
                <div className="flex items-end gap-2 mb-3">
                  <span className="text-3xl font-bold text-white">{usage.commands_today}</span>
                  <span className="text-sm text-zinc-600 mb-1">
                    / {usage.commands_limit === -1 ? "\u221e" : usage.commands_limit} commands
                  </span>
                </div>
                {usage.commands_limit !== -1 && (
                  <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-500"
                      style={{
                        width: `${Math.min(100, (usage.commands_today / usage.commands_limit) * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Plans */}
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Available Plans</p>
              {plans.map((plan) => {
                const isCurrent = plan.id === currentPlan;
                const isUpgrade = !isCurrent && (
                  (currentPlan === "free" && (plan.id === "pro" || plan.id === "enterprise")) ||
                  (currentPlan === "pro" && plan.id === "enterprise")
                );
                return (
                  <div
                    key={plan.id}
                    className={`rounded-xl p-4 transition-all border ${
                      isCurrent
                        ? "border-orange-500/30 bg-orange-500/5 ring-1 ring-orange-500/10"
                        : "border-zinc-800/50 bg-white/[0.02] hover:border-zinc-700/60"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        {plan.id === "enterprise" ? (
                          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                            <Crown className="w-4 h-4 text-purple-400" />
                          </div>
                        ) : plan.id === "pro" ? (
                          <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                            <Sparkles className="w-4 h-4 text-orange-400" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-zinc-700/30 flex items-center justify-center">
                            <Zap className="w-4 h-4 text-zinc-400" />
                          </div>
                        )}
                        <div>
                          <span className="text-sm font-semibold text-white">{plan.name}</span>
                          {isCurrent && (
                            <span className="ml-2 status-badge bg-orange-500/15 text-orange-400">Current</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        {plan.price_monthly === 0 ? (
                          <span className="text-lg font-bold text-zinc-400">Free</span>
                        ) : (
                          <div>
                            <span className="text-lg font-bold text-white">${plan.price_monthly}</span>
                            <span className="text-xs text-zinc-600">/mo</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 mt-3">
                      <div className="flex items-center gap-2.5 text-xs">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-zinc-400">
                          {plan.commands_per_day === -1 ? "Unlimited" : plan.commands_per_day} commands/day
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 text-xs">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-zinc-400">
                          AI: {plan.ai_providers.join(", ")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 text-xs">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-zinc-400">
                          {plan.max_projects === -1 ? "Unlimited" : plan.max_projects} projects
                        </span>
                      </div>
                    </div>

                    {isUpgrade && (
                      <button
                        onClick={async () => {
                          const res = await fetch(`${API}/billing/checkout`, {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${token}`,
                            },
                            body: JSON.stringify({ plan: plan.id, interval: "monthly" }),
                          });
                          const data = await res.json();
                          if (data.checkout_url) {
                            window.open(data.checkout_url, "_blank");
                          } else if (data.message) {
                            setMessages((prev) => [...prev, {
                              type: "system" as const,
                              text: data.message,
                              timestamp: Date.now(),
                            }]);
                          }
                        }}
                        className="mt-4 w-full pro-btn pro-btn-filled py-2.5 rounded-xl flex items-center justify-center gap-2 text-xs font-semibold"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Upgrade to {plan.name}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Project History Panel */}
        {showHistory && token && (
          <div className="w-80 border-l border-zinc-800/60 flex flex-col shrink-0 slide-in-right" style={{ background: "rgba(14,14,20,0.6)" }}>
            <div className="h-12 border-b border-zinc-800/60 flex items-center justify-between px-5 shrink-0">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-zinc-500" />
                <span className="text-sm font-semibold text-zinc-300">Project History</span>
              </div>
              <button onClick={() => setShowHistory(false)} className="text-zinc-600 hover:text-zinc-300 transition-colors p-1 rounded-md hover:bg-white/[0.05]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {projects.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="w-12 h-12 rounded-2xl bg-zinc-800/50 flex items-center justify-center mx-auto mb-4">
                    <FileCode className="w-6 h-6 text-zinc-700" />
                  </div>
                  <p className="text-sm text-zinc-500 mb-1 font-medium">No projects yet</p>
                  <p className="text-xs text-zinc-700">
                    Use the <span className="text-orange-400/70">code</span> command to generate your first project
                  </p>
                </div>
              ) : (
                projects.map((proj) => (
                  <div
                    key={proj.id}
                    className="rounded-xl p-4 text-xs space-y-2.5 border border-zinc-800/50 bg-white/[0.02] hover:border-orange-500/20 hover:bg-orange-500/[0.02] cursor-pointer transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-zinc-200 truncate font-semibold text-sm group-hover:text-orange-400 transition-colors">
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
                    <div className="flex items-center gap-4 text-zinc-600">
                      <span className="flex items-center gap-1.5">
                        <FileCode className="w-3 h-3" />
                        {proj.file_count} files
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Code className="w-3 h-3" />
                        {proj.language}
                      </span>
                    </div>
                    <div className="text-zinc-700 flex items-center gap-1.5">
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

// === Main App ===
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
