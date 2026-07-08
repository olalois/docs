import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, parseUnits, erc20Abi } from "viem";
import { WalletButton } from "@/components/connect-button";
import { isAddress } from "viem";
import { useSendStealth, TOKEN_LIST } from "@/hooks/useSendStealth";
import type { TokenOption } from "@/hooks/useSendStealth";
import { useLookupMetaAddress } from "@/hooks/useRegistry";
import { VaultStatus } from "@/components/vault-status";
import {
  generateStealthAddress,
  decodeStealthMetaAddress,
  SCHEME_ID,
  META_ADDRESS_PREFIX,
} from "@wraith-horizen/sdk";
import type { HexString } from "@wraith-horizen/sdk";
import { txUrl, addressUrl } from "@/lib/explorer";
import { WRAITH_SENDER_ABI, WRAITH_SENDER_ADDRESSES } from "@/config/contracts";
import { useResolveName } from "@/hooks/useWraithNames";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";

function ExplorerLink({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-primary underline transition-colors">
      {children}
    </a>
  );
}

interface BatchEntry {
  metaAddress: string;
  amount: string;
  stealthAddress: HexString;
  ephemeralPubKey: HexString;
  viewTag: number;
}

export default function Send() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { toast } = useToast();

  const tokens = TOKEN_LIST[chainId] ?? TOKEN_LIST[31337] ?? [{ symbol: "ETH", address: "native" as const, decimals: 18 }];

  const [mode, setMode] = useState<"single" | "batch">("single");

  // Pre-fill from query param
  const [searchParams] = useSearchParams();
  const prefillTo = searchParams.get("to") ?? "";

  // Single send
  const [recipient, setRecipient] = useState(prefillTo);
  const [amount, setAmount] = useState("");
  const [selectedToken, setSelectedToken] = useState<TokenOption>(tokens[0]);
  const [includeGasTip, setIncludeGasTip] = useState(true);
  const [gasTipAmount, setGasTipAmount] = useState("0.001");
  const isERC20 = selectedToken.address !== "native";

  const isWalletAddress = isAddress(recipient);
  const isMetaAddress = recipient.startsWith(META_ADDRESS_PREFIX);

  // Strip .wraith suffix if present, then check if it's a valid name
  const cleanedName = recipient.replace(/\.wraith$/i, "").toLowerCase();
  const isWraithName = !isWalletAddress && !isMetaAddress && cleanedName.length >= 3 && /^[a-z0-9]+$/.test(cleanedName);

  const { data: lookedUpMeta } = useLookupMetaAddress(
    isWalletAddress ? (recipient as `0x${string}`) : undefined,
    chainId
  );

  const { metaAddress: nameResolved } = useResolveName(
    isWraithName ? cleanedName : undefined
  );

  const metaAddress = isMetaAddress
    ? recipient
    : nameResolved
    ? nameResolved
    : lookedUpMeta
    ? `${META_ADDRESS_PREFIX}${(lookedUpMeta as string).slice(2)}`
    : "";

  const {
    generateAndSend,
    reset: resetSingle,
    stealthResult,
    isPending: isSinglePending,
    isSendConfirming,
    isSendSuccess,
    sendHash,
  } = useSendStealth(chainId);

  // Batch send
  const [batchEntries, setBatchEntries] = useState<BatchEntry[]>([]);
  const [batchRecipient, setBatchRecipient] = useState("");
  const [batchAmount, setBatchAmount] = useState("");
  const [batchToken, setBatchToken] = useState<TokenOption>(tokens[0]);

  const {
    writeContract: writeBatch,
    data: batchHash,
    isPending: isBatchPending,
    error: batchError,
    reset: resetBatchTx,
  } = useWriteContract();
  const { isLoading: isBatchConfirming, isSuccess: isBatchSuccess } =
    useWaitForTransactionReceipt({ hash: batchHash });

  const toastedBatchError = useRef<string | null>(null);
  const toastedBatchSuccess = useRef<string | null>(null);

  useEffect(() => {
    if (batchError) {
      const msg = parseError(batchError);
      if (toastedBatchError.current !== msg) {
        toastedBatchError.current = msg;
        toast(msg, "error");
      }
    }
  }, [batchError, toast]);

  useEffect(() => {
    if (isBatchSuccess && batchHash && toastedBatchSuccess.current !== batchHash) {
      toastedBatchSuccess.current = batchHash;
      toast(`Batch transfer confirmed — ${batchEntries.length} recipients`, "success");
    }
  }, [isBatchSuccess, batchHash, batchEntries.length, toast]);

  const addToBatch = () => {
    const meta = batchRecipient.startsWith(META_ADDRESS_PREFIX)
      ? batchRecipient
      : "";
    if (!meta || !batchAmount) {
      toast("Enter a valid meta-address and amount", "error");
      return;
    }

    try {
      const decoded = decodeStealthMetaAddress(meta);
      const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
      setBatchEntries((prev) => [
        ...prev,
        {
          metaAddress: meta,
          amount: batchAmount,
          stealthAddress: result.stealthAddress,
          ephemeralPubKey: result.ephemeralPubKey,
          viewTag: result.viewTag,
        },
      ]);
      setBatchRecipient("");
      setBatchAmount("");
    } catch (err) {
      toast(parseError(err), "error");
    }
  };

  const removeFromBatch = (index: number) => {
    setBatchEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const executeBatch = () => {
    const senderAddress = WRAITH_SENDER_ADDRESSES[chainId];
    if (!senderAddress || batchEntries.length === 0) return;

    const stealthAddresses = batchEntries.map((e) => e.stealthAddress as `0x${string}`);
    const ephemeralPubKeys = batchEntries.map((e) => e.ephemeralPubKey as `0x${string}`);
    const metadatas = batchEntries.map((e) => {
      const vt = e.viewTag.toString(16).padStart(2, "0");
      return `0x${vt}` as `0x${string}`;
    });

    if (batchToken.address === "native") {
      const amounts = batchEntries.map((e) => parseEther(e.amount));
      const totalValue = amounts.reduce((a, b) => a + b, 0n);

      writeBatch({
        address: senderAddress,
        abi: WRAITH_SENDER_ABI,
        functionName: "batchSendETH",
        args: [SCHEME_ID, stealthAddresses, ephemeralPubKeys, metadatas, amounts],
        value: totalValue,
      });
    } else {
      const amounts = batchEntries.map((e) => parseUnits(e.amount, batchToken.decimals));
      const tipPerRecipient = includeGasTip ? parseEther(gasTipAmount) : 0n;
      const totalTip = tipPerRecipient * BigInt(batchEntries.length);

      writeBatch({
        address: senderAddress,
        abi: WRAITH_SENDER_ABI,
        functionName: "batchSendERC20",
        args: [
          batchToken.address as `0x${string}`,
          SCHEME_ID,
          stealthAddresses,
          ephemeralPubKeys,
          metadatas,
          amounts,
        ],
        value: totalTip,
      });
    }
  };

  const resetBatch = () => {
    setBatchEntries([]);
    setBatchRecipient("");
    setBatchAmount("");
    setBatchToken(tokens[0]);
    toastedBatchError.current = null;
    toastedBatchSuccess.current = null;
    resetBatchTx();
  };

  const resetAll = () => {
    resetSingle();
    setRecipient("");
    setAmount("");
    setSelectedToken(tokens[0]);
  };

  if (!isConnected) {
    return (
      <>
        <VaultStatus />
        <header className="mb-16">
          <h1 className="font-headline text-4xl font-bold tracking-tighter uppercase text-primary">
            Initiate Transfer
          </h1>
          <p className="text-on-surface-variant text-sm mt-2 max-w-sm">
            Connect your wallet to send assets privately.
          </p>
        </header>
        <div className="flex justify-center">
          <WalletButton />
        </div>
      </>
    );
  }

  return (
    <>
      <VaultStatus />

      <section className="flex flex-col gap-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-4xl font-bold tracking-tighter uppercase text-primary">
              Initiate Transfer
            </h1>
            <p className="text-on-surface-variant text-sm mt-1">
              {mode === "single"
                ? "Transfer and announcement happen atomically."
                : "Add recipients then send all in one transaction."}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMode("single")}
              className={`px-3 py-1.5 font-headline text-[10px] uppercase tracking-widest transition-all ${
                mode === "single"
                  ? "bg-surface-container-high text-primary"
                  : "text-outline hover:text-primary"
              }`}
            >
              Single
            </button>
            <button
              onClick={() => setMode("batch")}
              className={`px-3 py-1.5 font-headline text-[10px] uppercase tracking-widest transition-all ${
                mode === "batch"
                  ? "bg-surface-container-high text-primary"
                  : "text-outline hover:text-primary"
              }`}
            >
              Batch
            </button>
          </div>
        </div>

        {/* Single send mode */}
        {mode === "single" && (
          <>
            {!stealthResult && (
              <div className="flex flex-col gap-8">
                <div className="space-y-2">
                  <label className="font-headline text-[10px] uppercase tracking-widest text-outline">
                    Recipient Address / Meta-Address
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="name, st:eth:0x..., or 0x..."
                      className="w-full bg-surface-container-lowest border-none py-4 px-4 font-headline text-lg text-primary focus:ring-0 transition-colors"
                    />
                    {isWalletAddress && lookedUpMeta && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <span className="font-headline text-[10px] text-primary uppercase bg-surface-container-high px-2 py-0.5">
                          Resolved
                        </span>
                      </div>
                    )}
                    {isMetaAddress && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <span className="font-headline text-[10px] text-primary uppercase bg-surface-container-high px-2 py-0.5">
                          Meta-Address
                        </span>
                      </div>
                    )}
                    {isWraithName && nameResolved && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <span className="font-headline text-[10px] text-primary uppercase bg-surface-container-high px-2 py-0.5">
                          {cleanedName}.wraith
                        </span>
                      </div>
                    )}
                    {isWraithName && !nameResolved && cleanedName.length >= 3 && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <span className="font-headline text-[10px] text-on-surface-variant uppercase bg-surface-container-high px-2 py-0.5">
                          Not found
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="font-headline text-[10px] uppercase tracking-widest text-outline">
                    Amount
                  </label>
                  <div className="flex bg-surface-container-lowest">
                    <input
                      type="text"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 bg-transparent border-none py-4 px-4 font-headline text-3xl text-primary focus:ring-0"
                    />
                    <select
                      value={selectedToken.symbol}
                      onChange={(e) => {
                        const t = tokens.find((tk) => tk.symbol === e.target.value);
                        if (t) setSelectedToken(t);
                      }}
                      className="bg-surface-container-high border-none pl-5 pr-10 font-headline text-sm text-primary uppercase tracking-widest cursor-pointer focus:ring-0"
                    >
                      {tokens.map((t) => (
                        <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {isERC20 && (
                  <div className="flex items-center justify-between bg-surface-container-low p-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setIncludeGasTip(!includeGasTip)}
                        className={`w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors ${
                          includeGasTip
                            ? "bg-primary border-primary"
                            : "border-outline-variant hover:border-primary"
                        }`}
                      >
                        {includeGasTip && (
                          <span className="text-[10px] text-on-primary font-bold">+</span>
                        )}
                      </button>
                      <span className="text-[11px] text-on-surface-variant font-body">
                        Include ETH gas tip for recipient
                      </span>
                    </div>
                    {includeGasTip && (
                      <input
                        type="text"
                        value={gasTipAmount}
                        onChange={(e) => setGasTipAmount(e.target.value)}
                        className="w-20 bg-surface-container-lowest border-none py-1.5 px-3 font-headline text-xs text-primary text-right focus:ring-0"
                      />
                    )}
                  </div>
                )}

                <button
                  onClick={() => {
                    if (metaAddress && amount) {
                      const tip = isERC20 && includeGasTip ? gasTipAmount : undefined;
                      generateAndSend(metaAddress, amount, selectedToken, tip);
                    }
                  }}
                  disabled={!metaAddress || !amount || isSinglePending}
                  className="w-full brushed-metal text-on-primary font-headline font-bold uppercase tracking-widest py-5 text-sm hover:brightness-110 transition-all active:scale-[0.99] disabled:opacity-30"
                >
                  {isSinglePending ? "Confirm in wallet..." : "Execute Transfer"}
                </button>
              </div>
            )}

            {stealthResult && (
              <div className="bg-surface-container-low p-6 space-y-6">
                <div className="flex items-start gap-4">
                  <span className="text-primary mt-0.5 text-sm">{isSendSuccess ? "[+]" : "[~]"}</span>
                  <div className="flex flex-col">
                    <span className="font-headline text-xs text-primary uppercase">
                      {isSendConfirming ? "Confirming..." : isSendSuccess ? "Transfer Complete" : "Pending"}
                    </span>
                    <span className="text-[10px] text-on-surface-variant font-body flex flex-wrap gap-x-2">
                      <span>
                        Stealth:{" "}
                        <ExplorerLink href={addressUrl(chainId, stealthResult.stealthAddress)}>
                          {stealthResult.stealthAddress.slice(0, 14)}...
                        </ExplorerLink>
                      </span>
                      {sendHash && (
                        <span>
                          Tx:{" "}
                          <ExplorerLink href={txUrl(chainId, sendHash)}>
                            {sendHash.slice(0, 14)}...
                          </ExplorerLink>
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                {isSendSuccess && (
                  <button
                    onClick={resetAll}
                    className="w-full py-4 border border-outline-variant text-primary font-headline font-bold uppercase tracking-[0.2em] text-sm hover:bg-surface-container-high transition-all"
                  >
                    New Transfer
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Batch send mode */}
        {mode === "batch" && !isBatchSuccess && (
          <>
            {/* Token selector for entire batch */}
            <div className="space-y-2">
              <label className="font-headline text-[10px] uppercase tracking-widest text-outline">
                Asset for batch
              </label>
              <select
                value={batchToken.symbol}
                onChange={(e) => {
                  const t = tokens.find((tk) => tk.symbol === e.target.value);
                  if (t) setBatchToken(t);
                }}
                className="bg-surface-container-lowest border-none py-3 px-4 font-headline text-sm text-primary uppercase tracking-widest cursor-pointer focus:ring-0 pr-10"
              >
                {tokens.map((t) => (
                  <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                ))}
              </select>
            </div>

            {/* Add recipient form */}
            <div className="space-y-3">
              <label className="font-headline text-[10px] uppercase tracking-widest text-outline">
                Add recipient
              </label>
              <input
                type="text"
                value={batchRecipient}
                onChange={(e) => setBatchRecipient(e.target.value)}
                placeholder="st:eth:0x..."
                className="w-full bg-surface-container-lowest border-none py-3 px-4 font-headline text-sm text-primary focus:ring-0"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={batchAmount}
                  onChange={(e) => setBatchAmount(e.target.value)}
                  placeholder={`Amount (${batchToken.symbol})`}
                  className="flex-1 bg-surface-container-lowest border-none py-3 px-4 font-headline text-sm text-primary focus:ring-0"
                />
                <button
                  onClick={addToBatch}
                  disabled={!batchRecipient || !batchAmount}
                  className="px-6 py-3 border border-outline-variant text-primary font-headline font-bold uppercase tracking-widest text-[10px] hover:bg-surface-container-high transition-all disabled:opacity-30"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Queued recipients */}
            {batchEntries.length > 0 && (
              <div className="space-y-2">
                <span className="font-headline text-[10px] uppercase tracking-[0.2em] text-outline">
                  Recipients ({batchEntries.length})
                </span>
                {batchEntries.map((entry, i) => (
                  <div key={i} className="bg-surface-container-low p-4 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="font-headline text-xs text-primary-dim truncate max-w-[300px]">
                        {entry.stealthAddress}
                      </span>
                      <span className="text-[10px] text-on-surface-variant font-body">
                        {entry.amount} {batchToken.symbol}
                      </span>
                    </div>
                    <button
                      onClick={() => removeFromBatch(i)}
                      className="text-[10px] font-headline uppercase tracking-widest text-outline hover:text-error-dim transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}

                <button
                  onClick={executeBatch}
                  disabled={isBatchPending || isBatchConfirming}
                  className="w-full brushed-metal text-on-primary font-headline font-bold uppercase tracking-widest py-5 text-sm hover:brightness-110 transition-all disabled:opacity-30 mt-4"
                >
                  {isBatchPending
                    ? "Confirm in wallet..."
                    : isBatchConfirming
                    ? "Confirming..."
                    : `Send to ${batchEntries.length} recipient${batchEntries.length > 1 ? "s" : ""}`}
                </button>
              </div>
            )}
          </>
        )}

        {/* Batch success */}
        {mode === "batch" && isBatchSuccess && (
          <div className="bg-surface-container-low p-6 space-y-6">
            <div className="flex items-start gap-4">
              <span className="text-primary mt-0.5 text-sm">[+]</span>
              <div className="flex flex-col">
                <span className="font-headline text-xs text-primary uppercase">
                  Batch Transfer Complete
                </span>
                <span className="text-[10px] text-on-surface-variant font-body">
                  {batchEntries.length} recipients received funds.{" "}
                  {batchHash && (
                    <ExplorerLink href={txUrl(chainId, batchHash)}>
                      View transaction
                    </ExplorerLink>
                  )}
                </span>
              </div>
            </div>
            <button
              onClick={resetBatch}
              className="w-full py-4 border border-outline-variant text-primary font-headline font-bold uppercase tracking-[0.2em] text-sm hover:bg-surface-container-high transition-all"
            >
              New Batch
            </button>
          </div>
        )}
      </section>
    </>
  );
}
