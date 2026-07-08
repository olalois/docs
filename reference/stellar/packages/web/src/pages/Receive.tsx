import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  TransactionBuilder,
  Operation,
  Account,
  Asset,
} from "@stellar/stellar-sdk";
import { signStellarTransaction, pubKeyToStellarAddress, bytesToHex } from "@wraith/sdk";
import { WalletButton } from "@/components/connect-button";
import { useScanAnnouncements } from "@/hooks/useScanAnnouncements";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { useStealthKeysContext } from "@/context/stealth-keys";
import { useWallet } from "@/context/wallet";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";
import { VaultStatus } from "@/components/vault-status";
import {
  DestinationInput,
  useIsBlocked,
} from "@/components/destination-input";
import { usePrivacy } from "@/context/privacy";
import { addressUrl, txUrl } from "@/lib/explorer";

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
  stealthScalar,
  stealthPubKeyBytes,
  selected,
  onToggleSelect,
  onWithdrawn,
  onDustStatus,
}: {
  address: string;
  stealthScalar: bigint;
  stealthPubKeyBytes: Uint8Array;
  selected: boolean;
  onToggleSelect: () => void;
  onWithdrawn: () => void;
  onDustStatus: (isDust: boolean) => void;
}) {
  const { network } = useWallet();
  const { balances, isLoading, isDust } = useTokenBalances(address);

  const dustRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!isLoading && dustRef.current !== isDust) {
      dustRef.current = isDust;
      onDustStatus(isDust);
    }
  }, [isLoading, isDust, onDustStatus]);

  const { toast } = useToast();
  const { addUsedDestination } = usePrivacy();
  const [showKey, setShowKey] = useState(false);
  const [withdrawDest, setWithdrawDest] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawHash, setWithdrawHash] = useState<string | null>(null);
  const isBlocked = useIsBlocked(withdrawDest);

  // Display the stealth scalar as hex for "reveal key"
  const scalarHex = stealthScalar.toString(16).padStart(64, "0");

  const url = addressUrl(network, address);

  const handleWithdraw = async () => {
    if (!withdrawDest || isBlocked) return;
    setIsWithdrawing(true);
    try {
      // For MVP: build a simple XLM transfer from stealth address to destination
      // This requires the stealth account to be funded and use the derived keypair
      const horizonUrl =
        network === "testnet"
          ? "https://horizon-testnet.stellar.org"
          : "https://horizon.stellar.org";
      const networkPassphrase =
        network === "testnet"
          ? "Test SDF Network ; September 2015"
          : "Public Global Stellar Network ; September 2015";

      // Fetch account
      const res = await fetch(`${horizonUrl}/accounts/${address}`);
      if (!res.ok) throw new Error("Account not found or not funded");
      const account = await res.json();

      const xlmBalance = account.balances?.find(
        (b: { asset_type: string }) => b.asset_type === "native"
      );
      if (!xlmBalance || parseFloat(xlmBalance.balance) === 0) {
        throw new Error("No XLM balance");
      }

      const sourceAccount = new Account(address, account.sequence);
      const fee = "100"; // 100 stroops base fee

      // Reserve: 0.5 XLM base + 0.5 per subentry
      const subentryCount = account.subentry_count ?? 0;
      const reserve = (2 + subentryCount) * 0.5;
      const sendableAmount = (
        parseFloat(xlmBalance.balance) -
        reserve -
        0.00001
      ).toFixed(7);

      if (parseFloat(sendableAmount) <= 0) {
        throw new Error("Balance too low to cover reserve");
      }

      const tx = new TransactionBuilder(sourceAccount, {
        fee,
        networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination: withdrawDest,
            asset: Asset.native(),
            amount: sendableAmount,
          })
        )
        .setTimeout(30)
        .build();

      // Sign with the stealth private scalar (custom ed25519 signing)
      const txHash = tx.hash();
      const signature = signStellarTransaction(txHash, stealthScalar, stealthPubKeyBytes);
      const signatureBase64 = Buffer.from(signature).toString("base64");
      tx.addSignature(address, signatureBase64);

      // Submit
      const submitRes = await fetch(`${horizonUrl}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `tx=${encodeURIComponent(tx.toXDR())}`,
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(
          submitData.extras?.result_codes?.transaction ||
            submitData.title ||
            "Transaction failed"
        );
      }

      setWithdrawHash(submitData.hash);
      addUsedDestination(withdrawDest);
      toast("Withdrawal sent", "success");
      onWithdrawn();
    } catch (err) {
      toast(parseError(err), "error");
    } finally {
      setIsWithdrawing(false);
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
            <span className="text-[10px] text-primary-on-primary font-bold">
              +
            </span>
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
                className="font-headline text-sm tracking-tight text-primary truncate max-w-[260px] hover:text-primary underline transition-colors"
              >
                {address}
              </a>
            ) : (
              <span className="font-headline text-sm tracking-tight text-primary truncate max-w-[260px]">
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
              placeholder="Fresh destination address (G...)"
              className="w-full bg-surface-container-lowest border-none py-3 px-4 font-headline text-sm text-primary focus:ring-0"
            />
            <button
              onClick={handleWithdraw}
              disabled={!withdrawDest || isWithdrawing || isBlocked}
              className="bg-primary px-6 py-3 text-primary-on-primary font-headline font-bold uppercase tracking-widest text-[10px] hover:brightness-110 transition-all disabled:opacity-30 flex-shrink-0"
            >
              {isWithdrawing ? "..." : "Withdraw"}
            </button>
          </div>
        </div>
      )}

      {withdrawHash && (
        <div className="ml-8 flex items-center gap-2">
          <span className="text-primary text-sm">[+]</span>
          <span className="text-[10px] text-on-surface-variant font-body">
            Withdrawn --{" "}
            {(() => {
              const link = txUrl(network, withdrawHash);
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
            Reveal secret key
          </button>
        ) : (
          <div className="bg-error-container/5 p-4 border border-error/20 relative overflow-hidden">
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
                <span className="text-[9px] font-headline uppercase tracking-[0.2em] text-error font-bold">
                  Sensitive: Stealth Key
                </span>
                <CopyButton text={scalarHex} />
              </div>
              <code className="font-headline text-[11px] break-all text-on-surface leading-tight tracking-normal">
                {scalarHex}
              </code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Receive() {
  const { isConnected, network } = useWallet();
  const { keys } = useStealthKeysContext();
  const { scan, matched, isScanning } = useScanAnnouncements();
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

  const dustCount = matched.filter(
    (_, i) => !withdrawn.has(i) && dustSet.has(i)
  ).length;

  useEffect(() => {
    if (!keys || hasScanned.current || isScanning) return;
    hasScanned.current = true;
    scan(keys.viewingKey, keys.spendingPubKey, keys.spendingScalar, true);
  }, [keys, scan, isScanning]);

  useEffect(() => {
    hasScanned.current = false;
  }, [keys?.spendingKey]);

  const handleRescan = () => {
    if (!keys) return;
    scan(keys.viewingKey, keys.spendingPubKey, keys.spendingScalar, false);
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

    const horizonUrl =
      network === "testnet"
        ? "https://horizon-testnet.stellar.org"
        : "https://horizon.stellar.org";
    const networkPassphrase =
      network === "testnet"
        ? "Test SDF Network ; September 2015"
        : "Public Global Stellar Network ; September 2015";

    setIsBatchWithdrawing(true);
    let success = 0;
    let failed = 0;

    for (const idx of Array.from(selected)) {
      const m = matched[idx];
      try {
        // Fetch stealth account
        const res = await fetch(`${horizonUrl}/accounts/${m.stealthAddress}`);
        if (!res.ok) { failed++; continue; }
        const account = await res.json();

        const xlmBal = account.balances?.find(
          (b: { asset_type: string }) => b.asset_type === "native"
        );
        if (!xlmBal || parseFloat(xlmBal.balance) === 0) { failed++; continue; }

        const subentryCount = account.subentry_count ?? 0;
        const reserve = (2 + subentryCount) * 0.5;
        const sendableAmount = (
          parseFloat(xlmBal.balance) - reserve - 0.00001
        ).toFixed(7);

        if (parseFloat(sendableAmount) <= 0) { failed++; continue; }

        const sourceAccount = new Account(m.stealthAddress, account.sequence);
        const tx = new TransactionBuilder(sourceAccount, {
          fee: "100",
          networkPassphrase,
        })
          .addOperation(
            Operation.payment({
              destination: batchDest,
              asset: Asset.native(),
              amount: sendableAmount,
            })
          )
          .setTimeout(30)
          .build();

        // Sign with stealth scalar
        const txHash = tx.hash();
        const signature = signStellarTransaction(txHash, m.stealthPrivateScalar, m.stealthPubKeyBytes);
        const signatureBase64 = Buffer.from(signature).toString("base64");
        tx.addSignature(m.stealthAddress, signatureBase64);

        const submitRes = await fetch(`${horizonUrl}/transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `tx=${encodeURIComponent(tx.toXDR())}`,
        });

        if (submitRes.ok) {
          success++;
          setWithdrawn((prev) => new Set(prev).add(idx));
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    if (success > 0) {
      addUsedDestination(batchDest);
      toast(`Withdrew from ${success} address${success > 1 ? "es" : ""}`, "success");
    }
    if (failed > 0) toast(`${failed} withdrawal${failed > 1 ? "s" : ""} failed`, "error");

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
              : `${active.length} transfer${
                  active.length !== 1 ? "s" : ""
                } found`}
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
          {showDust ? "Hide" : "Show"} {dustCount} dust balance
          {dustCount > 1 ? "s" : ""}
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
                placeholder="Fresh destination for all (G...)"
                className="w-full bg-surface-container-lowest border-none py-3 px-4 font-headline text-sm text-primary focus:ring-0"
              />
              <button
                onClick={handleBatchWithdraw}
                disabled={!batchDest || isBatchWithdrawing || isBatchBlocked}
                className="bg-primary px-6 py-3 text-primary-on-primary font-headline font-bold uppercase tracking-widest text-[10px] hover:brightness-110 transition-all disabled:opacity-30 flex-shrink-0"
              >
                {isBatchWithdrawing
                  ? "..."
                  : `Withdraw ${selected.size}`}
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
              stealthScalar={m.stealthPrivateScalar}
              stealthPubKeyBytes={m.stealthPubKeyBytes}
              selected={selected.has(i)}
              onToggleSelect={() => toggleSelect(i)}
              onWithdrawn={() =>
                setWithdrawn((prev) => new Set(prev).add(i))
              }
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
