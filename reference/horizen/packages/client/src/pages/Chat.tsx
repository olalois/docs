import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentInfo {
  id: string;
  name: string;
  address: string;
  metaAddress: string;
}

interface ChatMessage {
  role: "user" | "agent" | "tool" | "system";
  text: string;
}

interface ToolCall {
  name: string;
  status: string;
  detail?: string;
}

interface ChatResponse {
  response: string;
  toolCalls?: ToolCall[];
  conversationId?: string;
}

interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const LS_SERVER_URL = "wraith_server_url";
const LS_AGENT_ID = "wraith_agent_id";
const LS_WALLET = "wraith_wallet";
const DEFAULT_SERVER_URL = (import.meta.env.VITE_SERVER_URL || "https://98af19e30d6ee5f73c6ea29960a6ebfe95287b97-3000.dstack-pha-prod9.phala.network").replace(/\/+$/, "");

interface CommandParam {
  key: string;
  label: string;
  placeholder: string;
  options?: string[];
}

interface SlashCommand {
  command: string;
  description: string;
  params: CommandParam[];
  buildMessage: (values: Record<string, string>) => string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: "/send",
    description: "Send ETH privately via stealth address",
    params: [
      { key: "recipient", label: "Recipient", placeholder: "alice.wraith or st:eth:..." },
      { key: "amount", label: "Amount (ETH)", placeholder: "0.1" },
    ],
    buildMessage: (v) => `Send ${v.amount} ETH to ${v.recipient}`,
  },
  {
    command: "/scan",
    description: "Scan for incoming stealth payments",
    params: [],
    buildMessage: () => "Scan for incoming stealth payments and show balances",
  },
  {
    command: "/balance",
    description: "Check agent wallet balance",
    params: [],
    buildMessage: () => "What's my current balance?",
  },
  {
    command: "/withdraw",
    description: "Withdraw from stealth address to destination",
    params: [
      { key: "from", label: "From stealth address", placeholder: "0x..." },
      { key: "to", label: "To destination", placeholder: "0x..." },
    ],
    buildMessage: (v) => `Withdraw all funds from stealth address ${v.from} to ${v.to}`,
  },
  {
    command: "/withdraw_all",
    description: "Withdraw from all stealth addresses",
    params: [
      { key: "to", label: "Destination address", placeholder: "0x..." },
    ],
    buildMessage: (v) => `Withdraw all my stealth funds to ${v.to} with maximum privacy`,
  },
  {
    command: "/invoice",
    description: "Create a payment invoice",
    params: [
      { key: "amount", label: "Amount (ETH)", placeholder: "0.1" },
      { key: "memo", label: "Memo", placeholder: "payment for services" },
    ],
    buildMessage: (v) => `Create an invoice for ${v.amount} ETH with memo "${v.memo}"`,
  },
  {
    command: "/invoices",
    description: "Check status of all invoices",
    params: [],
    buildMessage: () => "Check the status of all my invoices. Show which are paid and which are pending.",
  },
  {
    command: "/pay_agent",
    description: "Pay another .wraith agent",
    params: [
      { key: "name", label: "Agent name", placeholder: "oracle" },
      { key: "amount", label: "Amount (ETH)", placeholder: "0.05" },
    ],
    buildMessage: (v) => `Pay ${v.amount} ETH to ${v.name}.wraith`,
  },
  {
    command: "/resolve",
    description: "Look up a .wraith name",
    params: [
      { key: "name", label: "Name", placeholder: "alice" },
    ],
    buildMessage: (v) => `Resolve ${v.name}.wraith`,
  },
  {
    command: "/privacy",
    description: "Get privacy advice for your activity",
    params: [],
    buildMessage: () => "Analyze my stealth address activity and give me privacy recommendations. Check for timing patterns, address reuse, and suggest improvements.",
  },
  {
    command: "/fund",
    description: "Fund agent wallet with testnet ETH",
    params: [],
    buildMessage: () => "Fund my wallet with testnet ETH",
  },
  {
    command: "/info",
    description: "Show agent identity and status",
    params: [],
    buildMessage: () => "Show my full agent info including balance and stealth meta-address",
  },
  {
    command: "/schedule",
    description: "Schedule a recurring payment",
    params: [
      { key: "recipient", label: "Recipient", placeholder: "alice.wraith" },
      { key: "amount", label: "Amount", placeholder: "0.05" },
      { key: "interval", label: "Interval", placeholder: "Choose interval", options: ["daily", "weekly", "monthly"] },
    ],
    buildMessage: (v) => `Schedule a recurring payment of ${v.amount} ETH to ${v.recipient} (${v.interval})`,
  },
  {
    command: "/schedules",
    description: "List scheduled recurring payments",
    params: [],
    buildMessage: () => "List all my scheduled recurring payments",
  },
  {
    command: "/manage_schedule",
    description: "Pause, resume, or cancel a schedule",
    params: [
      { key: "id", label: "Schedule ID", placeholder: "aa67b310" },
      { key: "action", label: "Action", placeholder: "Choose action", options: ["pause", "resume", "cancel"] },
    ],
    buildMessage: (v) => `${v.action} scheduled payment ${v.id}`,
  },
  {
    command: "/agents",
    description: "Browse all registered agents",
    params: [],
    buildMessage: () => "",
  },
  {
    command: "/help",
    description: "Show all available commands",
    params: [],
    buildMessage: () => "",
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function truncateKey(key: string, len = 4): string {
  if (key.length <= len * 2 + 3) return key;
  return `${key.slice(0, len)}...${key.slice(-len)}`;
}

/* ------------------------------------------------------------------ */
/*  Chat Page                                                          */
/* ------------------------------------------------------------------ */

export default function Chat() {
  const { address: wagmiAddress, isConnected: walletIsConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  /* --- state ------------------------------------------------------- */
  const [serverUrl] = useState<string>(DEFAULT_SERVER_URL);
  const [agentId, setAgentId] = useState<string | null>(
    () => localStorage.getItem(LS_AGENT_ID)
  );
  const [walletAddress, setWalletAddress] = useState<string | null>(
    () => localStorage.getItem(LS_WALLET)
  );
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [agentBalance, setAgentBalance] = useState<string>("0");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  const [activeCommand, setActiveCommand] = useState<SlashCommand | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardValues, setWizardValues] = useState<Record<string, string>>({});

  const [notifications, setNotifications] = useState<Array<{ id: number; type: string; title: string; body: string; read: boolean | number; createdAt?: string; created_at?: number }>>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [selectedNotif, setSelectedNotif] = useState<{ id: number; type: string; title: string; body: string; createdAt?: string; created_at?: number } | null>(null);

  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdHistoryIndex, setCmdHistoryIndex] = useState(-1);
  const cmdDraft = useRef("");

  const filteredCommands = showSlashMenu
    ? SLASH_COMMANDS.filter((c) =>
        c.command.startsWith(slashFilter.toLowerCase())
      )
    : [];

  /* --- sync wagmi wallet address ----------------------------------- */
  useEffect(() => {
    if (walletIsConnected && wagmiAddress) {
      setWalletAddress(wagmiAddress);
    } else if (!walletIsConnected) {
      setWalletAddress(null);
      setAgentId(null);
      setAgentInfo(null);
      setIsConnected(false);
      setMessages([]);
      localStorage.removeItem(LS_WALLET);
      localStorage.removeItem(LS_AGENT_ID);
    }
  }, [walletIsConnected, wagmiAddress]);

  /* --- auto-scroll ------------------------------------------------- */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  /* --- persist agent id -------------------------------------------- */
  useEffect(() => {
    if (agentId) {
      localStorage.setItem(LS_AGENT_ID, agentId);
    } else {
      localStorage.removeItem(LS_AGENT_ID);
    }
  }, [agentId]);

  /* --- persist wallet address -------------------------------------- */
  useEffect(() => {
    if (walletAddress) {
      localStorage.setItem(LS_WALLET, walletAddress);
    } else {
      localStorage.removeItem(LS_WALLET);
    }
  }, [walletAddress]);

  /* --- fetch agent status on connect ------------------------------- */
  async function fetchAgentStatus(id: string, info: AgentInfo, cancelled: boolean) {
    try {
      const res = await fetch(`${serverUrl}/agent/${id}/status`);
      if (!res.ok || cancelled) return;
      const status = await res.json();
      if (cancelled) return;
      if (status.balance) setAgentBalance(status.balance);
      setMessages([
        {
          role: "agent",
          text: status.statusMessage || `**${info.name}.wraith** is online.\n**Balance:** ${status.balance || "0"} ETH`,
        },
      ]);
    } catch {
      setMessages([
        {
          role: "system",
          text: `${info.name}.wraith connected. Type / for commands.`,
        },
      ]);
    }
  }

  /* --- on mount: check wallet -> check agent ----------------------- */
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!walletAddress) {
        setInitialLoading(false);
        return;
      }

      if (!agentId) {
        try {
          const res = await fetch(`${serverUrl}/agent/wallet/${walletAddress}`);
          if (res.ok) {
            const data = await res.json();
            if (cancelled) return;
            const info: AgentInfo = {
              id: data.id,
              name: data.name,
              address: data.address,
              metaAddress: data.metaAddress,
            };
            setAgentInfo(info);
            setAgentId(data.id);
            setIsConnected(true);
            await fetchAgentStatus(data.id, info, cancelled);
          }
        } catch {
          // Server unreachable
        }
        if (!cancelled) setInitialLoading(false);
        return;
      }

      try {
        const res = await fetch(`${serverUrl}/agent/${agentId}`);
        if (!res.ok) throw new Error("Agent not found");
        const data = await res.json();
        if (cancelled) return;

        const info: AgentInfo = {
          id: data.id ?? agentId!,
          name: data.name,
          address: data.address,
          metaAddress: data.metaAddress,
        };
        setAgentInfo(info);
        setIsConnected(true);
        await fetchAgentStatus(agentId!, info, cancelled);
      } catch {
        setAgentId(null);
        setAgentInfo(null);
        setIsConnected(false);
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [agentId, walletAddress, serverUrl]);

  /* --- fetch conversations ----------------------------------------- */
  useEffect(() => {
    if (!agentInfo || !agentId) return;
    fetch(`${serverUrl}/agent/${agentId}/conversations`)
      .then(r => r.json())
      .then(convs => setConversations(convs))
      .catch(() => {});
  }, [agentInfo, agentId, serverUrl]);

  /* --- poll notifications ------------------------------------------ */
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    async function fetchNotifs() {
      try {
        const res = await fetch(`${serverUrl}/agent/${agentId}/notifications`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      } catch {
        // ignore
      }
    }

    fetchNotifs();
    const interval = setInterval(fetchNotifs, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [agentId, serverUrl]);

  /* --- mark notifications read ------------------------------------ */
  async function markNotifsRead() {
    if (!agentId || unreadCount === 0) return;
    try {
      await fetch(`${serverUrl}/agent/${agentId}/notifications/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
    } catch {
      // ignore
    }
  }

  /* --- guided tour trigger ---------------------------------------- */
  useEffect(() => {
    if (!agentInfo) return;
    const tourKey = `wraith_tour_done_${agentInfo.id}`;
    if (!localStorage.getItem(tourKey)) {
      setShowTour(true);
    }
  }, [agentInfo]);

  function dismissTour() {
    if (agentInfo) {
      localStorage.setItem(`wraith_tour_done_${agentInfo.id}`, "1");
    }
    setShowTour(false);
    setTourStep(0);
  }

  /* --- load conversation ------------------------------------------- */
  async function loadConversation(convId: string) {
    setActiveConvId(convId);
    try {
      const res = await fetch(`${serverUrl}/agent/${agentId}/conversations/${convId}/messages`);
      const msgs = await res.json();
      setMessages(msgs.map((m: any) => ({ role: m.role, text: m.text })));
    } catch {
      setMessages([]);
    }
  }

  /* --- new chat ---------------------------------------------------- */
  function handleNewChat() {
    setActiveConvId(null);
    setMessages([{
      role: "system",
      text: `${agentInfo?.name}.wraith ready. Type / for commands.`,
    }]);
  }

  /* --- delete conversation ----------------------------------------- */
  async function handleDeleteConv(convId: string) {
    try {
      await fetch(`${serverUrl}/agent/${agentId}/conversations/${convId}`, {
        method: "DELETE",
      });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConvId === convId) {
        handleNewChat();
      }
    } catch {
      // ignore
    }
  }

  /* --- create agent ------------------------------------------------ */
  async function handleCreate() {
    const name = nameInput.trim().toLowerCase();
    if (!name || !walletAddress) return;

    setIsCreating(true);
    setCreateError(null);

    try {
      const message = `I am creating a Wraith agent named "${name}.wraith" and I confirm that I own this wallet.`;
      const signature = await signMessageAsync({ message });
      if (!signature) {
        throw new Error("Wallet signature required to create an agent.");
      }

      const res = await fetch(`${serverUrl}/agent/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ownerWallet: walletAddress, signature, message }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Server error" }));
        throw new Error(err.error || err.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const info: AgentInfo = {
        id: data.id,
        name: data.name,
        address: data.address,
        metaAddress: data.metaAddress,
      };

      setAgentInfo(info);
      setAgentId(data.id);
      setIsConnected(true);
      setMessages([
        {
          role: "system",
          text: `Agent ${info.name}.wraith created.\nAddress: ${truncateKey(info.address)}\nReady to assist.`,
        },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create agent";
      setCreateError(msg);
    } finally {
      setIsCreating(false);
    }
  }

  /* --- select slash command ----------------------------------------- */
  function selectCommand(cmd: SlashCommand) {
    setShowSlashMenu(false);
    setInput("");

    if (cmd.command === "/help") {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          text: SLASH_COMMANDS.filter((c) => c.command !== "/help" && c.command !== "/agents")
            .map((c) => `${c.command} — ${c.description}`).join("\n"),
        },
      ]);
      return;
    }

    if (cmd.command === "/agents") {
      window.open("/agents", "_blank");
      return;
    }

    if (cmd.params.length === 0) {
      const msg = cmd.buildMessage({});
      setInput(msg);
      setTimeout(() => handleSendMessage(msg), 0);
      return;
    }

    setActiveCommand(cmd);
    setWizardStep(0);
    setWizardValues({});
    setInput("");
  }

  function handleWizardInput() {
    if (!activeCommand) return;
    const val = input.trim();
    if (!val) return;

    const param = activeCommand.params[wizardStep];
    const newValues = { ...wizardValues, [param.key]: val };
    setWizardValues(newValues);
    setInput("");

    if (wizardStep + 1 < activeCommand.params.length) {
      setWizardStep(wizardStep + 1);
    } else {
      const msg = activeCommand.buildMessage(newValues);
      setActiveCommand(null);
      setWizardStep(0);
      setWizardValues({});
      handleSendMessage(msg);
    }
  }

  /* --- send message ------------------------------------------------ */
  function handleSendMessage(text: string) {
    if (!text || isLoading || !agentId) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    setCmdHistory((prev) => [...prev, trimmed]);
    setCmdHistoryIndex(-1);
    cmdDraft.current = "";

    const userMsg: ChatMessage = { role: "user", text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    sendToServer(trimmed);
  }

  async function handleSend() {
    if (activeCommand) {
      handleWizardInput();
      return;
    }
    const text = input.trim();
    if (!text || isLoading || !agentId) return;
    handleSendMessage(text);
  }

  async function sendToServer(text: string) {
    try {
      const history = messages
        .filter((m) => m.role === "user" || m.role === "agent")
        .map((m) => ({
          role: m.role === "user" ? "user" : "model",
          text: m.text,
        }));

      const res = await fetch(`${serverUrl}/agent/${agentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, conversationId: activeConvId, clientOrigin: window.location.origin }),
      });

      if (!res.ok) {
        throw new Error(`Server error (${res.status})`);
      }

      const data: ChatResponse = await res.json();

      if (data.toolCalls && data.toolCalls.length > 0) {
        const toolMessages: ChatMessage[] = data.toolCalls.map((tc) => ({
          role: "tool" as const,
          text: `${tc.name}\n${tc.detail || tc.status}`,
        }));
        setMessages((prev) => [...prev, ...toolMessages]);
      }

      setMessages((prev) => [...prev, { role: "agent", text: data.response }]);
      setIsConnected(true);

      if (data.conversationId) {
        setActiveConvId(data.conversationId);
        fetch(`${serverUrl}/agent/${agentId}/conversations`)
          .then(r => r.json())
          .then(convs => setConversations(convs))
          .catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        { role: "system", text: `Error: ${msg}. Check server connection.` },
      ]);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  /* --- key handler ------------------------------------------------- */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    if (e.key === "ArrowUp" && cmdHistory.length > 0) {
      e.preventDefault();
      if (cmdHistoryIndex === -1) {
        cmdDraft.current = input;
      }
      const newIndex = cmdHistoryIndex === -1
        ? cmdHistory.length - 1
        : Math.max(0, cmdHistoryIndex - 1);
      setCmdHistoryIndex(newIndex);
      setInput(cmdHistory[newIndex]);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cmdHistoryIndex === -1) return;
      const newIndex = cmdHistoryIndex + 1;
      if (newIndex >= cmdHistory.length) {
        setCmdHistoryIndex(-1);
        setInput(cmdDraft.current);
      } else {
        setCmdHistoryIndex(newIndex);
        setInput(cmdHistory[newIndex]);
      }
      return;
    }
  }

  /* --- disconnect / reset ------------------------------------------ */
  function handleDisconnect() {
    setAgentId(null);
    setAgentInfo(null);
    setMessages([]);
    setIsConnected(false);
    setWalletAddress(null);
    localStorage.removeItem(LS_WALLET);
    localStorage.removeItem(LS_AGENT_ID);
  }

  /* --- loading screen ---------------------------------------------- */
  if (initialLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface">
        <div className="text-center">
          <img src="/logo.png" alt="Wraith" className="h-14 mx-auto mb-4 opacity-80" />
          <div className="flex items-center justify-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots"
              style={{ animationDelay: "0s" }}
            />
            <span
              className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots"
              style={{ animationDelay: "0.2s" }}
            />
            <span
              className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots"
              style={{ animationDelay: "0.4s" }}
            />
          </div>
        </div>
      </div>
    );
  }

  /* --- wallet connect screen --------------------------------------- */
  if (!walletAddress) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest">
        <div className="w-full max-w-[480px] px-6">
          <div className="mb-12">
            <div className="flex items-center gap-2 mb-8">
              <img src="/logo.png" alt="Wraith" className="h-8 opacity-80" />
              <span className="font-headline text-lg font-bold tracking-widest text-primary">WRAITH</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-headline font-black text-on-surface uppercase tracking-tighter leading-[0.95] mb-4">
              Connect<br /><span className="text-primary">Your Wallet</span>
            </h1>
            <p className="text-on-surface-variant leading-relaxed">
              Sign in with your EVM wallet to create or access your private AI agent.
            </p>
          </div>

          <ConnectButton.Custom>
            {({ openConnectModal, mounted }) => {
              if (!mounted) return null;
              return (
                <button
                  onClick={openConnectModal}
                  className="w-full bg-white text-surface py-5 px-6 font-headline font-bold text-lg uppercase tracking-[0.2em] transition-all hover:neon-glow"
                >
                  Connect Wallet
                </button>
              );
            }}
          </ConnectButton.Custom>

          <p className="text-[10px] text-outline-variant mt-6 text-center font-mono">
            SECURED BY PHALA TEE — KEYS NEVER STORED
          </p>
        </div>
      </div>
    );
  }

  /* --- creation screen --------------------------------------------- */
  if (!agentInfo) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest">
        <div className="w-full max-w-[480px] px-6">
          <div className="mb-12">
            <div className="flex items-center gap-2 mb-8">
              <img src="/logo.png" alt="Wraith" className="h-8 opacity-80" />
              <span className="font-headline text-lg font-bold tracking-widest text-primary">WRAITH</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-headline font-black text-on-surface uppercase tracking-tighter leading-[0.95] mb-4">
              Create<br /><span className="text-primary">Your Agent</span>
            </h1>
            <p className="text-on-surface-variant leading-relaxed">
              Your agent gets its own wallet, stealth identity, and .wraith name.
            </p>
            <p className="text-sm text-outline mt-3 font-mono">
              WALLET: {truncateKey(walletAddress, 6)}
            </p>
          </div>

          <div className="mb-6">
            <div className="flex items-center bg-surface-container-low border-b-2 border-outline-variant focus-within:border-white transition-colors">
              <span className="pl-4 font-mono text-sm text-outline select-none">$</span>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => {
                  setNameInput(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""));
                  setCreateError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                placeholder="choose a name"
                className="flex-1 bg-transparent px-3 py-4 text-lg text-on-surface placeholder:text-outline-variant outline-none font-mono"
                disabled={isCreating}
              />
              <span className="pr-4 text-lg text-outline select-none font-mono">
                .wraith
              </span>
            </div>
          </div>

          {createError && (
            <div className="mb-6 px-4 py-3 bg-error-container/20 border-l-2 border-error text-sm text-error animate-fade-in">
              {createError}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={isCreating || !nameInput.trim()}
            className="w-full bg-white text-surface py-5 px-6 font-headline font-bold text-lg uppercase tracking-[0.2em] transition-all hover:neon-glow disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isCreating ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block h-1.5 w-1.5 bg-surface animate-pulse-dots" style={{ animationDelay: "0s" }} />
                <span className="inline-block h-1.5 w-1.5 bg-surface animate-pulse-dots" style={{ animationDelay: "0.2s" }} />
                <span className="inline-block h-1.5 w-1.5 bg-surface animate-pulse-dots" style={{ animationDelay: "0.4s" }} />
              </span>
            ) : (
              "Create Agent"
            )}
          </button>

          <div className="mt-8 space-y-2 text-body-sm text-outline">
            <p className="text-on-surface-variant mb-3">This will:</p>
            <ul className="space-y-1.5">
              <li className="flex items-start gap-2">
                <span className="text-on-surface-variant mt-0.5">&#8226;</span>
                <span>Generate an EVM wallet</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-on-surface-variant mt-0.5">&#8226;</span>
                <span>Derive stealth keys</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-on-surface-variant mt-0.5">&#8226;</span>
                <span>Register your .wraith name</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-on-surface-variant mt-0.5">&#8226;</span>
                <span>Fund with testnet ETH</span>
              </li>
            </ul>
          </div>

          <div className="mt-10 border-t border-outline-variant pt-4 flex justify-end">
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-2 text-label-sm text-outline hover:text-error transition-colors"
            >
              <DisconnectIcon />
              <span>Disconnect</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* --- chat screen ------------------------------------------------- */
  return (
    <div className="flex h-screen w-screen bg-surface-container-lowest">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {sidebarOpen && (
        <aside className="fixed z-40 top-0 left-0 h-full w-[260px] border-r border-outline-variant/10 bg-surface flex flex-col lg:relative lg:z-auto">
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center gap-3 mb-1">
              <img src="/logo.png" alt="Wraith" className="h-6 opacity-80" />
              <span className="font-headline text-lg font-black tracking-widest text-primary">WRAITH</span>
            </div>
            <span className="font-mono text-[10px] text-outline tracking-[0.05em]">Private Agents</span>
          </div>

          <div className="px-4 pb-3">
            <button
              onClick={() => { handleNewChat(); if (window.innerWidth < 1024) setSidebarOpen(false); }}
              className="w-full py-3 px-4 font-headline text-xs uppercase tracking-widest text-on-surface border border-outline hover:border-white hover:bg-surface-bright transition-all text-left"
            >
              + NEW CHAT
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center transition-all ${
                  conv.id === activeConvId
                    ? "bg-surface-bright text-white border-l-2 border-white"
                    : "text-outline hover:bg-surface-container-high hover:text-on-surface-variant border-l-2 border-transparent"
                }`}
              >
                <button
                  onClick={() => { loadConversation(conv.id); if (window.innerWidth < 1024) setSidebarOpen(false); }}
                  className="flex-1 text-left px-4 py-3 text-sm truncate"
                >
                  {conv.title}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteConv(conv.id);
                  }}
                  className="hidden group-hover:flex flex-shrink-0 px-2 py-1 mr-2 text-outline hover:text-error transition-colors"
                  title="Delete conversation"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                  </svg>
                </button>
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="px-3 py-4 text-xs text-outline-variant">No conversations yet</p>
            )}
          </div>

          <div className="flex-shrink-0 border-t border-outline-variant/10 px-2 py-3 flex items-center justify-around">
            <a
              href="/agents"
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1 px-3 py-2 text-outline hover:text-on-surface transition-colors"
              title="Browse Agents"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="9" cy="7" r="4" /><path d="M1 21v-2a4 4 0 014-4h8a4 4 0 014 4v2" /><path d="M16 3.13a4 4 0 010 7.75" /><path d="M21 21v-2a4 4 0 00-3-3.87" />
              </svg>
              <span className="text-[9px] font-mono uppercase">Explore</span>
            </a>
            {agentInfo && (
              <a
                href={`/agent/${agentInfo.name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1 px-3 py-2 text-outline hover:text-on-surface transition-colors"
                title="My Profile"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
                <span className="text-[9px] font-mono uppercase">Profile</span>
              </a>
            )}
            <button
              onClick={() => { setSettingsOpen(true); setExportedKey(null); }}
              className="flex flex-col items-center gap-1 px-3 py-2 text-outline hover:text-on-surface transition-colors"
              title="Settings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" />
              </svg>
              <span className="text-[9px] font-mono uppercase">Settings</span>
            </button>
          </div>
        </aside>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="bg-surface-container border border-outline-variant/30 w-full max-w-md mx-4 p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-headline text-lg font-bold text-primary uppercase tracking-tight">Settings</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-outline hover:text-on-surface text-sm"
              >
                ✕
              </button>
            </div>

            <div>
              <h3 className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant mb-2">Agent Details</h3>
              <div className="space-y-1.5 text-xs text-outline font-mono">
                <p>Name: <span className="text-on-surface">{agentInfo?.name}.wraith</span></p>
                <p>Address: <span className="text-on-surface font-mono text-[10px] break-all">{agentInfo?.address}</span></p>
                <p>Meta-Address: <span className="text-on-surface font-mono text-[10px] break-all">{agentInfo?.metaAddress?.slice(0, 30)}...</span></p>
                <p>Owner Wallet: <span className="text-on-surface">{truncateKey(walletAddress, 6)}</span></p>
                <p>Network: <span className="text-on-surface">Horizen Testnet</span></p>
              </div>
            </div>

            <div className="border-t border-outline-variant pt-4">
              <h3 className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant mb-2">Export Secret Key</h3>
              <p className="text-[10px] text-outline-variant mb-3">Back up your agent's wallet. Keep this secret — anyone with this key controls the wallet.</p>
              {!exportedKey ? (
                <button
                  onClick={async () => {
                    setExportLoading(true);
                    try {
                      const exportMsg = `Export private key for agent ${agentId}`;
                      const sig = await signMessageAsync({ message: exportMsg });
                      const res = await fetch(`${serverUrl}/agent/${agentId}/export`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ signature: sig, message: exportMsg }),
                      });
                      const data = await res.json();
                      if (data.secret) setExportedKey(data.secret);
                      else if (data.message) setCreateError(data.message);
                    } catch {}
                    setExportLoading(false);
                  }}
                  disabled={exportLoading}
                  className="text-xs py-2 px-4 border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-bright transition-colors disabled:opacity-30"
                >
                  {exportLoading ? "..." : "Reveal Secret Key"}
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="bg-surface-container-lowest border border-error/20 p-3 font-mono">
                    <p className="text-[9px] uppercase tracking-widest text-error mb-1.5 font-headline font-bold">Sensitive — do not share</p>
                    <code className="text-[10px] text-on-surface break-all font-mono leading-relaxed">{exportedKey}</code>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(exportedKey)}
                    className="text-[10px] text-outline hover:text-on-surface transition-colors"
                  >
                    Copy to clipboard
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-outline-variant pt-4">
              <button
                onClick={handleDisconnect}
                className="text-xs py-2 px-4 border border-error/30 text-error hover:bg-error/10 transition-colors"
              >
                Disconnect Agent
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="flex-shrink-0 h-14 bg-surface-container-lowest border-b border-outline-variant/10">
          <div className="flex items-center justify-between px-6 h-full">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-1 text-outline hover:text-on-surface transition-colors"
                title="Toggle sidebar"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="1" y="3" width="14" height="1.5" />
                  <rect x="1" y="7.25" width="14" height="1.5" />
                  <rect x="1" y="11.5" width="14" height="1.5" />
                </svg>
              </button>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 ${isConnected ? "bg-tertiary animate-pulse" : "bg-outline"}`} />
                <span className="font-headline text-sm font-bold text-on-surface tracking-wide">
                  {agentInfo.name}.wraith
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-outline hidden md:block">
                {truncateKey(walletAddress, 4)}
              </span>

              {/* Notifications */}
              <div className="relative">
                <button
                  onClick={() => {
                    setNotifOpen(!notifOpen);
                    if (!notifOpen && unreadCount > 0) markNotifsRead();
                  }}
                  className="p-1 text-outline hover:text-on-surface-variant transition-colors relative"
                  title="Notifications"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 1.5A4.5 4.5 0 003.5 6v2.5l-1 2h11l-1-2V6A4.5 4.5 0 008 1.5zM6.5 12a1.5 1.5 0 003 0h-3z"/>
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 bg-red-500 text-white text-[8px] font-bold flex items-center justify-center rounded-full">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>

                {/* Notification dropdown */}
                {notifOpen && (
                  <div className="absolute right-0 top-full mt-2 w-80 bg-surface-container border border-outline-variant/30 shadow-xl z-50 max-h-80 overflow-y-auto">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-outline-variant/30">
                      <span className="text-xs text-on-surface-variant font-bold uppercase tracking-wider">Notifications</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={() => markNotifsRead()}
                          className="text-[10px] text-outline hover:text-on-surface-variant"
                        >
                          Mark all as read
                        </button>
                      )}
                    </div>
                    {notifications.length === 0 ? (
                      <p className="px-3 py-6 text-xs text-outline-variant text-center">No notifications yet</p>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => {
                            setSelectedNotif(n);
                            setNotifOpen(false);
                            if (!n.read) {
                              setNotifications((prev) => prev.map((p) => p.id === n.id ? { ...p, read: 1 } : p));
                              setUnreadCount((c) => Math.max(0, c - 1));
                              fetch(`${serverUrl}/agent/${agentId}/notifications/read`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({}),
                              }).catch(() => {});
                            }
                          }}
                          className={`w-full text-left px-3 py-2.5 border-b border-outline-variant/10 hover:bg-surface-container-low transition-colors ${
                            n.read ? "opacity-60" : ""
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`h-1.5 w-1.5 flex-shrink-0 ${
                              n.type === "invoice_paid" ? "bg-tertiary" :
                              n.type === "payment_sent" ? "bg-blue-400" :
                              n.type === "payment_received" ? "bg-green-400" :
                              n.type === "withdrawal" ? "bg-yellow-400" :
                              n.type === "privacy_alert" ? "bg-red-400" :
                              n.type === "scheduled_payment" ? "bg-purple-400" :
                              "bg-outline"
                            }`} />
                            <span className="text-xs font-bold text-on-surface-variant">{n.title}</span>
                          </div>
                          <p className="text-[11px] text-outline ml-3.5 truncate">{n.body}</p>
                          <p className="text-[9px] text-outline-variant ml-3.5 mt-1">
                            {new Date(n.createdAt || (n.created_at ? n.created_at * 1000 : 0)).toLocaleString()}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
                className="p-1 text-outline hover:text-on-surface transition-colors hidden xl:block"
                title="Agent details"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="0" /><path d="M15 3v18" />
                </svg>
              </button>
            </div>
          </div>

        </header>

        {/* Messages */}
        <main className="flex-1 overflow-y-auto px-8 py-8 space-y-8">
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex items-start gap-3 animate-fade-in">
              <div className="bg-surface-container border border-outline-variant/30 px-4 py-3">
                <div className="flex items-center gap-1">
                  <span
                    className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots"
                    style={{ animationDelay: "0s" }}
                  />
                  <span
                    className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots"
                    style={{ animationDelay: "0.2s" }}
                  />
                  <span
                    className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots"
                    style={{ animationDelay: "0.4s" }}
                  />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </main>

        {/* Input bar */}
        <footer className="flex-shrink-0 bg-surface relative">
          {/* Slash command menu */}
          {showSlashMenu && filteredCommands.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 bg-surface-container-high border border-outline-variant/30 max-h-64 overflow-y-auto shadow-2xl" id="slash-menu">
              {filteredCommands.map((cmd, i) => (
                <button
                  key={cmd.command}
                  ref={(el) => { if (i === slashIndex && el) el.scrollIntoView({ block: "nearest" }); }}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-all ${
                    i === slashIndex
                      ? "bg-surface-bright border-l-2 border-primary"
                      : "hover:bg-surface-bright border-l-2 border-transparent"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectCommand(cmd);
                    inputRef.current?.focus();
                  }}
                >
                  <span className="font-mono text-sm text-primary">{cmd.command}</span>
                  <span className="text-xs text-outline">{cmd.description}</span>
                </button>
              ))}
            </div>
          )}

          {/* Wizard progress bar */}
          {activeCommand && (
            <div className="border-b border-outline-variant bg-surface-container-low">
              <div className="flex items-center gap-2 px-4 py-2">
                <span className="text-xs font-headline text-primary uppercase tracking-widest">
                  {activeCommand.command}
                </span>
                <span className="text-xs text-outline">{"\u2014"}</span>
                {activeCommand.params.map((p, i) => (
                  <span
                    key={p.key}
                    className={`text-xs font-headline ${
                      i < wizardStep
                        ? "text-primary"
                        : i === wizardStep
                        ? "text-on-surface"
                        : "text-outline-variant"
                    }`}
                  >
                    {i < wizardStep ? `${p.label}: ${wizardValues[p.key]}` : p.label}
                    {i < activeCommand.params.length - 1 && (
                      <span className="text-outline-variant mx-1">{"\u2192"}</span>
                    )}
                  </span>
                ))}
                <button
                  onClick={() => {
                    setActiveCommand(null);
                    setWizardStep(0);
                    setWizardValues({});
                    setInput("");
                  }}
                  className="ml-auto text-xs text-outline hover:text-on-surface"
                >
                  esc
                </button>
              </div>
              {/* Option buttons when current step has options */}
              {activeCommand.params[wizardStep]?.options && (
                <div className="flex gap-2 px-4 pb-2">
                  {activeCommand.params[wizardStep].options!.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => {
                        const param = activeCommand.params[wizardStep];
                        const newValues = { ...wizardValues, [param.key]: opt };
                        setWizardValues(newValues);
                        setInput("");

                        if (wizardStep + 1 < activeCommand.params.length) {
                          setWizardStep(wizardStep + 1);
                        } else {
                          const msg = activeCommand.buildMessage(newValues);
                          setActiveCommand(null);
                          setWizardStep(0);
                          setWizardValues({});
                          handleSendMessage(msg);
                        }
                      }}
                      className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider border border-outline-variant text-on-surface-variant hover:bg-surface-bright hover:text-on-surface transition-colors"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={`flex items-center gap-3 px-6 py-4${activeCommand?.params[wizardStep]?.options ? " hidden" : ""}`}>
            <span className="font-mono text-sm text-outline select-none">$</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);
                if (val.startsWith("/")) {
                  setShowSlashMenu(true);
                  setSlashFilter(val);
                  setSlashIndex(0);
                } else {
                  setShowSlashMenu(false);
                }
              }}
              onKeyDown={(e) => {
                if (showSlashMenu && filteredCommands.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex((i) => Math.max(i - 1, 0));
                    return;
                  }
                  if (e.key === "Tab" || (e.key === "Enter" && showSlashMenu)) {
                    e.preventDefault();
                    selectCommand(filteredCommands[slashIndex]);
                    return;
                  }
                  if (e.key === "Escape") {
                    setShowSlashMenu(false);
                    return;
                  }
                }
                if (e.key === "Escape" && activeCommand) {
                  setActiveCommand(null);
                  setWizardStep(0);
                  setWizardValues({});
                  setInput("");
                  return;
                }
                handleKeyDown(e);
              }}
              onBlur={() => setTimeout(() => setShowSlashMenu(false), 150)}
              placeholder={
                activeCommand
                  ? `${activeCommand.params[wizardStep]?.label}: ${activeCommand.params[wizardStep]?.placeholder}`
                  : "Message your agent... (type / for commands)"
              }
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-outline-variant outline-none disabled:opacity-50 font-body"
              autoFocus
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="bg-white text-surface px-5 py-2 font-label text-label-lg uppercase tracking-wider transition-all hover:neon-glow disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </footer>
      </div>

      {/* Right sidebar — Agent details */}
      {rightSidebarOpen && agentInfo && (
        <aside className="hidden xl:flex w-[320px] flex-shrink-0 border-l border-outline-variant/10 bg-surface flex-col">
          <div className="p-6 border-b border-outline-variant/10">
            <div className="flex items-center justify-between mb-4">
              <span className="font-headline text-xs uppercase tracking-widest text-outline">Agent Identity</span>
              <button onClick={() => setRightSidebarOpen(false)} className="text-outline hover:text-on-surface transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-surface-container-high flex items-center justify-center p-2">
                <img src="/logo.png" alt="W" className="w-full h-full object-contain opacity-80" />
              </div>
              <div>
                <p className="font-headline text-sm font-bold text-on-surface">{agentInfo.name}.wraith</p>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 ${isConnected ? "bg-tertiary" : "bg-outline"}`} />
                  <span className="font-mono text-[10px] text-outline">{isConnected ? "ONLINE" : "OFFLINE"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Balance */}
          <div className="px-6 py-4 border-b border-outline-variant/10">
            <span className="font-mono text-[10px] text-outline uppercase tracking-wider block mb-2">Balance</span>
            <p className="font-mono text-2xl font-medium text-on-surface">
              {parseFloat(agentBalance).toLocaleString(undefined, { maximumFractionDigits: 6 })}
              <span className="text-sm text-outline ml-2">ETH</span>
            </p>
          </div>

          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            <div>
              <span className="font-mono text-[10px] text-outline uppercase tracking-wider block mb-1">Address</span>
              <p className="font-mono text-xs text-on-surface-variant break-all bg-surface-container-low px-3 py-2 hover:bg-surface-bright transition-colors cursor-pointer"
                onClick={() => navigator.clipboard.writeText(agentInfo.address)}
                title="Click to copy"
              >
                {agentInfo.address}
              </p>
            </div>
            <div>
              <span className="font-mono text-[10px] text-outline uppercase tracking-wider block mb-1">Meta Address</span>
              <p className="font-mono text-[10px] text-on-surface-variant break-all bg-surface-container-low px-3 py-2 hover:bg-surface-bright transition-colors cursor-pointer"
                onClick={() => navigator.clipboard.writeText(agentInfo.metaAddress)}
                title="Click to copy"
              >
                {truncateKey(agentInfo.metaAddress, 16)}
              </p>
            </div>
            <div>
              <span className="font-mono text-[10px] text-outline uppercase tracking-wider block mb-1">Network</span>
              <p className="font-mono text-xs text-tertiary">Horizen Testnet</p>
            </div>
          </div>

          <div className="p-4 border-t border-outline-variant/10 space-y-2">
            <a
              href={`/agent/${agentInfo.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-2.5 text-center border border-outline text-on-surface-variant text-xs font-mono uppercase tracking-wider hover:bg-surface-bright transition-colors"
            >
              View Profile
            </a>
            <button
              onClick={handleDisconnect}
              className="w-full py-2.5 text-center border border-error/30 text-error text-xs font-mono uppercase tracking-wider hover:bg-error/10 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </aside>
      )}

      {/* Close notif dropdown when clicking outside */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setNotifOpen(false)}
        />
      )}

      {/* Notification detail modal */}
      {selectedNotif && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setSelectedNotif(null)}>
          <div className="bg-surface-container border border-outline-variant/30 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 flex-shrink-0 ${
                  selectedNotif.type === "invoice_paid" ? "bg-tertiary" :
                  selectedNotif.type === "payment_sent" ? "bg-blue-400" :
                  selectedNotif.type === "payment_received" ? "bg-green-400" :
                  selectedNotif.type === "withdrawal" ? "bg-yellow-400" :
                  selectedNotif.type === "privacy_alert" ? "bg-red-400" :
                  selectedNotif.type === "scheduled_payment" ? "bg-purple-400" :
                  "bg-outline"
                }`} />
                <h3 className="text-sm font-bold text-on-surface">{selectedNotif.title}</h3>
              </div>
              <button
                onClick={() => setSelectedNotif(null)}
                className="text-outline hover:text-on-surface-variant transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <path d="M4.05 3.05a.7.7 0 01.99 0L7 4.94l1.96-1.89a.7.7 0 01.99.99L8.06 6l1.89 1.96a.7.7 0 01-.99.99L7 7.06 5.04 8.95a.7.7 0 01-.99-.99L5.94 6 4.05 4.04a.7.7 0 010-.99z"/>
                </svg>
              </button>
            </div>
            <div className="px-5 pb-4">
              <div className="text-sm text-on-surface-variant whitespace-pre-wrap break-words prose-wraith">
                <ReactMarkdown components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{selectedNotif.body}</ReactMarkdown>
              </div>
              <p className="text-[10px] text-outline-variant mt-3">
                {new Date(selectedNotif.createdAt || (selectedNotif.created_at ? selectedNotif.created_at * 1000 : 0)).toLocaleString()}
              </p>
              <p className="text-[10px] text-outline-variant mt-1 uppercase tracking-wider">
                {selectedNotif.type.replace(/_/g, " ")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Guided Tour Overlay */}
      {showTour && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-surface-container border border-outline-variant/30 w-full max-w-lg">
            {/* Tour header */}
            <div className="flex items-center gap-3 px-6 pt-6 pb-4">
              <img src="/logo.png" alt="Wraith" className="h-10 opacity-80" />
              <div>
                <h2 className="text-lg font-headline font-bold text-on-surface">
                  Welcome to Wraith
                </h2>
                <p className="text-xs text-outline">Your private AI agent on Horizen</p>
              </div>
            </div>

            {/* Tour steps */}
            <div className="px-6 py-4 min-h-[200px]">
              {tourStep === 0 && (
                <div className="space-y-4 animate-fade-in">
                  <p className="text-sm text-on-surface-variant">
                    Your agent <span className="text-on-surface font-bold">{agentInfo?.name}.wraith</span> is ready.
                    It has its own EVM wallet and stealth identity.
                  </p>
                  <div className="space-y-2 text-xs text-outline">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 bg-tertiary flex-shrink-0" />
                      <span>Private wallet with stealth payment capabilities</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 bg-tertiary flex-shrink-0" />
                      <span>On-chain .wraith name for receiving payments</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 bg-tertiary flex-shrink-0" />
                      <span>AI-powered — just chat naturally</span>
                    </div>
                  </div>
                </div>
              )}

              {tourStep === 1 && (
                <div className="space-y-4 animate-fade-in">
                  <p className="text-sm text-on-surface-variant font-bold">What your agent can do:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { icon: "↗", label: "Send payments", desc: "Private stealth payments" },
                      { icon: "↙", label: "Receive payments", desc: "Scan incoming transfers" },
                      { icon: "📄", label: "Create invoices", desc: "Shareable payment links" },
                      { icon: "💰", label: "Withdraw funds", desc: "From stealth addresses" },
                      { icon: "🔍", label: "Privacy check", desc: "Analyze your activity" },
                      { icon: "🤝", label: "Pay agents", desc: "Agent-to-agent transfers" },
                    ].map((item) => (
                      <div key={item.label} className="bg-surface-container-lowest border border-outline-variant/10 p-3">
                        <span className="text-lg">{item.icon}</span>
                        <p className="text-xs text-on-surface font-bold mt-1">{item.label}</p>
                        <p className="text-[10px] text-outline">{item.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tourStep === 2 && (
                <div className="space-y-4 animate-fade-in">
                  <p className="text-sm text-on-surface-variant font-bold">Quick start:</p>
                  <div className="space-y-3">
                    <div className="bg-surface-container-lowest border border-outline-variant/10 p-3">
                      <p className="text-xs text-on-surface font-mono mb-1">1. Fund your agent</p>
                      <p className="text-[10px] text-outline">Type <span className="text-on-surface-variant font-mono">/fund</span> to get testnet ETH</p>
                    </div>
                    <div className="bg-surface-container-lowest border border-outline-variant/10 p-3">
                      <p className="text-xs text-on-surface font-mono mb-1">2. Send a payment</p>
                      <p className="text-[10px] text-outline">Type <span className="text-on-surface-variant font-mono">/send</span> or just say "send 0.1 ETH to alice.wraith"</p>
                    </div>
                    <div className="bg-surface-container-lowest border border-outline-variant/10 p-3">
                      <p className="text-xs text-on-surface font-mono mb-1">3. Use / for all commands</p>
                      <p className="text-[10px] text-outline">Type <span className="text-on-surface-variant font-mono">/</span> to see every available command</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Tour navigation */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-outline-variant/10">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((s) => (
                  <span
                    key={s}
                    className={`h-1.5 w-1.5 transition-colors ${
                      s === tourStep ? "bg-primary" : "bg-outline-variant"
                    }`}
                  />
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={dismissTour}
                  className="text-xs text-outline hover:text-on-surface-variant transition-colors"
                >
                  Skip
                </button>
                {tourStep < 2 ? (
                  <button
                    onClick={() => setTourStep(tourStep + 1)}
                    className="px-4 py-1.5 bg-white text-surface text-xs font-bold uppercase tracking-wider hover:neon-glow transition-colors"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    onClick={dismissTour}
                    className="px-4 py-1.5 bg-white text-surface text-xs font-bold uppercase tracking-wider hover:neon-glow transition-colors"
                  >
                    Get Started
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MessageBubble                                                      */
/* ------------------------------------------------------------------ */

function MessageBubble({ message }: { message: ChatMessage }) {
  const { role, text } = message;

  if (role === "system") {
    return (
      <div className="animate-fade-in flex items-start gap-3">
        <div className="w-8 h-8 bg-surface-container-high flex items-center justify-center flex-shrink-0">
          <span className="font-mono text-[10px] text-outline">sys</span>
        </div>
        <div>
          <span className="font-headline text-[10px] tracking-widest text-outline uppercase block mb-1">System</span>
          <p className="font-mono text-sm text-outline whitespace-pre-line break-words">{text}</p>
        </div>
      </div>
    );
  }

  if (role === "tool") {
    const lines = text.split("\n");
    const toolName = lines[0] || "";
    const description = lines.slice(1).join("\n");

    return (
      <div className="animate-fade-in ml-11">
        <div className="bg-surface-container-low border-l-2 border-tertiary px-4 py-3 max-w-[85%]">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 bg-tertiary" />
            <span className="font-mono text-[10px] text-tertiary uppercase tracking-wider">{toolName}</span>
          </div>
          {description && (
            <p className="font-mono text-xs text-outline whitespace-pre-line break-words">{description}</p>
          )}
        </div>
      </div>
    );
  }

  if (role === "user") {
    return (
      <div className="flex flex-row-reverse items-start gap-3 animate-fade-in">
        <div className="w-8 h-8 bg-on-surface flex items-center justify-center flex-shrink-0 overflow-hidden">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#131315" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div className="max-w-[75%]">
          <p className="text-base text-white font-light whitespace-pre-line break-words">{text}</p>
        </div>
      </div>
    );
  }

  // agent
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <div className="w-8 h-8 bg-surface-container-high flex items-center justify-center flex-shrink-0 p-1.5">
        <img src="/logo.png" alt="W" className="w-full h-full object-contain opacity-80" />
      </div>
      <div className="max-w-[85%] overflow-hidden prose-wraith">
        <ReactMarkdown
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary underline">{children}</a>
            ),
          }}
        >{text}</ReactMarkdown>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function SettingsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function DisconnectIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
