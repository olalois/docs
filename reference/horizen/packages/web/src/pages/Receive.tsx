import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAccount, useChainId } from "wagmi";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  erc20Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { WalletButton } from "@/components/connect-button";
import { useScanAnnouncements } from "@/hooks/useScanAnnouncements";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { useSponsoredWithdraw } from "@/hooks/useSponsoredWithdraw";
import { useStealthKeysContext } from "@/context/stealth-keys";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";
import { VaultStatus } from "@/components/vault-status";
import { TOKEN_LIST } from "@/hooks/useSendStealth";
import type { HexString } from "@wraith-horizen/sdk";
import { addressUrl, txUrl } from "@/lib/explorer";
import { horizenTestnet, horizenMainnet } from "@/config/chains";
import { DestinationInput, useIsBlocked } from "@/components/destination-input";
import { usePrivacy } from "@/context/privacy";

function getChain(chainId: number) {
  if (chainId === 2651420) return horizenTestnet;
  if (chainId === 26514) return horizenMainnet;
  return undefined;
}

async function withdrawETH(
  privateKey: HexString,
  destination: `0x${string}`,
  chain: ReturnType<typeof getChain>
) {
  if (!chain) throw new Error("Unsupported chain");

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({ account, chain, transport: http() });

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) throw new Error("No ETH balance");

  // Estimate gas with a small dummy value to avoid "insufficient funds" during estimation
  const gasEstimate = await publicClient.estimateGas({
    account,
    to: destination,
    value: 1n,
  });
  const gasPrice = await publicClient.getGasPrice();
  const gasCost = gasEstimate * gasPrice * 150n / 100n; // 50% buffer for safety
  const sendAmount = balance - gasCost;

  if (sendAmount <= 0n) throw new Error("Balance too low to cover gas");

  return walletClient.sendTransaction({
    to: destination,
    value: sendAmount,
    gas: gasEstimate,
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-[10px] font-headline uppercase tracking-widest text-outline hover:text-on-surface transition-colors"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function StealthAddressRow({
  address,
  privateKey,
  selected,
  onToggleSelect,
  onWithdrawn,
  onDustStatus,
}: {
  address: HexString;
  privateKey: HexString;
  selected: boolean;
  onToggleSelect: () => void;
  onWithdrawn: () => void;
  onDustStatus: (isDust: boolean) => void;
}) {
  const chainId = useChainId();
  const { balances, isLoading, isDust } = useTokenBalances(address);

  useEffect(() => {
    if (!isLoading) onDustStatus(isDust);
  }, [isLoading, isDust, onDustStatus]);
  const { toast } = useToast();
  const { addUsedDestination } = usePrivacy();
  const { sponsoredWithdraw, isWithdrawing: isSponsoredWithdrawing } = useSponsoredWithdraw();
  const [showKey, setShowKey] = useState(false);
  const [withdrawDest, setWithdrawDest] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawHash, setWithdrawHash] = useState<string | null>(null);
  const isBlocked = useIsBlocked(withdrawDest);

  const url = addressUrl(chainId, address);
  const chain = getChain(chainId);

  const hasETH = balances.some((b) => b.symbol === "ETH");
  const hasTokensOnly = !hasETH && balances.length > 0;

  // Find first ERC-20 token for sponsored withdraw
  const tokens = TOKEN_LIST[chainId] ?? [];
  const firstTokenBalance = balances.find((b) => b.symbol !== "ETH");
  const firstTokenConfig = firstTokenBalance
    ? tokens.find((t) => t.symbol === firstTokenBalance.symbol)
    : null;

  const handleWithdraw = async () => {
    if (!withdrawDest || !chain || isBlocked) return;
    setIsWithdrawing(true);
    try {
      const hash = await withdrawETH(
        privateKey,
        withdrawDest as `0x${string}`,
        chain
      );
      setWithdrawHash(hash);
      addUsedDestination(withdrawDest);
      toast("Withdrawal sent", "success");
      onWithdrawn();
    } catch (err) {
      toast(parseError(err), "error");
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleSponsoredWithdraw = async () => {
    if (!withdrawDest || isBlocked || !firstTokenConfig || firstTokenConfig.address === "native") return;
    const hash = await sponsoredWithdraw(
      privateKey as `0x${string}`,
      address as `0x${string}`,
      firstTokenConfig.address as `0x${string}`,
      withdrawDest as `0x${string}`
    );
    if (hash) {
      setWithdrawHash(hash);
      addUsedDestination(withdrawDest);
      onWithdrawn();
    }
  };

  return (
    <div className="bg-surface-container-low p-6 flex flex-col gap-5">
      <div className="flex items-start gap-4">
        <button
          onClick={onToggleSelect}
          className={`mt-1 w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors ${
            selected
              ? "bg-primary border-primary"
              : "border-outline-variant hover:border-primary"
          }`}
        >
          {selected && (
            <span className="text-[10px] text-on-primary font-bold">+</span>
          )}
        </button>

        <div className="flex-1 flex justify-between items-start">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-outline uppercase tracking-widest font-headline">
              Stealth Address
            </span>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-headline text-sm tracking-tight text-primary-dim truncate max-w-[260px] hover:text-primary underline transition-colors"
              >
                {address}
              </a>
            ) : (
              <span className="font-headline text-sm tracking-tight text-primary-dim truncate max-w-[260px]">
                {address}
              </span>
            )}
          </div>
          <div className="text-right">
            {isLoading ? (
              <span className="font-headline text-sm text-on-surface-variant">
                ...
              </span>
            ) : balances.length === 0 ? (
              <span className="font-headline text-sm text-on-surface-variant">
                Empty
              </span>
            ) : (
              <div className="flex flex-col gap-0.5">
                {balances.map((b) => (
                  <span
                    key={b.symbol}
                    className="font-headline text-lg font-bold text-on-surface"
                  >
                    {b.balance} {b.symbol}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {balances.length > 0 && !withdrawHash && (
        <div className="ml-8 space-y-3">
          <div className="flex gap-2">
            <DestinationInput
              value={withdrawDest}
              onChange={setWithdrawDest}
              placeholder="Fresh destination address (0x...)"
              className="w-full bg-surface-container-lowest border-none py-3 px-4 font-headline text-sm text-primary focus:ring-0"
            />
            {hasETH ? (
              <button
                onClick={handleWithdraw}
                disabled={!withdrawDest || isWithdrawing || isBlocked}
                className="brushed-metal px-6 py-3 text-on-primary font-headline font-bold uppercase tracking-widest text-[10px] hover:brightness-110 transition-all disabled:opacity-30 flex-shrink-0"
              >
                {isWithdrawing ? "..." : "Withdraw"}
              </button>
            ) : (
              <button
                onClick={handleSponsoredWithdraw}
                disabled={!withdrawDest || isSponsoredWithdrawing || !firstTokenConfig || isBlocked}
                className="bg-surface-container-high px-6 py-3 text-primary font-headline font-bold uppercase tracking-widest text-[10px] hover:brightness-110 transition-all disabled:opacity-30 border border-outline-variant flex-shrink-0"
              >
                {isSponsoredWithdrawing ? "..." : "Sponsored"}
              </button>
            )}
          </div>
          {hasTokensOnly && (
            <p className="text-[10px] text-on-surface-variant font-body">
              No ETH for gas — withdrawal will be sponsored via relayer. A small fee is deducted from the token amount.
            </p>
          )}
        </div>
      )}

      {withdrawHash && (
        <div className="ml-8 flex items-center gap-2">
          <span className="text-primary text-sm">[+]</span>
          <span className="text-[10px] text-on-surface-variant font-body">
            Withdrawn —{" "}
            {(() => {
              const link = txUrl(chainId, withdrawHash);
              return link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:text-primary-fixed transition-colors"
                >
                  {withdrawHash.slice(0, 14)}...
                </a>
              ) : (
                <>{withdrawHash.slice(0, 14)}...</>
              );
            })()}
          </span>
        </div>
      )}

      <div className="ml-8">
        {!showKey ? (
          <button
            onClick={() => setShowKey(true)}
            className="text-[10px] font-headline uppercase tracking-widest text-outline hover:text-primary transition-colors"
          >
            Reveal private key
          </button>
        ) : (
          <div className="bg-error-container/5 p-4 border border-error-dim/20 relative overflow-hidden">
            <div
              className="absolute inset-0 opacity-[0.03] pointer-events-none"
              style={{
                backgroundImage:
                  "radial-gradient(#bb5551 0.5px, transparent 0.5px)",
                backgroundSize: "10px 10px",
              }}
            />
            <div className="flex flex-col gap-2 relative z-10">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-headline uppercase tracking-[0.2em] text-error-dim font-bold">
                  Sensitive: Stealth Key
                </span>
                <CopyButton text={privateKey} />
              </div>
              <code className="font-headline text-[11px] break-all text-on-surface leading-tight tracking-normal">
                {privateKey}
              </code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Receive() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { keys } = useStealthKeysContext();
  const { scan, matched, isScanning } = useScanAnnouncements(chainId);
  const { toast } = useToast();
  const hasScanned = useRef(false);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [withdrawn, setWithdrawn] = useState<Set<number>>(new Set());
  const [dustSet, setDustSet] = useState<Set<number>>(new Set());
  const [showDust, setShowDust] = useState(false);
  const [batchDest, setBatchDest] = useState("");
  const [isBatchWithdrawing, setIsBatchWithdrawing] = useState(false);
  const { addUsedDestination } = usePrivacy();
  const isBatchBlocked = useIsBlocked(batchDest);

  const markDust = useCallback((i: number, isDust: boolean) => {
    setDustSet((prev) => {
      const next = new Set(prev);
      if (isDust) next.add(i);
      else next.delete(i);
      return next;
    });
  }, []);

  // Filter out withdrawn and optionally dust
  const active = matched
    .map((m, i) => [m, i] as const)
    .filter(([, i]) => !withdrawn.has(i))
    .filter(([, i]) => showDust || !dustSet.has(i));

  const dustCount = matched.filter((_, i) => !withdrawn.has(i) && dustSet.has(i)).length;

  useEffect(() => {
    if (!keys || hasScanned.current || isScanning) return;
    hasScanned.current = true;
    scan(keys.viewingKey, keys.spendingPubKey, keys.spendingKey, true);
  }, [keys, scan, isScanning]);

  useEffect(() => {
    hasScanned.current = false;
  }, [keys?.spendingKey]);

  const handleRescan = () => {
    if (!keys) return;
    scan(keys.viewingKey, keys.spendingPubKey, keys.spendingKey, false);
  };

  const toggleSelect = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === active.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(active.map(([, i]) => i)));
    }
  };

  const handleBatchWithdraw = async () => {
    if (!batchDest || selected.size === 0 || isBatchBlocked) return;

    const chain = getChain(chainId);
    if (!chain) return;

    setIsBatchWithdrawing(true);
    let success = 0;
    let failed = 0;

    const errors: string[] = [];

    for (const idx of Array.from(selected)) {
      const m = matched[idx];
      try {
        await withdrawETH(
          m.stealthPrivateKey,
          batchDest as `0x${string}`,
          chain
        );
        success++;
        setWithdrawn((prev) => new Set(prev).add(idx));
      } catch (err) {
        failed++;
        const addr = m.stealthAddress.slice(0, 10) + "...";
        errors.push(`${addr}: ${parseError(err)}`);
      }
    }

    if (success > 0) {
      addUsedDestination(batchDest);
      toast(`Withdrew from ${success} address${success > 1 ? "es" : ""}`, "success");
    }
    if (failed > 0) toast(errors.join(" | "), "error");

    setIsBatchWithdrawing(false);
    setSelected(new Set());
    setBatchDest("");
  };

  if (!isConnected) {
    return (
      <>
        <VaultStatus />
        <header className="mb-16">
          <h1 className="font-headline text-4xl font-bold tracking-tighter uppercase text-primary mb-2">
            Inbound Assets
          </h1>
          <p className="text-on-surface-variant text-sm max-w-sm">
            Connect your wallet to scan for incoming stealth transfers.
          </p>
        </header>
        <div className="flex justify-center">
          <WalletButton />
        </div>
      </>
    );
  }

  if (!keys) {
    return (
      <>
        <VaultStatus />
        <header className="mb-16">
          <h1 className="font-headline text-4xl font-bold tracking-tighter uppercase text-primary mb-2">
            Inbound Assets
          </h1>
          <p className="text-on-surface-variant text-sm max-w-sm">
            You need to{" "}
            <Link to="/setup" className="text-primary underline">
              set up your stealth keys
            </Link>{" "}
            before scanning.
          </p>
        </header>
      </>
    );
  }

  return (
    <>
      <VaultStatus />

      <div className="flex items-center justify-between mb-12">
        <div>
          <h1 className="font-headline text-4xl font-bold tracking-tighter uppercase text-primary">
            Inbound Assets
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">
            {isScanning
              ? "Scanning..."
              : `${active.length} transfer${active.length !== 1 ? "s" : ""} found`}
          </p>
        </div>
        <button
          onClick={handleRescan}
          disabled={isScanning}
          className="font-headline text-[10px] uppercase tracking-widest text-primary hover:text-primary-fixed transition-colors disabled:opacity-30"
        >
          {isScanning ? "..." : "Rescan"}
        </button>
      </div>

      {dustCount > 0 && (
        <button
          onClick={() => setShowDust(!showDust)}
          className="mb-6 text-[10px] font-headline uppercase tracking-widest text-outline hover:text-primary transition-colors"
        >
          {showDust ? "Hide" : "Show"} {dustCount} dust balance{dustCount > 1 ? "s" : ""}
        </button>
      )}

      {/* Batch withdraw bar */}
      {active.length > 1 && (
        <div className="bg-surface-container p-4 mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <button
              onClick={selectAll}
              className="text-[10px] font-headline uppercase tracking-widest text-primary hover:text-primary-fixed transition-colors"
            >
              {selected.size === active.length ? "Deselect all" : "Select all"}
            </button>
            {selected.size > 0 && (
              <span className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant">
                {selected.size} selected
              </span>
            )}
          </div>
          {selected.size > 0 && (
            <div className="flex gap-2">
              <DestinationInput
                value={batchDest}
                onChange={setBatchDest}
                placeholder="Fresh destination for all (0x...)"
                className="w-full bg-surface-container-lowest border-none py-3 px-4 font-headline text-sm text-primary focus:ring-0"
              />
              <button
                onClick={handleBatchWithdraw}
                disabled={!batchDest || isBatchWithdrawing || isBatchBlocked}
                className="brushed-metal px-6 py-3 text-on-primary font-headline font-bold uppercase tracking-widest text-[10px] hover:brightness-110 transition-all disabled:opacity-30 flex-shrink-0"
              >
                {isBatchWithdrawing ? "..." : `Withdraw ${selected.size}`}
              </button>
            </div>
          )}
        </div>
      )}

      {active.length > 0 && (
        <section className="flex flex-col gap-4">
          {active.map(([m, i]) => (
            <StealthAddressRow
              key={i}
              address={m.stealthAddress}
              privateKey={m.stealthPrivateKey}
              selected={selected.has(i)}
              onToggleSelect={() => toggleSelect(i)}
              onWithdrawn={() => setWithdrawn((prev) => new Set(prev).add(i))}
              onDustStatus={(isDust) => markDust(i, isDust)}
            />
          ))}
        </section>
      )}


      {!isScanning && active.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center opacity-50">
          <h3 className="font-headline text-lg font-bold tracking-tighter uppercase mb-2">
            No Transfers Found
          </h3>
          <p className="text-sm max-w-xs leading-relaxed text-on-surface-variant">
            No stealth transfers matched your keys.
          </p>
        </div>
      )}
    </>
  );
}
