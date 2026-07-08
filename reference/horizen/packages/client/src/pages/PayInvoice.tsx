import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
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

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || "https://98af19e30d6ee5f73c6ea29960a6ebfe95287b97-3000.dstack-pha-prod9.phala.network").replace(/\/+$/, "");

interface InvoiceData {
  id: string;
  agentName: string;
  amount: string;
  memo: string;
  status: string;
  metaAddress: string;
  txHash: string | null;
}

export default function PayInvoice() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payStatus, setPayStatus] = useState<string | null>(null);

  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!invoiceId) return;
    fetch(`${SERVER_URL}/invoice/${invoiceId}`)
      .then((r) => { if (!r.ok) throw new Error("Invoice not found"); return r.json(); })
      .then((data) => setInvoice(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  useEffect(() => {
    if (isSuccess && txHash && invoice && invoice.status !== "paid") {
      fetch(`${SERVER_URL}/invoice/${invoiceId}/paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash }),
      }).catch(() => {});
      setInvoice((prev) => prev ? { ...prev, status: "paid" } : prev);
      setPayStatus("Payment confirmed!");
    }
  }, [isSuccess, txHash, invoiceId]);

  function handlePay() {
    if (!isConnected) { openConnectModal?.(); return; }
    if (!invoice) return;
    setPayStatus("Generating stealth address...");
    setError(null);
    try {
      const decoded = decodeStealthMetaAddress(invoice.metaAddress);
      const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
      const viewTagHex = stealth.viewTag.toString(16).padStart(2, "0");
      setPayStatus("Confirm in wallet...");
      writeContract({
        address: WRAITH_SENDER_ADDRESS as `0x${string}`,
        abi: WRAITH_SENDER_ABI,
        functionName: "sendETH",
        args: [SCHEME_ID, stealth.stealthAddress as `0x${string}`, stealth.ephemeralPubKey as `0x${string}`, `0x${viewTagHex}` as `0x${string}`],
        value: parseEther(invoice.amount),
      });
    } catch (e: any) {
      setError(e.message || "Payment failed");
      setPayStatus(null);
    }
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

  if (error && !invoice) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest p-4">
        <div className="text-center">
          <img src="/logo.png" alt="Wraith" className="h-12 mx-auto mb-2 opacity-80" />
          <p className="text-error text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!invoice) return null;

  const pageUrl = window.location.href;
  const isPaid = invoice.status === "paid" || isSuccess;
  const displayTxHash = txHash || invoice.txHash;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Wraith" className="h-10 mx-auto opacity-80" />
          <p className="font-mono text-xs text-outline mt-1">Private Invoice</p>
        </div>

        <div className="bg-surface border border-outline-variant p-6 space-y-6">
          <div className="text-center">
            <p className="font-mono text-[10px] text-outline uppercase tracking-widest mb-1">Pay to</p>
            <p className="font-headline font-black text-2xl text-on-surface">
              {invoice.agentName}.wraith
            </p>
          </div>

          <div className="text-center">
            <p className="text-4xl font-mono text-on-surface">
              {invoice.amount} <span className="text-lg text-outline">ETH</span>
            </p>
            {invoice.memo && <p className="text-sm text-on-surface-variant mt-2">"{invoice.memo}"</p>}
          </div>

          <div className="flex justify-center">
            <div className="bg-surface-container-low p-4">
              <QRCodeCanvas value={pageUrl} size={180} bgColor="#0e0e0e" fgColor="#c6c6c7" level="H" />
            </div>
          </div>

          {isPaid ? (
            <div className="text-center space-y-2">
              <p className="text-tertiary font-headline font-black uppercase">PAID</p>
              {displayTxHash && (
                <a href={`${EXPLORER_URL}/tx/${displayTxHash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-on-surface-variant underline hover:text-on-surface">
                  View transaction
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {payStatus && <p className="text-xs text-on-surface-variant text-center">{payStatus}</p>}
              {error && <p className="text-xs text-error text-center">{error}</p>}
              <button
                onClick={handlePay}
                disabled={isPending}
                className="w-full py-4 bg-white text-surface font-headline font-bold uppercase tracking-[0.2em] text-sm hover:brightness-110 transition-all disabled:opacity-30"
              >
                {isPending ? "Processing..." : isConnected ? "Pay Now" : "Connect Wallet & Pay"}
              </button>
            </div>
          )}

          <div className="border-t border-outline-variant/30 pt-3">
            <p className="font-mono text-[9px] text-outline-variant text-center break-all">Invoice: {invoice.id}</p>
          </div>
        </div>

        <p className="font-mono text-[10px] text-outline-variant text-center mt-4">
          Payment goes to a stealth address. Only {invoice.agentName}.wraith can detect it.
        </p>
      </div>
    </div>
  );
}
