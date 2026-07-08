import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";

interface AgentEntry {
  id: string;
  name: string;
  address: string;
  meta_address: string;
  created_at: number;
}

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || "https://98af19e30d6ee5f73c6ea29960a6ebfe95287b97-3000.dstack-pha-prod9.phala.network").replace(/\/+$/, "");

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
      <header className="flex-shrink-0 bg-surface border-b border-outline-variant/10">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img src="/logo.png" alt="Wraith" className="h-7 opacity-80" />
              <span className="font-headline text-sm text-primary tracking-widest uppercase">WRAITH</span>
            </a>
          </div>
          <a
            href="/"
            className="font-mono text-xs text-outline hover:text-on-surface-variant transition-colors uppercase tracking-wider"
          >
            Launch Agent
          </a>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 py-8">
          {/* Title section */}
          <div className="mb-8 border-l-4 border-primary pl-6">
            <h1 className="font-headline text-3xl text-primary uppercase tracking-wider mb-1">
              Agent Directory
            </h1>
            <p className="font-mono text-xs text-outline">
              {agents.length} registered agent{agents.length !== 1 ? "s" : ""} on the network
            </p>
          </div>

          {/* Search input */}
          <div className="mb-8 relative">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 text-outline-variant">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SEARCH AGENTS..."
              className="w-full bg-transparent border-b-2 border-outline-variant pl-7 pb-2 font-mono text-xs text-primary placeholder:text-outline-variant uppercase tracking-wider outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Agent grid */}
          {filtered.length === 0 ? (
            <p className="font-mono text-xs text-outline-variant text-center py-12 uppercase">
              {search ? "No agents match your search" : "No agents registered yet"}
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                  className={`text-left bg-surface border p-5 transition-colors ${
                    selectedAgent?.id === agent.id
                      ? "border-primary"
                      : "border-outline-variant/10 hover:border-outline-variant"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 bg-tertiary" title="Active" />
                    <span className="font-mono text-xs text-outline uppercase tracking-wider">
                      Active
                    </span>
                  </div>
                  <h3 className="font-headline text-2xl text-primary uppercase tracking-wide mb-2">
                    {agent.name}.wraith
                  </h3>
                  <p className="font-mono text-[10px] text-outline">
                    {truncateKey(agent.address, 8)}
                  </p>
                  <p className="font-mono text-[10px] text-outline-variant mt-1">
                    Registered {new Date(agent.created_at * 1000).toLocaleDateString()}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Agent detail modal */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setSelectedAgent(null)}>
          <div
            className="bg-surface border border-outline-variant/10 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 space-y-5">
              {/* Name */}
              <div className="text-center">
                <p className="font-headline text-xl text-primary uppercase tracking-wide">
                  {selectedAgent.name}.wraith
                </p>
                <p className="font-mono text-xs text-outline mt-1">Wraith Agent</p>
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
                  <span className="text-xs text-outline">Address</span>
                  <span className="text-xs text-on-surface-variant font-mono text-right break-all">
                    {truncateKey(selectedAgent.address, 10)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-outline whitespace-nowrap">Meta Address</span>
                  <span className="text-xs text-on-surface-variant font-mono text-right break-all">
                    {truncateKey(selectedAgent.meta_address, 10)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-outline">Registered</span>
                  <span className="text-xs text-on-surface-variant">
                    {new Date(selectedAgent.created_at * 1000).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Link
                  to={`/pay/${selectedAgent.name}`}
                  className="flex-1 py-2.5 bg-primary text-primary-on-primary text-center text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
                >
                  Pay
                </Link>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedAgent.meta_address);
                  }}
                  className="flex-1 py-2.5 border border-outline-variant text-on-surface-variant text-center text-xs font-bold uppercase tracking-wider hover:bg-surface-bright transition-colors"
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
