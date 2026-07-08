import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";

interface AgentPublicInfo {
  name: string;
  publicKey: string;
  metaAddress: string;
}

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || "https://cf8e3085ec9e91c97d42e12fb167220c266a5589-3000.dstack-pha-prod9.phala.network").replace(/\/+$/, "");
const HORIZON_URL = "https://horizon-testnet.stellar.org";

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
        setAgent({ name: data.name, publicKey: data.publicKey, metaAddress: data.metaAddress });

        // Fetch balance
        try {
          const acctRes = await fetch(`${HORIZON_URL}/accounts/${data.publicKey}`);
          if (acctRes.ok) {
            const acctData = await acctRes.json();
            const native = acctData.balances?.find((b: any) => b.asset_type === "native");
            if (native && !cancelled) setBalance(parseFloat(native.balance).toFixed(2));
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
          <img src="/logo.png" alt="Wraith" className="h-14 mx-auto mb-4 opacity-80" />
          <div className="flex items-center justify-center gap-1">
            <span className="inline-block h-1.5 w-1.5 bg-on-surface-variant rounded-full animate-pulse-dots" style={{ animationDelay: "0s" }} />
            <span className="inline-block h-1.5 w-1.5 bg-on-surface-variant rounded-full animate-pulse-dots" style={{ animationDelay: "0.2s" }} />
            <span className="inline-block h-1.5 w-1.5 bg-on-surface-variant rounded-full animate-pulse-dots" style={{ animationDelay: "0.4s" }} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest">
        <div className="text-center max-w-md px-6">
          <div className="flex items-center justify-center gap-2 mb-6">
            <img src="/logo.png" alt="Wraith" className="h-6" />
            <span className="font-headline font-bold text-primary tracking-wider text-sm">WRAITH</span>
          </div>
          <p className="text-on-surface-variant text-body-md mb-4">{error || "Agent not found"}</p>
          <div className="flex gap-3 justify-center">
            <a href="/agents" className="font-mono text-[10px] text-outline hover:text-on-surface-variant transition-colors">
              Browse agents
            </a>
            <a href="/chat" className="font-mono text-[10px] text-outline hover:text-on-surface-variant transition-colors">
              Go home
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-center gap-2 h-14 mb-4">
          <img src="/logo.png" alt="Wraith" className="h-6" />
          <span className="font-headline font-bold text-primary tracking-wider text-sm">WRAITH</span>
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
              <span className="font-mono text-[10px] text-outline">Active on Stellar Testnet</span>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex justify-center py-5 bg-surface-container-low mx-6 mt-4">
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
          <div className="px-6 py-4 space-y-2">
            {balance && (
              <div className="flex items-center justify-between bg-surface-container-low px-3 py-2.5 hover:bg-surface-bright transition-colors">
                <span className="text-label-sm text-outline">Balance</span>
                <span className="text-sm text-on-surface font-mono font-bold">
                  {balance} XLM
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 bg-surface-container-low px-3 py-2.5 hover:bg-surface-bright transition-colors">
              <span className="text-label-sm text-outline">Public Key</span>
              <button
                onClick={() => handleCopy(agent.publicKey, "key")}
                className="text-xs text-on-surface-variant font-mono text-right hover:text-on-surface transition-colors"
                title="Click to copy"
              >
                {copied === "key" ? "Copied!" : truncateKey(agent.publicKey, 8)}
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 bg-surface-container-low px-3 py-2.5 hover:bg-surface-bright transition-colors">
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
            <a
              href={payUrl}
              className="block w-full py-3 bg-white text-surface text-center text-sm font-bold uppercase tracking-wider hover:neon-glow transition-colors"
            >
              Pay {agent.name}.wraith
            </a>

            <div className="flex gap-2">
              <button
                onClick={() => handleCopy(profileUrl, "link")}
                className="flex-1 py-2.5 border border-outline text-on-surface-variant text-xs font-bold uppercase tracking-wider hover:bg-surface-container-high transition-colors"
              >
                {copied === "link" ? "Copied!" : "Share Profile"}
              </button>
              <a
                href={`https://stellar.expert/explorer/testnet/account/${agent.publicKey}`}
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
          <a href="/agents" className="font-mono text-[10px] text-outline-variant hover:text-outline transition-colors">
            Browse Agents
          </a>
          <span className="font-mono text-[10px] text-outline-variant">|</span>
          <a href="/chat" className="font-mono text-[10px] text-outline-variant hover:text-outline transition-colors">
            Create Your Agent
          </a>
        </div>

        <p className="font-mono text-[10px] text-outline-variant text-center mt-3">
          Powered by Wraith Protocol — Stealth payments on Stellar
        </p>
      </div>
    </div>
  );
}
