import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import {
  Contract,
  xdr,
  nativeToScVal,
  Address,
  rpc,
  Networks,
} from "@stellar/stellar-sdk";
import {
  decodeStealthMetaAddress,
  generateStealthAddress,
  bytesToHex,
  SCHEME_ID,
} from "@wraith/sdk";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentPublicInfo {
  name: string;
  metaAddress: string;
  publicKey: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_SERVER_URL = (import.meta.env.VITE_SERVER_URL || "https://cf8e3085ec9e91c97d42e12fb167220c266a5589-3000.dstack-pha-prod9.phala.network").replace(/\/+$/, "");
const HORIZON_URL = "https://horizon-testnet.stellar.org";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function truncateKey(key: string, len = 8): string {
  if (key.length <= len * 2 + 3) return key;
  return `${key.slice(0, len)}...${key.slice(-len)}`;
}

/* ------------------------------------------------------------------ */
/*  Pay Page                                                           */
/* ------------------------------------------------------------------ */

export default function Pay() {
  const { name } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();

  const serverUrl = DEFAULT_SERVER_URL;

  const [agentInfo, setAgentInfo] = useState<AgentPublicInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(searchParams.get("amount") || "");
  const [memo, setMemo] = useState(searchParams.get("memo") || "");

  const [paying, setPaying] = useState(false);
  const [payStatus, setPayStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  /* --- fetch agent info -------------------------------------------- */
  useEffect(() => {
    if (!name) {
      setError("No agent name specified");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchInfo() {
      try {
        const res = await fetch(`${serverUrl}/agent/info/${name}`);
        if (!res.ok) {
          throw new Error(`Agent "${name}" not found`);
        }
        const data = await res.json();
        if (cancelled) return;

        setAgentInfo({
          name: data.name,
          metaAddress: data.metaAddress,
          publicKey: data.publicKey,
        });
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load agent";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchInfo();
    return () => {
      cancelled = true;
    };
  }, [name, serverUrl]);

  /* --- handle payment ---------------------------------------------- */
  async function handlePay() {
    if (!agentInfo || !amount) return;

    setPaying(true);
    setPayStatus("Connecting wallet...");
    setError(null);

    try {
      // Connect Freighter
      const freighter = await import("@stellar/freighter-api");

      const { isConnected } = await freighter.isConnected();
      if (!isConnected) {
        throw new Error("Freighter wallet not found. Please install the Freighter extension.");
      }

      await freighter.requestAccess();
      const { address: senderAddress } = await freighter.getAddress();

      if (!senderAddress) {
        throw new Error("Failed to get wallet address from Freighter.");
      }

      setPayStatus("Generating stealth address...");

      // Decode meta-address and generate stealth address
      const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(agentInfo.metaAddress);
      const { stealthAddress, ephemeralPubKey, viewTag } = generateStealthAddress(
        spendingPubKey,
        viewingPubKey
      );

      setPayStatus("Building transaction...");

      // Build the createAccount transaction
      const { TransactionBuilder, Networks, Operation, Asset, Keypair } = await import(
        "@stellar/stellar-sdk"
      );

      // Fetch sender account
      const accountRes = await fetch(`${HORIZON_URL}/accounts/${senderAddress}`);
      if (!accountRes.ok) {
        throw new Error("Failed to fetch sender account from Horizon.");
      }
      const accountData = await accountRes.json();

      const builder = new TransactionBuilder(
        {
          accountId: () => senderAddress,
          sequenceNumber: () => accountData.sequence,
          incrementSequenceNumber: () => {},
        } as any,
        {
          fee: "100",
          networkPassphrase: Networks.TESTNET,
        }
      );

      // Create account operation (sends XLM to a new stealth address)
      builder.addOperation(
        Operation.createAccount({
          destination: stealthAddress,
          startingBalance: amount,
        })
      );

      // Add memo if provided
      if (memo) {
        const { Memo } = await import("@stellar/stellar-sdk");
        builder.addMemo(Memo.text(memo.slice(0, 28)));
      }

      builder.setTimeout(30);
      const tx = builder.build();

      setPayStatus("Signing transaction...");

      // Sign with Freighter
      const { signTransaction } = freighter;
      const signResult = await signTransaction(tx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });
      const signedXdr = (signResult as any).signedTxXdr ?? signResult;

      setPayStatus("Submitting transaction...");

      // Submit to Horizon
      const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `tx=${encodeURIComponent(signedXdr as string)}`,
      });

      const submitData = await submitRes.json();

      if (!submitRes.ok) {
        const extras = submitData?.extras?.result_codes;
        throw new Error(
          `Transaction failed: ${extras?.transaction || submitData.title || "unknown error"}`
        );
      }

      const hash = submitData.hash;
      setTxHash(hash);

      // Announce on-chain via Soroban announcer contract
      setPayStatus("Announcing on-chain...");

      try {
        const ANNOUNCER = "CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL";
        const SOROBAN_URL = "https://soroban-testnet.stellar.org";

        const { TransactionBuilder: TB2, Account: Acct2 } = await import("@stellar/stellar-sdk");

        const announceAcctRes = await fetch(`${HORIZON_URL}/accounts/${senderAddress}`);
        const announceAcctData = await announceAcctRes.json();
        const announceSource = new Acct2(senderAddress, announceAcctData.sequence);

        const contract = new Contract(ANNOUNCER);
        const announceTx = new TB2(announceSource, { fee: "100", networkPassphrase: Networks.TESTNET })
          .addOperation(
            contract.call(
              "announce",
              nativeToScVal(SCHEME_ID, { type: "u32" }),
              new Address(stealthAddress).toScVal(),
              xdr.ScVal.scvBytes(Buffer.from(ephemeralPubKey)),
              xdr.ScVal.scvBytes(Buffer.from([viewTag])),
            )
          )
          .setTimeout(30)
          .build();

        const sorobanServer = new rpc.Server(SOROBAN_URL);
        const simulated = await sorobanServer.simulateTransaction(announceTx);

        if (!("error" in simulated)) {
          const assembled = rpc.assembleTransaction(
            announceTx,
            simulated as rpc.Api.SimulateTransactionSuccessResponse
          ).build();

          const signResult2 = await freighter.signTransaction(assembled.toXDR(), {
            networkPassphrase: Networks.TESTNET,
          });
          const signedXdr2 = (signResult2 as any).signedTxXdr ?? signResult2;

          const submitRes2 = await fetch(`${HORIZON_URL}/transactions`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `tx=${encodeURIComponent(signedXdr2 as string)}`,
          });
          const submitData2 = await submitRes2.json();
          if (submitRes2.ok) {
            console.log("[wraith] Announcement tx:", submitData2.hash);
          }
        }
      } catch (announceErr) {
        console.warn("[wraith] Announcement failed (non-fatal):", announceErr);
      }

      setPayStatus("Payment sent successfully!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Payment failed";
      setError(msg);
      setPayStatus(null);
    } finally {
      setPaying(false);
    }
  }

  /* --- loading screen ---------------------------------------------- */
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest">
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

  /* --- error screen ------------------------------------------------ */
  if (!agentInfo) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest">
        <div className="text-center max-w-md px-6">
          <img src="/logo.png" alt="Wraith" className="h-14 mx-auto mb-4 opacity-80" />
          <p className="text-on-surface-variant mb-4">
            {error || "Agent not found"}
          </p>
          <a
            href="/"
            className="text-outline hover:text-on-surface-variant transition-colors text-sm"
          >
            Go to home
          </a>
        </div>
      </div>
    );
  }

  /* --- pay screen -------------------------------------------------- */
  const pageUrl = window.location.href;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-center gap-2 h-14 mb-4">
          <a href="/" className="flex items-center gap-3">
            <img src="/logo.png" alt="Wraith" className="h-6 opacity-80" />
            <span className="font-headline tracking-widest text-sm font-bold text-on-surface">WRAITH</span>
          </a>
        </div>

        {/* Card */}
        <div className="bg-surface border border-outline-variant/10">
          {/* Card header */}
          <div className="bg-surface-container-low px-6 py-5 text-center border-b border-outline-variant/10">
            <h1 className="text-3xl font-headline font-black uppercase text-on-surface">
              {name}.wraith
            </h1>
            <p className="font-mono text-[10px] text-outline mt-2 uppercase tracking-wider">Payment Terminal</p>
          </div>

          {/* QR Code */}
          <div className="flex justify-center py-5 bg-surface-container-low mx-6 mt-4">
            <div className="bg-white p-3">
              <QRCodeCanvas
                value={pageUrl}
                size={140}
                bgColor="#ffffff"
                fgColor="#0e0e0e"
                level="M"
              />
            </div>
          </div>

          {/* Payment form */}
          <div className="px-6 py-4 space-y-3">
            <div className="bg-surface-container-low px-3 py-2.5">
              <label className="block font-mono text-[10px] text-outline uppercase tracking-wider mb-1">Amount (XLM)</label>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                disabled={!!txHash || paying}
                className="w-full bg-transparent text-2xl text-on-surface font-mono placeholder:text-outline-variant outline-none disabled:opacity-50"
              />
            </div>
            <div className="bg-surface-container-low px-3 py-2.5">
              <label className="block font-mono text-[10px] text-outline uppercase tracking-wider mb-1">Memo (optional)</label>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="What's this for?"
                disabled={!!txHash || paying}
                className="w-full bg-transparent text-sm text-on-surface placeholder:text-outline-variant outline-none disabled:opacity-50"
              />
            </div>
          </div>

          {/* Success state */}
          {txHash && (
            <div className="px-6 pb-4">
              <div className="bg-surface-container-low px-3 py-2.5">
                <p className="text-sm text-tertiary mb-1">Payment sent!</p>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-on-surface-variant font-mono break-all hover:text-primary transition-colors"
                >
                  {truncateKey(txHash, 12)}
                </a>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-6 pb-4">
              <p className="text-sm text-error animate-fade-in">{error}</p>
            </div>
          )}

          {/* Status */}
          {payStatus && !txHash && (
            <div className="px-6 pb-2 text-center">
              <p className="text-sm text-on-surface-variant">{payStatus}</p>
            </div>
          )}

          {/* Actions */}
          <div className="px-6 pb-6 space-y-2">
            {!txHash && (
              <button
                onClick={handlePay}
                disabled={paying || !amount}
                className="w-full bg-white text-surface py-3 font-headline font-bold text-sm uppercase tracking-wider transition-all hover:neon-glow disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {paying ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 bg-surface animate-pulse-dots" style={{ animationDelay: "0s" }} />
                    <span className="inline-block h-1.5 w-1.5 bg-surface animate-pulse-dots" style={{ animationDelay: "0.2s" }} />
                    <span className="inline-block h-1.5 w-1.5 bg-surface animate-pulse-dots" style={{ animationDelay: "0.4s" }} />
                  </span>
                ) : (
                  "Connect Wallet & Pay"
                )}
              </button>
            )}
            <a
              href={`/agent/${name}`}
              className="block w-full py-2.5 text-center border border-outline text-on-surface-variant text-xs font-bold uppercase tracking-wider hover:bg-surface-bright transition-colors"
            >
              View Profile
            </a>
          </div>
        </div>

        {/* Footer */}
        <p className="font-mono text-[10px] text-outline-variant text-center mt-4">
          Payment goes to a stealth address. Only {name}.wraith can detect it.
        </p>
      </div>
    </div>
  );
}
