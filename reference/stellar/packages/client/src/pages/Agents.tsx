import { useState, useEffect } from "react";
import { QRCodeCanvas } from "qrcode.react";

interface AgentEntry {
  id: string;
  name: string;
  publicKey?: string;
  public_key?: string;
  metaAddress?: string;
  meta_address?: string;
  createdAt?: string;
  created_at?: number;
}

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || "https://cf8e3085ec9e91c97d42e12fb167220c266a5589-3000.dstack-pha-prod9.phala.network").replace(/\/+$/, "");

function truncateKey(key: string, len = 6): string {
  if (key.length <= len * 2 + 3) return key;
  return `${key.slice(0, len)}...${key.slice(-len)}`;
}

export default function Agents() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<AgentEntry | null>(null);

  useEffect(() => {
    fetch(`${SERVER_URL}/agents`)
      .then((r) => r.json())
      .then((data) => setAgents(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? agents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : agents;

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest">
        <div className="text-center">
          <img src="/logo.png" alt="Wraith" className="h-14 mx-auto mb-4 opacity-80" />
          <div className="flex items-center justify-center gap-1">
            <span className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots" style={{ animationDelay: "0s" }} />
            <span className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots" style={{ animationDelay: "0.2s" }} />
            <span className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots" style={{ animationDelay: "0.4s" }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-surface-container-lowest">
      {/* Header */}
      <header className="flex-shrink-0 h-14 bg-surface border-b border-outline-variant/10">
        <div className="flex items-center justify-between px-8 h-full">
          <div className="flex items-center gap-4">
            <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img src="/logo.png" alt="Wraith" className="h-6 opacity-80" />
              <span className="font-headline text-sm font-bold tracking-widest text-primary">WRAITH</span>
            </a>
          </div>
          <a
            href="/chat"
            className="font-mono text-xs text-outline hover:text-primary transition-colors uppercase tracking-wider"
          >
            Launch Agent
          </a>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 md:px-12 py-12">
          {/* Title + Search */}
          <div className="mb-12">
            <div className="border-l-4 border-primary pl-6 mb-8">
              <h1 className="text-4xl md:text-5xl font-headline font-black text-on-surface uppercase tracking-tighter">
                Agent Directory
              </h1>
              <p className="text-sm text-outline mt-2 font-mono">
                {agents.length} REGISTERED AGENT{agents.length !== 1 ? "S" : ""} ON NETWORK
              </p>
            </div>
            <div className="max-w-xl relative">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-outline" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="QUERY AGENT NAME"
                className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-white pl-12 pr-4 py-3 text-sm text-on-surface placeholder:text-outline-variant outline-none transition-colors font-mono uppercase"
              />
            </div>
          </div>

          {/* Agent grid */}
          {filtered.length === 0 ? (
            <p className="text-sm text-outline-variant text-center py-12">
              {search ? "No agents match your search" : "No agents registered yet"}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                  className={`text-left bg-surface p-6 hover:bg-surface-bright transition-all flex flex-col border ${
                    selectedAgent?.id === agent.id ? "border-primary" : "border-outline-variant/10 hover:border-outline-variant/30"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-tertiary" />
                      <span className="font-mono text-[10px] text-tertiary uppercase tracking-wider">Active</span>
                    </div>
                  </div>
                  <h3 className="text-2xl font-headline font-bold text-on-surface uppercase tracking-tight mt-4">
                    {agent.name}.wraith
                  </h3>
                  <div className="mt-auto pt-6 space-y-2">
                    <p className="font-mono text-[10px] text-outline">
                      {truncateKey(agent.publicKey || agent.public_key || "", 10)}
                    </p>
                    <p className="font-mono text-[10px] text-outline-variant">
                      {new Date(Date.parse(agent.createdAt || "") || (agent.created_at || 0) * 1000).toLocaleDateString()}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Agent detail panel */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setSelectedAgent(null)}>
          <div
            className="bg-surface-container border border-outline-variant/30 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 space-y-5">
              {/* Name */}
              <div className="text-center">
                <p
                  className="text-xl font-bold text-on-surface"
                  style={{ fontFamily: "Space Grotesk, monospace" }}
                >
                  {selectedAgent.name}.wraith
                </p>
                <p className="text-xs text-outline mt-1">Wraith Agent</p>
              </div>

              {/* QR Code */}
              <div className="flex justify-center">
                <div className="bg-white p-3">
                  <QRCodeCanvas
                    value={`${window.location.origin}/pay/${selectedAgent.name}`}
                    size={140}
                    bgColor="#ffffff"
                    fgColor="#0e0e0e"
                    level="M"
                  />
                </div>
              </div>

              {/* Details */}
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-outline">Public Key</span>
                  <span className="text-xs text-on-surface-variant font-mono text-right break-all">
                    {truncateKey(selectedAgent.publicKey || selectedAgent.public_key || "", 10)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-outline whitespace-nowrap">Meta Address</span>
                  <span className="text-xs text-on-surface-variant font-mono text-right break-all">
                    {truncateKey(selectedAgent.metaAddress || selectedAgent.meta_address || "", 10)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-outline">Registered</span>
                  <span className="text-xs text-on-surface-variant">
                    {new Date(Date.parse(selectedAgent.createdAt || "") || (selectedAgent.created_at || 0) * 1000).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <a
                  href={`/pay/${selectedAgent.name}`}
                  className="flex-1 py-2.5 bg-white text-surface text-center text-xs font-bold uppercase tracking-wider hover:neon-glow transition-colors"
                >
                  Pay
                </a>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedAgent.metaAddress || selectedAgent.meta_address || "");
                  }}
                  className="flex-1 py-2.5 border border-outline-variant text-on-surface-variant text-center text-xs font-bold uppercase tracking-wider hover:bg-surface-container-high transition-colors"
                >
                  Copy Address
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
