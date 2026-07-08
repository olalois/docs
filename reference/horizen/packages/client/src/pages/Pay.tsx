import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { parseEther } from "viem";
import {
  decodeStealthMetaAddress,
  generateStealthAddress,
  SCHEME_ID,
} from "@wraith-horizen/sdk";
import type { HexString } from "@wraith-horizen/sdk";
import { WRAITH_SENDER_ABI, WRAITH_SENDER_ADDRESS, EXPLORER_URL } from "../config";

const DEFAULT_SERVER_URL = (import.meta.env.VITE_SERVER_URL || "https://98af19e30d6ee5f73c6ea29960a6ebfe95287b97-3000.dstack-pha-prod9.phala.network").replace(/\/+$/, "");

interface AgentPublicInfo {
  name: string;
  metaAddress: string;
  address: string;
}

function truncateKey(key: string, len = 8): string {
  if (key.length <= len * 2 + 3) return key;
  return `${key.slice(0, len)}...${key.slice(-len)}`;
}

export default function Pay() {
  const { name } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const urlAmount = searchParams.get("amount") || "";
  const memo = searchParams.get("memo") || "";
  const [amountInput, setAmountInput] = useState(urlAmount);
  const amount = amountInput;

  const [agentInfo, setAgentInfo] = useState<AgentPublicInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [payStatus, setPayStatus] = useState<string | null>(null);

  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!name) {
      setError("No agent name specified");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchInfo() {
      try {
        const res = await fetch(`${DEFAULT_SERVER_URL}/agent/info/${name}`);
        if (!res.ok) throw new Error(`Agent "${name}" not found`);
        const data = await res.json();
        if (cancelled) return;
        setAgentInfo({ name: data.name, metaAddress: data.metaAddress, address: data.address });
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load agent");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchInfo();
    return () => { cancelled = true; };
  }, [name]);

  function handlePay() {
    if (!isConnected) { openConnectModal?.(); return; }
    if (!agentInfo || !amount) return;
    setPayStatus("Generating stealth address...");
    setError(null);
    try {
      const decoded = decodeStealthMetaAddress(agentInfo.metaAddress);
      const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
      const viewTagHex = stealth.viewTag.toString(16).padStart(2, "0");
      setPayStatus("Confirm in wallet...");
      writeContract({
        address: WRAITH_SENDER_ADDRESS as `0x${string}`,
        abi: WRAITH_SENDER_ABI,
        functionName: "sendETH",
        args: [SCHEME_ID, stealth.stealthAddress as `0x${string}`, stealth.ephemeralPubKey as `0x${string}`, `0x${viewTagHex}` as `0x${string}`],
        value: parseEther(amount),
      });
    } catch (e: any) {
      setError(e.message || "Payment failed");
      setPayStatus(null);
    }
  }

  function handleCopy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest p-4">
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

  if (!agentInfo) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest p-4">
        <div className="text-center max-w-md px-6">
          <img src="/logo.png" alt="Wraith" className="h-14 mx-auto mb-4 opacity-80" />
          <p className="text-on-surface-variant mb-4">{error || "Agent not found"}</p>
          <div className="flex gap-3 justify-center">
            <a href="/agents" className="text-xs text-outline hover:text-on-surface-variant transition-colors">
              Browse agents
            </a>
            <a href="/" className="text-xs text-outline hover:text-on-surface-variant transition-colors">
              Go home
            </a>
          </div>
        </div>
      </div>
    );
  }

  const pageUrl = window.location.href;
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <img src="/logo.png" alt="Wraith" className="h-8 opacity-80" />
          <span className="font-headline font-black text-on-surface text-lg uppercase tracking-wider">Wraith</span>
        </div>

        {/* Agent card */}
        <div className="bg-surface border border-outline-variant/10">
          {/* Card header */}
          <div className="bg-surface-container-low px-6 py-5 text-center border-b border-outline-variant/10">
            <p className="text-3xl font-headline font-black uppercase text-on-surface">
              {agentInfo.name}.wraith
            </p>
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="h-2 w-2 bg-tertiary" />
              <span className="font-mono text-[10px] text-outline uppercase tracking-wider">Payment Terminal</span>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex justify-center py-5">
            <div className="bg-white p-4">
              <QRCodeCanvas
                value={pageUrl}
                size={180}
                bgColor="#ffffff"
                fgColor="#000000"
                level="H"
              />
            </div>
          </div>

          {/* Payment details */}
          <div className="px-6 pb-4 space-y-3">
            {amount && (
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-outline uppercase tracking-wider">Amount</span>
                <span className="text-sm text-on-surface font-headline font-bold">
                  {amount} ETH
                </span>
              </div>
            )}
            {memo && (
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-outline uppercase tracking-wider">Memo</span>
                <span className="text-sm text-on-surface-variant">{memo}</span>
              </div>
            )}
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-[10px] text-outline uppercase tracking-wider">Address</span>
              <button
                onClick={() => handleCopy(agentInfo.address, "address")}
                className="text-xs text-on-surface-variant font-mono text-right hover:text-on-surface transition-colors"
              >
                {copied === "address" ? "Copied!" : truncateKey(agentInfo.address, 8)}
              </button>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-[10px] text-outline uppercase tracking-wider whitespace-nowrap">Meta Address</span>
              <button
                onClick={() => handleCopy(agentInfo.metaAddress, "meta")}
                className="text-xs text-on-surface-variant font-mono text-right hover:text-on-surface transition-colors break-all"
              >
                {copied === "meta" ? "Copied!" : truncateKey(agentInfo.metaAddress, 10)}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="px-6 pb-6 space-y-2">
            {txHash && isSuccess ? (
              <div className="text-center space-y-2 py-2">
                <p className="text-tertiary font-headline font-bold">Payment sent!</p>
                <a href={`${EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-on-surface-variant underline hover:text-on-surface">
                  View transaction
                </a>
              </div>
            ) : (
              <>
                {payStatus && <p className="text-xs text-on-surface-variant text-center mb-2">{payStatus}</p>}
                {error && <p className="text-xs text-error text-center mb-2">{error}</p>}

                {!urlAmount && (
                  <div className="mb-3">
                    <label className="block font-mono text-[10px] text-outline uppercase tracking-wider mb-1.5">Amount</label>
                    <input
                      type="text"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      placeholder="0.00 ETH"
                      className="w-full bg-surface-container-low px-3 py-2.5 text-sm text-on-surface font-mono placeholder:text-outline-variant outline-none border border-outline-variant/10 focus:border-outline transition-colors"
                    />
                  </div>
                )}

                <button
                  onClick={handlePay}
                  disabled={isPending || !amount}
                  className="w-full py-3 bg-white text-surface text-sm font-bold uppercase tracking-wider hover:neon-glow transition-all disabled:opacity-30"
                >
                  {isPending ? "Processing..." : !isConnected ? "Connect Wallet & Pay" : amount ? `Pay ${amount} ETH` : "Enter amount"}
                </button>
              </>
            )}
            <a
              href={`${EXPLORER_URL}/address/${agentInfo.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-2.5 border border-outline text-on-surface-variant text-center text-xs font-bold uppercase tracking-wider hover:bg-surface-bright transition-colors"
            >
              View Profile
            </a>
          </div>
        </div>

        {/* Footer note */}
        <p className="font-mono text-[10px] text-outline-variant text-center mt-4">
          Payment goes to a stealth address. Only {agentInfo.name}.wraith can detect it.
        </p>
      </div>
    </div>
  );
}
