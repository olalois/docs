import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import {
  TransactionBuilder,
  Operation,
  Asset,
  Account,
  Networks,
  Contract,
  xdr,
  nativeToScVal,
  Address,
  rpc,
} from "@stellar/stellar-sdk";
import {
  decodeStealthMetaAddress,
  generateStealthAddress,
  bytesToHex,
  SCHEME_ID,
} from "@wraith/sdk";
import { requestAccess, getAddress, signTransaction } from "@stellar/freighter-api";

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || "https://cf8e3085ec9e91c97d42e12fb167220c266a5589-3000.dstack-pha-prod9.phala.network").replace(/\/+$/, "");
const HORIZON_URL = "https://horizon-testnet.stellar.org";

interface InvoiceData {
  id: string;
  agentName: string;
  amount: string;
  memo: string;
  status: string;
  metaAddress: string;
}

export default function PayInvoice() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payStatus, setPayStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!invoiceId) return;
    fetch(`${SERVER_URL}/invoice/${invoiceId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Invoice not found");
        return r.json();
      })
      .then((data) => setInvoice(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  async function handlePay() {
    if (!invoice) return;
    setPaying(true);
    setPayStatus("Connecting wallet...");

    try {
      await requestAccess();
      const result = await getAddress();
      const payerAddress = (result as any).address ?? result;

      if (!payerAddress) throw new Error("No wallet address");

      setPayStatus("Generating stealth address...");

      // Decode meta-address and generate stealth address
      const decoded = decodeStealthMetaAddress(invoice.metaAddress);
      const stealth = generateStealthAddress(
        decoded.spendingPubKey,
        decoded.viewingPubKey
      );

      setPayStatus("Building transaction...");

      // Fetch payer account
      const acctRes = await fetch(`${HORIZON_URL}/accounts/${payerAddress}`);
      if (!acctRes.ok) throw new Error("Could not load your account");
      const acctData = await acctRes.json();
      const sourceAccount = new Account(payerAddress, acctData.sequence);

      // Check if stealth account exists
      const stealthExists = await fetch(
        `${HORIZON_URL}/accounts/${stealth.stealthAddress}`
      ).then((r) => r.ok);

      const amount = Math.max(parseFloat(invoice.amount), 1).toFixed(7);

      let tx;
      if (stealthExists) {
        tx = new TransactionBuilder(sourceAccount, {
          fee: "100",
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            Operation.payment({
              destination: stealth.stealthAddress,
              asset: Asset.native(),
              amount,
            })
          )
          .setTimeout(30)
          .build();
      } else {
        tx = new TransactionBuilder(sourceAccount, {
          fee: "100",
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            Operation.createAccount({
              destination: stealth.stealthAddress,
              startingBalance: amount,
            })
          )
          .setTimeout(30)
          .build();
      }

      setPayStatus("Signing transaction...");

      const signResult = await signTransaction(tx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });
      const signedXdr = (signResult as any).signedTxXdr ?? signResult;

      setPayStatus("Submitting...");

      const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `tx=${encodeURIComponent(signedXdr as string)}`,
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(
          submitData.extras?.result_codes?.transaction || "Transaction failed"
        );
      }

      setTxHash(submitData.hash);
      setPayStatus("Payment sent!");

      // Mark invoice as paid with tx hash
      await fetch(`${SERVER_URL}/invoice/${invoiceId}/paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: submitData.hash }),
      });

      // Update local state
      setInvoice((prev) => (prev ? { ...prev, status: "paid" } : prev));

      // Announce on-chain via Soroban announcer contract
      try {
        const ANNOUNCER = "CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL";
        const SOROBAN_URL = "https://soroban-testnet.stellar.org";

        const announceAcctRes = await fetch(`${HORIZON_URL}/accounts/${payerAddress}`);
        const announceAcctData = await announceAcctRes.json();
        const announceSource = new Account(payerAddress, announceAcctData.sequence);

        const contract = new Contract(ANNOUNCER);
        const announceTx = new TransactionBuilder(announceSource, {
          fee: "100",
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            contract.call(
              "announce",
              nativeToScVal(SCHEME_ID, { type: "u32" }),
              new Address(stealth.stealthAddress).toScVal(),
              xdr.ScVal.scvBytes(Buffer.from(stealth.ephemeralPubKey)),
              xdr.ScVal.scvBytes(Buffer.from([stealth.viewTag])),
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

          const signResult2 = await signTransaction(assembled.toXDR(), {
            networkPassphrase: Networks.TESTNET,
          });
          const signedXdr2 = (signResult2 as any).signedTxXdr ?? signResult2;

          await fetch(`${HORIZON_URL}/transactions`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `tx=${encodeURIComponent(signedXdr2 as string)}`,
          });
        }
      } catch (announceErr) {
        console.warn("[wraith] Announcement failed (non-fatal):", announceErr);
      }
    } catch (e: any) {
      setPayStatus(null);
      setError(e.message || "Payment failed");
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest">
        <p className="text-outline text-sm">Loading invoice...</p>
      </div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest">
        <div className="text-center">
          <img src="/logo.png" alt="Wraith" className="h-12 mx-auto mb-2 opacity-80" />
          <p className="text-error text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!invoice) return null;

  const pageUrl = window.location.href;
  const isPaid = invoice.status === "paid" || !!txHash;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface-container-lowest p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Wraith" className="h-10 mx-auto opacity-80" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-outline mt-1">Private Invoice</p>
        </div>

        {/* Invoice card */}
        <div className="bg-surface p-6 space-y-6">
          {/* Recipient */}
          <div className="text-center">
            <p className="font-mono text-[10px] text-outline uppercase tracking-widest mb-1">Pay to</p>
            <p className="font-headline font-black text-2xl text-on-surface">
              {invoice.agentName}.wraith
            </p>
          </div>

          {/* Amount */}
          <div className="text-center">
            <p className="text-4xl font-mono text-on-surface">
              {invoice.amount} <span className="text-lg text-outline">XLM</span>
            </p>
            {invoice.memo && (
              <p className="text-sm text-on-surface-variant mt-2">&ldquo;{invoice.memo}&rdquo;</p>
            )}
          </div>

          {/* QR Code */}
          <div className="flex justify-center">
            <div className="bg-surface-container-low p-4">
              <QRCodeCanvas
                value={pageUrl}
                size={180}
                bgColor="#0e0e0e"
                fgColor="#c6c6c7"
                level="H"
              />
            </div>
          </div>

          {/* Status / Actions */}
          {isPaid ? (
            <div className="text-center space-y-2">
              <p className="text-tertiary font-headline font-black uppercase">
                PAID
              </p>
              {txHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary underline hover:text-primary/80"
                >
                  View transaction
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {payStatus && (
                <p className="text-xs text-on-surface-variant text-center">{payStatus}</p>
              )}
              {error && (
                <p className="text-xs text-error text-center">{error}</p>
              )}
              <button
                onClick={handlePay}
                disabled={paying}
                className="w-full py-4 bg-white text-surface font-headline font-bold uppercase tracking-[0.2em] text-sm hover:brightness-110 transition-all disabled:opacity-30"
              >
                {paying ? "Processing..." : "Connect Wallet & Pay"}
              </button>
            </div>
          )}

          {/* Invoice ID */}
          <div className="pt-3">
            <p className="font-mono text-[9px] text-outline-variant text-center break-all">
              Invoice: {invoice.id}
            </p>
          </div>
        </div>

        {/* Privacy note */}
        <p className="font-mono text-[10px] text-outline-variant text-center mt-4">
          Payment goes to a stealth address. Only {invoice.agentName}.wraith can detect it.
        </p>
      </div>
    </div>
  );
}
