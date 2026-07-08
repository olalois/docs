import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";

interface AgentPublicInfo {
  name: string;
  address: string;
  metaAddress: string;
}

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || "https://98af19e30d6ee5f73c6ea29960a6ebfe95287b97-3000.dstack-pha-prod9.phala.network").replace(/\/+$/, "");

function truncateKey(key: string, len = 8): string {
  if (key.length <= len * 2 + 3) return key;
  return `${key.slice(0, len)}...${key.slice(-len)}`;
}

export default function AgentProfile() {
  const { name } = useParams<{ name: string }>();
  const [agent, setAgent] = useState<AgentPublicInfo | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${SERVER_URL}/agent/info/${name}`);
        if (!res.ok) throw new Error("Agent not found");
        const data = await res.json();
        if (cancelled) return;
        setAgent({ name: data.name, address: data.address, metaAddress: data.metaAddress });

        try {
          const balRes = await fetch(`${SERVER_URL}/agent/balance/${data.address}`);
          if (balRes.ok) {
            const balData = await balRes.json();
            if (balData.balance && !cancelled) setBalance(balData.balance);
          }
        } catch {}
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [name]);

  function handleCopy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  const profileUrl = window.location.href;
  const payUrl = `${window.location.origin}/pay/${name}`;

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest">
        <div className="text-center">
          <img src="/logo.png" alt="Wraith" className="h-14 mx-auto mb-2 opacity-80" />
          <span className="text-lg font-headline font-bold tracking-widest text-on-surface">WRAITH</span>
          <div className="flex items-center justify-center gap-1 mt-4">
            <span className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots" style={{ animationDelay: "0s" }} />
            <span className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots" style={{ animationDelay: "0.2s" }} />
            <span className="inline-block h-1.5 w-1.5 bg-on-surface-variant animate-pulse-dots" style={{ animationDelay: "0.4s" }} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest">
        <div className="text-center max-w-md px-6">
          <img src="/logo.png" alt="Wraith" className="h-14 mx-auto mb-2 opacity-80" />
          <span className="text-lg font-headline font-bold tracking-widest text-on-surface">WRAITH</span>
          <p className="text-on-surface-variant mt-4 mb-4">{error || "Agent not found"}</p>
          <div className="flex gap-3 justify-center">
            <Link to="/agents" className="text-xs font-mono text-outline hover:text-on-surface-variant transition-colors">
              Browse agents
            </Link>
            <Link to="/chat" className="text-xs font-mono text-outline hover:text-on-surface-variant transition-colors">
              Go to chat
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <img src="/logo.png" alt="Wraith" className="h-7 opacity-80" />
          <span className="text-lg font-headline font-bold tracking-widest text-on-surface">WRAITH</span>
        </div>

        {/* Profile card */}
        <div className="bg-surface border border-outline-variant/30">
          {/* Card header */}
          <div className="bg-surface-container-low px-6 py-5 text-center border-b border-outline-variant/30">
            <h1 className="text-3xl font-headline font-black uppercase text-on-surface">
              {agent.name}.wraith
            </h1>
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="h-2 w-2 bg-tertiary rounded-full" />
              <span className="text-xs font-mono text-outline">Active on Horizen Testnet</span>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex justify-center py-5">
            <div className="bg-white p-3">
              <QRCodeCanvas
                value={payUrl}
                size={160}
                bgColor="#ffffff"
                fgColor="#0e0e0e"
                level="H"
              />
            </div>
          </div>

          {/* Info rows */}
          <div className="px-6 pb-4 space-y-1">
            {balance && (
              <div className="flex items-center justify-between bg-surface-container-low px-3 py-2.5 hover:bg-surface-bright transition-colors">
                <span className="text-label-sm text-outline">Balance</span>
                <span className="text-sm text-on-surface font-bold font-mono">
                  {balance} ETH
                </span>
              </div>
            )}

            <div className="flex items-start justify-between gap-2 bg-surface-container-low px-3 py-2.5 hover:bg-surface-bright transition-colors">
              <span className="text-label-sm text-outline">Address</span>
              <button
                onClick={() => handleCopy(agent.address, "key")}
                className="text-xs text-on-surface-variant font-mono text-right hover:text-on-surface transition-colors"
                title="Click to copy"
              >
                {copied === "key" ? "Copied!" : truncateKey(agent.address, 8)}
              </button>
            </div>

            <div className="flex items-start justify-between gap-2 bg-surface-container-low px-3 py-2.5 hover:bg-surface-bright transition-colors">
              <span className="text-label-sm text-outline whitespace-nowrap">Meta Address</span>
              <button
                onClick={() => handleCopy(agent.metaAddress, "meta")}
                className="text-xs text-on-surface-variant font-mono text-right hover:text-on-surface transition-colors break-all"
                title="Click to copy"
              >
                {copied === "meta" ? "Copied!" : truncateKey(agent.metaAddress, 10)}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="px-6 pb-6 space-y-2">
            <Link
              to={`/pay/${agent.name}`}
              className="block w-full py-3 bg-white text-surface text-center text-sm font-bold uppercase tracking-wider hover:neon-glow transition-all"
            >
              Pay {agent.name}.wraith
            </Link>

            <div className="flex gap-2">
              <button
                onClick={() => handleCopy(profileUrl, "link")}
                className="flex-1 py-2.5 border border-outline text-on-surface-variant text-xs font-bold uppercase tracking-wider hover:bg-surface-container-high transition-colors"
              >
                {copied === "link" ? "Copied!" : "Share Profile"}
              </button>
              <a
                href={`https://horizen-testnet.explorer.caldera.xyz/address/${agent.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 border border-outline text-on-surface-variant text-center text-xs font-bold uppercase tracking-wider hover:bg-surface-container-high transition-colors"
              >
                Explorer
              </a>
            </div>
          </div>
        </div>

        {/* Footer links */}
        <div className="flex items-center justify-center gap-4 mt-4">
          <Link to="/agents" className="text-[10px] text-outline-variant hover:text-outline transition-colors">
            Browse Agents
          </Link>
          <span className="text-[10px] text-outline-variant">|</span>
          <Link to="/" className="text-[10px] text-outline-variant hover:text-outline transition-colors">
            Create Your Agent
          </Link>
        </div>

        <p className="text-[10px] text-outline-variant text-center mt-3">
          Powered by Wraith Protocol — Stealth payments on Horizen
        </p>
      </div>
    </div>
  );
}
