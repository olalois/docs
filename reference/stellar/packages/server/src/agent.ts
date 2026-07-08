import { randomUUID } from "crypto";
import {
  Keypair,
  TransactionBuilder,
  Account,
  Contract,
  xdr,
  nativeToScVal,
  Address,
  Operation,
  Asset,
  Networks,
  rpc,
} from "@stellar/stellar-sdk";
import { sha256 } from "@noble/hashes/sha256";
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  generateStealthAddress,
  scanAnnouncements,
  signStellarTransaction,
  bytesToHex,
  hexToBytes,
  SCHEME_ID,
} from "@wraith/sdk";
import type { StealthKeys, Announcement, MatchedAnnouncement } from "@wraith/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "./db.js";
import { encrypt, decrypt } from "./crypto.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;
const NAMES_CONTRACT = "CDEMB3MAE62ZOCCKZPTYSXR5CS5WVENPOU5MDVK4PNKTZXFVDC74AFBV";
const ANNOUNCER_CONTRACT = "CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL";
const FRIENDBOT_URL = "https://friendbot.stellar.org";

function formatHumanDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffH = Math.round(diffMs / (1000 * 60 * 60));
  const diffD = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const timeStr = d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

  if (diffMs < 0) return timeStr; // past
  if (diffH < 1) return `in ~${Math.max(1, Math.round(diffMs / 60000))} min (${timeStr})`;
  if (diffH < 24) return `in ~${diffH} hour${diffH > 1 ? "s" : ""} (${timeStr})`;
  if (diffD === 1) return `tomorrow (${timeStr})`;
  return `in ${diffD} days (${timeStr})`;
}
const DUMMY_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"; // Testnet USDC

// ---------------------------------------------------------------------------
// Notification helper
// ---------------------------------------------------------------------------

function createNotification(agentId: string, type: string, title: string, body: string) {
  db.prepare(
    "INSERT INTO notifications (agent_id, type, title, body) VALUES (?, ?, ?, ?)"
  ).run(agentId, type, title, body);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentInfo {
  id: string;
  name: string;
  publicKey: string;
  metaAddress: string;
}

interface AgentRow {
  id: string;
  name: string;
  owner_wallet: string | null;
  public_key: string;
  encrypted_secret: string;
  meta_address: string;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function deriveAgentStealthKeys(secretKey: string): StealthKeys {
  const keypair = Keypair.fromSecret(secretKey);
  const rawSecret = keypair.rawSecretKey();

  const syntheticSig = new Uint8Array(64);
  syntheticSig.set(sha256(new Uint8Array([...rawSecret, 0x01])), 0);
  syntheticSig.set(sha256(new Uint8Array([...rawSecret, 0x02])), 32);

  return deriveStealthKeys(syntheticSig);
}

function rowToInfo(row: AgentRow): AgentInfo {
  return {
    id: row.id,
    name: row.name,
    publicKey: row.public_key,
    metaAddress: row.meta_address,
  };
}

async function loadAccount(publicKey: string): Promise<Account> {
  const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
  if (!res.ok) throw new Error(`Failed to load account ${publicKey}`);
  const data = await res.json();
  return new Account(publicKey, data.sequence);
}

async function accountExists(publicKey: string): Promise<boolean> {
  const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
  return res.ok;
}

async function submitClassicTx(
  tx: ReturnType<typeof TransactionBuilder.prototype.build>,
  keypair: Keypair
): Promise<string> {
  tx.sign(keypair);
  const txXdr = tx.toEnvelope().toXDR("base64");

  const res = await fetch(`${HORIZON_URL}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `tx=${encodeURIComponent(txXdr)}`,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      data.extras?.result_codes?.transaction ||
        data.extras?.result_codes?.operations?.join(", ") ||
        data.title ||
        "Transaction failed"
    );
  }
  return data.hash as string;
}

async function simulateAndSubmitSoroban(
  tx: ReturnType<typeof TransactionBuilder.prototype.build>,
  keypair: Keypair
): Promise<string> {
  const server = new rpc.Server(SOROBAN_RPC_URL);
  const simulated = await server.simulateTransaction(tx);

  if ("error" in simulated) {
    throw new Error((simulated as { error: string }).error || "Simulation failed");
  }

  const assembled = rpc.assembleTransaction(tx, simulated as rpc.Api.SimulateTransactionSuccessResponse).build();
  assembled.sign(keypair);

  const response = await server.sendTransaction(assembled);
  if (response.status === "ERROR") {
    throw new Error("Soroban transaction submission failed");
  }

  // Poll for result
  let attempts = 0;
  while (attempts < 30) {
    const result = await server.getTransaction(response.hash);
    if (result.status === "NOT_FOUND") {
      attempts++;
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (result.status === "SUCCESS") {
      return response.hash;
    }
    if (result.status === "FAILED") {
      throw new Error("Soroban transaction failed on-chain");
    }
    break;
  }

  // If we got a hash but polling timed out or got a parse error, assume success
  return response.hash;
}

// ---------------------------------------------------------------------------
// Resolve a .wraith name via Soroban simulation
// ---------------------------------------------------------------------------

async function resolveWraithName(
  name: string
): Promise<{ metaAddress: string } | null> {
  try {
    const contract = new Contract(NAMES_CONTRACT);
    const tx = new TransactionBuilder(new Account(DUMMY_ACCOUNT, "0"), {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("resolve", xdr.ScVal.scvString(name)))
      .setTimeout(30)
      .build();

    const server = new rpc.Server(SOROBAN_RPC_URL);
    const simulated = await server.simulateTransaction(tx);

    if (
      !("error" in simulated) &&
      "result" in simulated &&
      (simulated as any).result?.retval
    ) {
      const retval = (simulated as any).result.retval;
      const resultXdr = xdr.ScVal.fromXDR(retval.toXDR());
      const bytes = resultXdr.bytes();
      if (bytes && bytes.length === 64) {
        const spendHex = bytesToHex(new Uint8Array(bytes.slice(0, 32)));
        const viewHex = bytesToHex(new Uint8Array(bytes.slice(32)));
        return { metaAddress: `st:xlm:${spendHex}${viewHex}` };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch announcement events from Soroban RPC
// ---------------------------------------------------------------------------

async function fetchAnnouncementEvents(): Promise<Announcement[]> {
  const all: Announcement[] = [];

  try {
    // Probe to discover valid ledger range
    let startLedger = 1;
    const probeRes = await fetch(SOROBAN_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "getEvents",
        params: {
          startLedger: 1,
          filters: [{ type: "contract", contractIds: [ANNOUNCER_CONTRACT] }],
          pagination: { limit: 1 },
        },
      }),
    });
    const probeData = await probeRes.json();

    if (probeData.error?.message) {
      const match = probeData.error.message.match(
        /range:\s*(\d+)\s*-\s*(\d+)/
      );
      if (match) {
        const oldest = parseInt(match[1], 10);
        const latest = parseInt(match[2], 10);
        startLedger = Math.max(oldest, latest - 5000);
      } else {
        return all;
      }
    } else if (probeData.result?.events?.length > 0) {
      startLedger = 1;
    }

    // Paginated fetch
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const params: any = {
        filters: [
          {
            type: "contract",
            contractIds: [ANNOUNCER_CONTRACT],
          },
        ],
        pagination: { limit: 1000 },
      };

      if (cursor) {
        params.pagination.cursor = cursor;
      } else {
        params.startLedger = startLedger;
      }

      const res = await fetch(SOROBAN_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "getEvents",
          params,
        }),
      });

      const data = await res.json();
      const events = data.result?.events ?? [];

      for (const event of events) {
        try {
          const ann = parseAnnouncementEvent(event);
          if (ann) all.push(ann);
        } catch {
          // Skip malformed events
        }
      }

      if (events.length < 1000) {
        hasMore = false;
      } else {
        cursor = data.result?.cursor;
        if (!cursor) hasMore = false;
      }
    }
  } catch {
    // Events API may not be available
  }

  return all;
}

function parseAnnouncementEvent(event: any): Announcement | null {
  const topics = event.topic;
  if (!topics || topics.length < 3) return null;

  const schemeIdScVal = xdr.ScVal.fromXDR(topics[1], "base64");
  const schemeId = schemeIdScVal.u32();

  const stealthScVal = xdr.ScVal.fromXDR(topics[2], "base64");
  const stealthScAddress = stealthScVal.address();
  const stealthAddress = Address.fromScAddress(stealthScAddress).toString();

  const valueScVal = xdr.ScVal.fromXDR(event.value, "base64");
  const valueVec = valueScVal.vec();
  if (!valueVec || valueVec.length < 3) return null;

  const callerScAddress = valueVec[0].address();
  const caller = Address.fromScAddress(callerScAddress).toString();

  const ephBytes = valueVec[1].bytes();
  const ephemeralPubKey = bytesToHex(new Uint8Array(ephBytes));

  const metaBytes = valueVec[2].bytes();
  const metadata = bytesToHex(new Uint8Array(metaBytes));

  return {
    schemeId,
    stealthAddress,
    caller,
    ephemeralPubKey,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function toolSendPayment(
  agentKeypair: Keypair,
  stealthKeys: StealthKeys,
  agentName: string,
  recipient: string,
  amount: string,
  asset: string = "XLM"
): Promise<Record<string, unknown>> {
  // Determine the meta-address of the recipient
  let metaAddress: string;

  if (recipient.startsWith("st:xlm:")) {
    metaAddress = recipient;
  } else if (recipient.startsWith("G") && recipient.length === 56) {
    // Raw Stellar address -- cannot send stealth to a raw address without meta-address
    throw new Error(
      "Cannot send stealth payment to a raw Stellar address. Use a .wraith name or st:xlm: meta-address."
    );
  } else {
    // Treat as a .wraith name
    const cleanName = recipient.replace(/\.wraith$/, "");
    const resolved = await resolveWraithName(cleanName);
    if (!resolved) {
      throw new Error(`Could not resolve name "${cleanName}.wraith"`);
    }
    metaAddress = resolved.metaAddress;
  }

  // Decode meta-address and generate stealth address
  const decoded = decodeStealthMetaAddress(metaAddress);
  const result = generateStealthAddress(
    decoded.spendingPubKey,
    decoded.viewingPubKey
  );

  // Check if the stealth account already exists
  const exists = await accountExists(result.stealthAddress);

  // Determine the asset
  const assetUpper = (asset || "XLM").toUpperCase();
  const stellarAsset = assetUpper === "USDC"
    ? new Asset("USDC", USDC_ISSUER)
    : Asset.native();

  // Build and submit the payment transaction
  const sourceAccount = await loadAccount(agentKeypair.publicKey());

  let tx;
  if (assetUpper !== "XLM" && !exists) {
    // For non-native assets, we must first create the account with XLM, then send the asset
    // Create account with minimum balance first
    const createTx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.createAccount({
          destination: result.stealthAddress,
          startingBalance: "2", // Minimum for trustline
        })
      )
      .setTimeout(30)
      .build();
    await submitClassicTx(createTx, agentKeypair);

    // Now send the asset payment (stealth account needs trustline set up externally)
    const freshSource = await loadAccount(agentKeypair.publicKey());
    tx = new TransactionBuilder(freshSource, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: result.stealthAddress,
          asset: stellarAsset,
          amount,
        })
      )
      .setTimeout(30)
      .build();
  } else if (exists) {
    tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: result.stealthAddress,
          asset: stellarAsset,
          amount,
        })
      )
      .setTimeout(30)
      .build();
  } else {
    tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.createAccount({
          destination: result.stealthAddress,
          startingBalance: amount,
        })
      )
      .setTimeout(30)
      .build();
  }

  const txHash = await submitClassicTx(tx, agentKeypair);

  // Announce via Soroban announcer contract
  try {
    const freshAccount = await loadAccount(agentKeypair.publicKey());
    const announcerContract = new Contract(ANNOUNCER_CONTRACT);

    const announceTx = new TransactionBuilder(freshAccount, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        announcerContract.call(
          "announce",
          nativeToScVal(SCHEME_ID, { type: "u32" }),
          new Address(result.stealthAddress).toScVal(),
          xdr.ScVal.scvBytes(Buffer.from(result.ephemeralPubKey)),
          xdr.ScVal.scvBytes(Buffer.from([result.viewTag]))
        )
      )
      .setTimeout(30)
      .build();

    await simulateAndSubmitSoroban(announceTx, agentKeypair);
  } catch {
    // Announcement is best-effort -- payment already succeeded
  }

  return {
    txHash,
    txLink: `https://stellar.expert/explorer/testnet/tx/${txHash}`,
    stealthAddress: result.stealthAddress,
    amount,
    asset: assetUpper,
    recipient,
  };
}

async function toolScanPayments(
  stealthKeys: StealthKeys
): Promise<Record<string, unknown>[]> {
  const announcements = await fetchAnnouncementEvents();

  const matched = scanAnnouncements(
    announcements,
    stealthKeys.viewingKey,
    stealthKeys.spendingPubKey,
    stealthKeys.spendingScalar
  );

  const results: Record<string, unknown>[] = [];

  for (const match of matched) {
    let balance = "0";
    try {
      const res = await fetch(
        `${HORIZON_URL}/accounts/${match.stealthAddress}`
      );
      if (res.ok) {
        const accountData = await res.json();
        const nativeBalance = accountData.balances?.find(
          (b: any) => b.asset_type === "native"
        );
        if (nativeBalance) {
          balance = nativeBalance.balance;
        }
      }
    } catch {
      // Account may not exist
    }

    results.push({
      stealthAddress: match.stealthAddress,
      balance,
      viewTag: match.metadata.slice(0, 2),
    });
  }

  return results;
}

async function toolGetBalance(
  publicKey: string
): Promise<Record<string, unknown>> {
  let balance = "0";
  const assets: Array<{ asset: string; balance: string }> = [];
  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (res.ok) {
      const accountData = await res.json();
      for (const b of accountData.balances || []) {
        if (b.asset_type === "native") {
          balance = b.balance;
          assets.push({ asset: "XLM", balance: b.balance });
        } else if (b.asset_code) {
          assets.push({ asset: b.asset_code, balance: b.balance });
        }
      }
    }
  } catch {
    // Account may not exist
  }

  return { publicKey, balance, assets };
}

async function toolCreateInvoice(
  agentId: string,
  agentName: string,
  amount: string,
  memo: string,
  clientOrigin: string
): Promise<Record<string, unknown>> {
  const invoiceId = randomUUID();
  db.prepare(
    `INSERT INTO invoices (id, agent_id, amount, memo, status) VALUES (?, ?, ?, ?, 'pending')`
  ).run(invoiceId, agentId, amount, memo);

  const payUrl = `${clientOrigin}/pay/invoice/${invoiceId}`;
  return {
    invoiceId,
    payTo: `${agentName}.wraith`,
    amount,
    memo,
    status: "pending",
    paymentLink: payUrl,
    markdownLink: `[Pay ${amount} XLM →](${payUrl})`,
  };
}

async function toolResolveName(
  name: string
): Promise<Record<string, unknown>> {
  const cleanName = name.replace(/\.wraith$/, "");
  const resolved = await resolveWraithName(cleanName);
  if (resolved) {
    return { name: cleanName, metaAddress: resolved.metaAddress };
  }
  return { name: cleanName, error: "not found" };
}

async function toolRegisterName(
  agentKeypair: Keypair,
  stealthKeys: StealthKeys,
  name: string
): Promise<Record<string, unknown>> {
  const cleanName = name.replace(/\.wraith$/, "");

  const sourceAccount = await loadAccount(agentKeypair.publicKey());
  const contract = new Contract(NAMES_CONTRACT);

  const metaBytes = new Uint8Array(64);
  metaBytes.set(stealthKeys.spendingPubKey, 0);
  metaBytes.set(stealthKeys.viewingPubKey, 32);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "register",
        new Address(agentKeypair.publicKey()).toScVal(),
        xdr.ScVal.scvString(cleanName),
        xdr.ScVal.scvBytes(Buffer.from(metaBytes))
      )
    )
    .setTimeout(30)
    .build();

  const txHash = await simulateAndSubmitSoroban(tx, agentKeypair);
  return { name: cleanName, txHash, txLink: `https://stellar.expert/explorer/testnet/tx/${txHash}` };
}

async function toolGetAgentInfo(
  agentName: string,
  publicKey: string,
  metaAddress: string
): Promise<Record<string, unknown>> {
  const balanceResult = await toolGetBalance(publicKey);
  return {
    name: agentName,
    publicKey,
    metaAddress,
    network: "testnet",
    balance: balanceResult.balance,
  };
}

// ---------------------------------------------------------------------------
// Gemini tool declarations
// ---------------------------------------------------------------------------

const tools = [
  {
    functionDeclarations: [
      {
        name: "send_payment",
        description:
          "Send XLM privately to a .wraith name or stealth meta-address via a fresh stealth address",
        parameters: {
          type: "OBJECT",
          properties: {
            recipient: {
              type: "STRING",
              description:
                "Recipient .wraith name or st:xlm: meta-address",
            },
            amount: {
              type: "STRING",
              description: "Amount to send",
            },
            asset: {
              type: "STRING",
              description: "Asset to send: 'XLM' (default) or 'USDC'",
            },
          },
          required: ["recipient", "amount"],
        },
      },
      {
        name: "scan_payments",
        description:
          "Scan for incoming stealth payments addressed to this agent by checking on-chain announcements",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "get_balance",
        description:
          "Get the XLM balance of this agent's main wallet",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "create_invoice",
        description:
          "Create a payment invoice. Always include the markdownLink from the response in your reply exactly as-is so users can click it.",
        parameters: {
          type: "OBJECT",
          properties: {
            amount: {
              type: "STRING",
              description: "Amount to request",
            },
            memo: {
              type: "STRING",
              description: "Memo or description for the invoice",
            },
            asset: {
              type: "STRING",
              description: "Asset to request: 'XLM' (default) or 'USDC'",
            },
          },
          required: ["amount", "memo"],
        },
      },
      {
        name: "resolve_name",
        description:
          "Resolve a .wraith name to its stealth meta-address",
        parameters: {
          type: "OBJECT",
          properties: {
            name: {
              type: "STRING",
              description:
                "The .wraith name to resolve (e.g. 'alice' or 'alice.wraith')",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "register_name",
        description:
          "Register a .wraith name on-chain for this agent (additional names beyond the one set at creation)",
        parameters: {
          type: "OBJECT",
          properties: {
            name: {
              type: "STRING",
              description: "The name to register (without .wraith suffix)",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "get_agent_info",
        description:
          "Get this agent's full info including name, public key, meta-address, network, and balance",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "withdraw",
        description:
          "Withdraw funds from a stealth address to a destination address. Uses custom ed25519 scalar signing.",
        parameters: {
          type: "OBJECT",
          properties: {
            from: {
              type: "STRING",
              description: "The stealth address (G...) to withdraw from",
            },
            to: {
              type: "STRING",
              description: "The destination address (G...) to send funds to",
            },
          },
          required: ["from", "to"],
        },
      },
      {
        name: "withdraw_all",
        description:
          "Scan for all stealth payments, then withdraw from each one to a destination. Provides privacy recommendations about timing and address usage.",
        parameters: {
          type: "OBJECT",
          properties: {
            to: {
              type: "STRING",
              description: "The destination address (G...) for all withdrawals",
            },
          },
          required: ["to"],
        },
      },
      {
        name: "privacy_check",
        description:
          "Analyze the agent's stealth address activity for privacy leaks. Checks timing patterns, address reuse, balance correlations, and provides recommendations.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "fund_wallet",
        description:
          "Fund the agent's wallet with testnet XLM from Friendbot (testnet only)",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "check_invoices",
        description:
          "Check the status of all invoices. Scans for incoming payments and marks invoices as paid when matching payments are detected.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "schedule_payment",
        description:
          "Schedule a recurring private payment. Supports intervals: hourly, daily, weekly, monthly. Optionally set an end date.",
        parameters: {
          type: "OBJECT",
          properties: {
            recipient: {
              type: "STRING",
              description: "Recipient .wraith name or meta-address",
            },
            amount: {
              type: "STRING",
              description: "Amount of XLM to send each time",
            },
            interval: {
              type: "STRING",
              description: "Payment interval: 'hourly', 'daily', 'weekly', or 'monthly'",
            },
            end_date: {
              type: "STRING",
              description: "Optional end date in natural language (e.g. '2026-05-01', 'in 30 days', 'end of month'). Schedule stops after this date.",
            },
            memo: {
              type: "STRING",
              description: "Optional memo",
            },
          },
          required: ["recipient", "amount", "interval"],
        },
      },
      {
        name: "list_schedules",
        description:
          "List all scheduled recurring payments for this agent, including active, paused, and ended ones.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      },
      {
        name: "manage_schedule",
        description:
          "Manage a scheduled payment: pause, resume, or cancel it.",
        parameters: {
          type: "OBJECT",
          properties: {
            schedule_id: {
              type: "STRING",
              description: "The schedule ID (first 8 characters are enough)",
            },
            action: {
              type: "STRING",
              description: "Action to take: 'pause', 'resume', or 'cancel'",
            },
          },
          required: ["schedule_id", "action"],
        },
      },
      {
        name: "pay_agent",
        description:
          "Pay another Wraith agent privately. Resolves their .wraith name and sends XLM via a stealth address.",
        parameters: {
          type: "OBJECT",
          properties: {
            agent_name: {
              type: "STRING",
              description:
                "The recipient agent's .wraith name (e.g. 'oracle' or 'oracle.wraith')",
            },
            amount: {
              type: "STRING",
              description: "Amount of XLM to send",
            },
            memo: {
              type: "STRING",
              description: "Optional memo for the payment",
            },
          },
          required: ["agent_name", "amount"],
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new agent: generates Stellar keypair, funds via Friendbot,
 * derives stealth keys, registers .wraith name, and stores in DB.
 */
export async function createAgent(name: string, ownerWallet?: string): Promise<AgentInfo> {
  const cleanName = name.replace(/\.wraith$/, "");

  // Check if name already taken in local DB
  const existing = db
    .prepare("SELECT id FROM agents WHERE name = ?")
    .get(cleanName) as AgentRow | undefined;
  if (existing) {
    throw new Error(`Agent name "${cleanName}" is already taken`);
  }

  // Generate random Stellar keypair
  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();
  const secret = keypair.secret();

  // Fund via Friendbot
  const friendbotRes = await fetch(
    `${FRIENDBOT_URL}/?addr=${publicKey}`
  );
  if (!friendbotRes.ok) {
    const errText = await friendbotRes.text();
    throw new Error(`Friendbot funding failed: ${errText}`);
  }

  // Derive stealth keys
  const stealthKeys = deriveAgentStealthKeys(secret);
  const metaAddress = encodeStealthMetaAddress(
    stealthKeys.spendingPubKey,
    stealthKeys.viewingPubKey
  );

  // Encrypt the secret key
  const encryptedSecret = encrypt(secret);

  // Generate agent ID
  const id = randomUUID();

  // Store in SQLite
  db.prepare(
    `INSERT INTO agents (id, name, owner_wallet, public_key, encrypted_secret, meta_address)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, cleanName, ownerWallet || null, publicKey, encryptedSecret, metaAddress);

  // Register the .wraith name on-chain
  try {
    await toolRegisterName(keypair, stealthKeys, cleanName);
  } catch (err) {
    console.error(
      `[agent] Warning: Failed to register name "${cleanName}.wraith" on-chain:`,
      err
    );
    // Agent is still usable even if name registration fails
  }

  return { id, name: cleanName, publicKey, metaAddress };
}

/**
 * Looks up an agent by its UUID.
 */
export function getAgent(id: string): AgentInfo | null {
  const row = db
    .prepare("SELECT * FROM agents WHERE id = ?")
    .get(id) as AgentRow | undefined;
  return row ? rowToInfo(row) : null;
}

/**
 * Looks up an agent by its .wraith name.
 */
export function getAgentByWallet(wallet: string): AgentInfo | null {
  const row = db
    .prepare("SELECT * FROM agents WHERE owner_wallet = ?")
    .get(wallet) as AgentRow | undefined;
  return row ? rowToInfo(row) : null;
}

export function getAgentByName(name: string): AgentInfo | null {
  const cleanName = name.replace(/\.wraith$/, "");
  const row = db
    .prepare("SELECT * FROM agents WHERE name = ?")
    .get(cleanName) as AgentRow | undefined;
  return row ? rowToInfo(row) : null;
}

/**
 * Sends a message to the agent's AI and returns its response.
 * Handles tool call loops — the AI can invoke tools and get results back.
 */
export async function chat(
  agentId: string,
  message: string,
  history: Array<{ role: string; text: string }>,
  clientOrigin?: string
): Promise<{
  response: string;
  toolCalls: Array<{ name: string; status: string; detail?: string }>;
}> {
  // Load agent from DB
  const row = db
    .prepare("SELECT * FROM agents WHERE id = ?")
    .get(agentId) as AgentRow | undefined;
  if (!row) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Decrypt secret and derive keys
  const secret = decrypt(row.encrypted_secret);
  const keypair = Keypair.fromSecret(secret);
  const stealthKeys = deriveAgentStealthKeys(secret);

  // Initialize Gemini
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `You are "${row.name}.wraith", an AI agent on the Stellar blockchain with stealth payment capabilities powered by the Wraith protocol.

Your Stellar public key: ${row.public_key}
Your stealth meta-address: ${row.meta_address}
Your .wraith name: ${row.name}.wraith
Network: Stellar Testnet

You can:
- Send private XLM payments via stealth addresses (send_payment)
- Pay another Wraith agent privately by name (pay_agent)
- Scan for incoming stealth payments (scan_payments)
- Check your wallet balance (get_balance)
- Create payment invoices (create_invoice)
- Check invoice statuses and match incoming payments (check_invoices)
- Withdraw funds from a stealth address (withdraw)
- Withdraw from all stealth addresses (withdraw_all)
- Schedule recurring payments with optional end dates (schedule_payment)
- List scheduled payments (list_schedules)
- Pause, resume, or cancel schedules (manage_schedule)
- Resolve .wraith names (resolve_name)
- Register additional .wraith names (register_name)
- Show your full agent info (get_agent_info)
- Deep privacy analysis with actionable recommendations (privacy_check)

When users ask you to do things, use the appropriate tools. Be helpful, concise, and proactive about using tools when relevant.

FORMATTING RULES:
- Always use markdown for structured data. Use **bold** for labels, code blocks for addresses/keys, and tables or lists where appropriate.
- When a tool result includes a txLink, ALWAYS show the transaction as a clickable markdown link like [tx](txLink). Never show raw transaction hashes — always link them.
- For agent info, format it cleanly like:
  **Name:** name.wraith
  **Public Key:** \`GABC...\`
  **Balance:** 100 XLM
  etc.
- Keep responses concise but well-formatted. Use line breaks between sections.

Always refer to yourself as "${row.name}.wraith" when introducing yourself.`,
    tools: tools as any,
  });

  // Build chat history
  const chatHistory: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const entry of history) {
    if (!entry.text || entry.text.trim() === "") continue;
    const role = entry.role === "user" ? "user" : "model";
    chatHistory.push({ role, parts: [{ text: entry.text }] });
  }

  const chatSession = model.startChat({ history: chatHistory });

  // Send the message
  let result = await chatSession.sendMessage(message);
  const toolCallResults: Array<{
    name: string;
    status: string;
    detail?: string;
  }> = [];

  // Tool call loop -- keep processing until the model produces text without tool calls
  let maxIterations = 10;
  while (maxIterations > 0) {
    maxIterations--;

    const candidate = result.response.candidates?.[0];
    if (!candidate) break;

    const parts = candidate.content?.parts ?? [];
    const functionCalls = parts.filter((p: any) => p.functionCall);

    if (functionCalls.length === 0) break;

    // Execute each tool call
    const functionResponses: Array<{
      functionResponse: { name: string; response: Record<string, unknown> };
    }> = [];

    for (const part of functionCalls) {
      const fc = (part as any).functionCall;
      const toolName = fc.name;
      const args = fc.args || {};

      let toolResult: Record<string, unknown>;
      let status = "success";
      let detail: string | undefined;

      try {
        switch (toolName) {
          case "send_payment": {
            const sendAsset = ((args.asset as string) || "XLM").toUpperCase();
            toolResult = await toolSendPayment(
              keypair,
              stealthKeys,
              row.name,
              args.recipient,
              args.amount,
              sendAsset
            );
            detail = `Sent ${args.amount} ${sendAsset} to ${args.recipient}`;
            createNotification(row.id, "payment_sent", "Payment Sent", `Sent ${args.amount} ${sendAsset} to ${args.recipient}.`);
            break;
          }

          case "scan_payments": {
            const payments = await toolScanPayments(stealthKeys);
            toolResult = { payments, count: payments.length };
            detail = `Found ${payments.length} stealth payment(s)`;
            if (payments.length > 0) {
              createNotification(row.id, "payment_received", "Payments Detected", `Found ${payments.length} incoming stealth payment(s).`);
            }
            break;
          }

          case "get_balance": {
            toolResult = await toolGetBalance(keypair.publicKey());
            const assetList = (toolResult.assets as Array<any>) || [];
            detail = assetList.map((a: any) => `${a.balance} ${a.asset}`).join(", ") || `${toolResult.balance} XLM`;
            break;
          }

          case "create_invoice":
            toolResult = await toolCreateInvoice(
              row.id,
              row.name,
              args.amount,
              args.memo,
              clientOrigin || "http://localhost:5175"
            );
            detail = `Invoice created for ${args.amount} XLM`;
            break;

          case "resolve_name":
            toolResult = await toolResolveName(args.name);
            detail = toolResult.error
              ? `Name "${args.name}" not found`
              : `Resolved to ${(toolResult.metaAddress as string).slice(0, 20)}...`;
            break;

          case "register_name":
            toolResult = await toolRegisterName(
              keypair,
              stealthKeys,
              args.name
            );
            detail = `Registered name "${args.name}.wraith"`;
            break;

          case "get_agent_info":
            toolResult = await toolGetAgentInfo(
              row.name,
              keypair.publicKey(),
              row.meta_address
            );
            detail = "Retrieved agent info";
            break;

          case "withdraw": {
            const from = args.from as string;
            const to = args.to as string;
            // Scan announcements to find the matching stealth address with private scalar
            const announcements = await fetchAnnouncementEvents();
            const matchedAnnouncements = scanAnnouncements(
              announcements,
              stealthKeys.viewingKey,
              stealthKeys.spendingPubKey,
              stealthKeys.spendingScalar
            );
            const matchedEntry = matchedAnnouncements.find(
              (m) => m.stealthAddress === from
            );
            if (!matchedEntry) {
              toolResult = { error: `Stealth address ${from} not found in your payments. Run scan_payments first.` };
              status = "error";
              detail = "Stealth address not found";
            } else {
              const horizonRes = await fetch(`${HORIZON_URL}/accounts/${from}`);
              if (!horizonRes.ok) {
                toolResult = { error: "Stealth account not found on network" };
                status = "error";
              } else {
                const acct = await horizonRes.json();
                const xlmBal = acct.balances?.find((b: any) => b.asset_type === "native");
                const reserve = (2 + (acct.subentry_count ?? 0)) * 0.5;
                const sendable = (parseFloat(xlmBal?.balance || "0") - reserve - 0.00001).toFixed(7);

                if (parseFloat(sendable) <= 0) {
                  toolResult = { error: "Balance too low to withdraw" };
                  status = "error";
                } else {
                  // Build the payment transaction from the stealth address
                  const stealthAccount = new Account(from, acct.sequence);
                  const withdrawTx = new TransactionBuilder(stealthAccount, {
                    fee: "100",
                    networkPassphrase: NETWORK_PASSPHRASE,
                  })
                    .addOperation(
                      Operation.payment({
                        destination: to,
                        asset: Asset.native(),
                        amount: sendable,
                      })
                    )
                    .setTimeout(30)
                    .build();

                  // Sign with the stealth private scalar
                  const txHash = withdrawTx.hash();
                  const signature = signStellarTransaction(
                    txHash,
                    matchedEntry.stealthPrivateScalar,
                    matchedEntry.stealthPubKeyBytes
                  );
                  const signatureBase64 = Buffer.from(signature).toString("base64");
                  withdrawTx.addSignature(from, signatureBase64);

                  // Submit to Horizon
                  const txXdr = withdrawTx.toEnvelope().toXDR("base64");
                  const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: `tx=${encodeURIComponent(txXdr)}`,
                  });
                  const submitData = await submitRes.json();
                  if (!submitRes.ok) {
                    toolResult = {
                      error: submitData.extras?.result_codes?.transaction ||
                        submitData.extras?.result_codes?.operations?.join(", ") ||
                        submitData.title ||
                        "Withdrawal transaction failed",
                    };
                    status = "error";
                    detail = "Withdrawal transaction failed";
                  } else {
                    toolResult = {
                      txHash: submitData.hash,
                      txLink: `https://stellar.expert/explorer/testnet/tx/${submitData.hash}`,
                      withdrawn: sendable,
                      from,
                      to,
                    };
                    detail = `Withdrew ${sendable} XLM from ${from.slice(0, 8)}... to ${to.slice(0, 8)}...`;
                    createNotification(row.id, "withdrawal", "Withdrawal Complete", `Withdrew ${sendable} XLM to ${to.slice(0, 8)}...${to.slice(-4)}.`);
                  }
                }
              }
            }
            break;
          }

          case "withdraw_all": {
            const dest = args.to as string;
            // Scan announcements for all matching stealth addresses
            const allAnnouncements = await fetchAnnouncementEvents();
            const allMatched = scanAnnouncements(
              allAnnouncements,
              stealthKeys.viewingKey,
              stealthKeys.spendingPubKey,
              stealthKeys.spendingScalar
            );

            if (allMatched.length === 0) {
              toolResult = { message: "No stealth payments found to withdraw." };
            } else {
              const withdrawResults: Array<Record<string, unknown>> = [];
              let totalWithdrawn = 0;

              for (const matched of allMatched) {
                try {
                  const horizonRes = await fetch(`${HORIZON_URL}/accounts/${matched.stealthAddress}`);
                  if (!horizonRes.ok) {
                    withdrawResults.push({ address: matched.stealthAddress, status: "skipped", reason: "Account not found" });
                    continue;
                  }
                  const acct = await horizonRes.json();
                  const xlmBal = acct.balances?.find((b: any) => b.asset_type === "native");
                  const reserve = (2 + (acct.subentry_count ?? 0)) * 0.5;
                  const sendable = (parseFloat(xlmBal?.balance || "0") - reserve - 0.00001).toFixed(7);

                  if (parseFloat(sendable) <= 0) {
                    withdrawResults.push({ address: matched.stealthAddress, status: "skipped", reason: "Balance too low" });
                    continue;
                  }

                  // Build withdrawal transaction
                  const stealthAccount = new Account(matched.stealthAddress, acct.sequence);
                  const withdrawTx = new TransactionBuilder(stealthAccount, {
                    fee: "100",
                    networkPassphrase: NETWORK_PASSPHRASE,
                  })
                    .addOperation(
                      Operation.payment({
                        destination: dest,
                        asset: Asset.native(),
                        amount: sendable,
                      })
                    )
                    .setTimeout(30)
                    .build();

                  // Sign with stealth private scalar
                  const wTxHash = withdrawTx.hash();
                  const wSignature = signStellarTransaction(
                    wTxHash,
                    matched.stealthPrivateScalar,
                    matched.stealthPubKeyBytes
                  );
                  const wSignatureBase64 = Buffer.from(wSignature).toString("base64");
                  withdrawTx.addSignature(matched.stealthAddress, wSignatureBase64);

                  // Submit
                  const txXdr = withdrawTx.toEnvelope().toXDR("base64");
                  const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: `tx=${encodeURIComponent(txXdr)}`,
                  });
                  const submitData = await submitRes.json();

                  if (!submitRes.ok) {
                    withdrawResults.push({
                      address: matched.stealthAddress,
                      status: "failed",
                      reason: submitData.extras?.result_codes?.transaction || submitData.title || "Transaction failed",
                    });
                  } else {
                    totalWithdrawn += parseFloat(sendable);
                    withdrawResults.push({
                      address: matched.stealthAddress,
                      status: "success",
                      txHash: submitData.hash,
                      txLink: `https://stellar.expert/explorer/testnet/tx/${submitData.hash}`,
                      amount: sendable,
                    });
                  }

                  // Small delay between withdrawals to avoid sequence number issues
                  await new Promise((r) => setTimeout(r, 1500));
                } catch (err: any) {
                  withdrawResults.push({
                    address: matched.stealthAddress,
                    status: "failed",
                    reason: err.message || String(err),
                  });
                }
              }

              toolResult = {
                totalAddresses: allMatched.length,
                totalWithdrawn: totalWithdrawn.toFixed(7) + " XLM",
                destination: dest,
                results: withdrawResults,
                privacyAdvice: allMatched.length > 1
                  ? [
                      `Withdrew from ${allMatched.length} addresses to the same destination — this creates a linkable pattern.`,
                      "In the future, consider using different destination addresses for each withdrawal.",
                      "Space withdrawals over several hours to avoid timing correlation.",
                    ]
                  : ["Single address withdrawal — no additional privacy concerns."],
              };
              detail = `Withdrew ${totalWithdrawn.toFixed(2)} XLM from ${allMatched.length} address(es)`;
            }
            break;
          }

          case "privacy_check": {
            const pList = await toolScanPayments(stealthKeys);
            const issues: Array<{ severity: string; issue: string; recommendation: string }> = [];
            let privacyScore = 100;

            if (pList.length === 0) {
              // No activity — perfect score
            } else {
              // 1. Dust analysis
              const dustAddrs = pList.filter((p: any) => parseFloat(p.balance || "0") < 0.5);
              if (dustAddrs.length > 0) {
                issues.push({
                  severity: "low",
                  issue: `${dustAddrs.length} address(es) with dust balances (<0.5 XLM)`,
                  recommendation: "Ignore dust addresses — withdrawing them costs more than they're worth and creates unnecessary on-chain activity.",
                });
                privacyScore -= 5;
              }

              // 2. Balance amount correlation
              const balances = pList.map((p: any) => parseFloat(p.balance || "0")).filter((b: number) => b > 0.5);
              const uniqueBalances = new Set(balances.map((b: number) => b.toFixed(0)));
              if (balances.length > 2 && uniqueBalances.size < balances.length * 0.5) {
                issues.push({
                  severity: "medium",
                  issue: "Multiple stealth addresses have similar balances",
                  recommendation: "Identical amounts across stealth addresses can be correlated by observers. Request senders to vary amounts slightly or add random offsets.",
                });
                privacyScore -= 15;
              }

              // 3. Too many active addresses
              const activeAddrs = pList.filter((p: any) => parseFloat(p.balance || "0") > 0.5);
              if (activeAddrs.length > 5) {
                issues.push({
                  severity: "medium",
                  issue: `${activeAddrs.length} unspent stealth addresses accumulating`,
                  recommendation: "Large numbers of unspent addresses can be linked through timing analysis. Withdraw periodically using different destination addresses with time delays between each.",
                });
                privacyScore -= 10;
              }

              // 4. Large single balance
              const largeBalance = balances.find((b: number) => b > 1000);
              if (largeBalance) {
                issues.push({
                  severity: "high",
                  issue: `High-value stealth address detected (${largeBalance.toFixed(2)} XLM)`,
                  recommendation: "Large balances in stealth addresses are attractive targets. Consider splitting into smaller amounts across multiple withdrawals to different addresses.",
                });
                privacyScore -= 10;
              }

              // 5. Agent wallet balance check
              try {
                const agentAcctRes = await fetch(`${HORIZON_URL}/accounts/${keypair.publicKey()}`);
                if (agentAcctRes.ok) {
                  const agentAcct = await agentAcctRes.json();
                  const agentBal = parseFloat(agentAcct.balances?.find((b: any) => b.asset_type === "native")?.balance || "0");
                  const totalStealth = balances.reduce((a: number, b: number) => a + b, 0);
                  if (totalStealth > agentBal * 3) {
                    issues.push({
                      severity: "low",
                      issue: "Stealth funds significantly exceed agent wallet balance",
                      recommendation: "This is normal but be aware: your public wallet balance can be seen by anyone. The stealth funds are private.",
                    });
                  }
                }
              } catch {}

              // 6. Connected wallet warning
              const ownerWallet = (db.prepare("SELECT owner_wallet FROM agents WHERE id = ?").get(row.id) as any)?.owner_wallet;
              if (ownerWallet) {
                issues.push({
                  severity: "info",
                  issue: "Connected wallet is public on-chain",
                  recommendation: `Your connected wallet (${ownerWallet.slice(0, 8)}...) is visible. Never withdraw stealth funds directly to this address — it links your agent to your identity.`,
                });
              }

              // General best practices
              if (issues.length === 0) {
                issues.push({
                  severity: "info",
                  issue: "No privacy issues detected",
                  recommendation: "Continue using unique stealth addresses for each transaction. Space out withdrawals and use fresh destination addresses.",
                });
              }
            }

            privacyScore = Math.max(0, Math.min(100, privacyScore));

            toolResult = {
              privacyScore,
              rating: privacyScore >= 80 ? "Good" : privacyScore >= 50 ? "Fair" : "Poor",
              addressCount: pList.length,
              totalBalance: pList.reduce((acc: number, p: any) => acc + parseFloat(p.balance || "0"), 0).toFixed(4),
              issues,
              bestPractices: [
                "Use a fresh destination address for each withdrawal",
                "Space withdrawals at least 1 hour apart",
                "Never withdraw to your connected wallet address",
                "Vary payment amounts to avoid correlation",
                "Use intermediate addresses when consolidating large sums",
              ],
            };
            detail = `Privacy score: ${privacyScore}/100 (${issues.length} issue(s))`;
            break;
          }

          case "fund_wallet": {
            const fundRes = await fetch(`${FRIENDBOT_URL}/?addr=${keypair.publicKey()}`);
            if (fundRes.ok) {
              toolResult = { success: true, message: "Wallet funded with testnet XLM via Friendbot" };
              detail = "Wallet funded";
            } else {
              toolResult = { success: false, error: "Friendbot funding failed — account may already be funded" };
              detail = "Funding failed";
            }
            break;
          }

          case "check_invoices": {
            // Load all pending invoices for this agent
            const pendingInvoices = db
              .prepare(`SELECT * FROM invoices WHERE agent_id = ? AND status = 'pending'`)
              .all(row.id) as Array<{ id: string; agent_id: string; amount: string; memo: string; status: string; created_at: number }>;

            // Scan for incoming payments
            const invoiceAnnouncements = await fetchAnnouncementEvents();
            const invoiceMatched = scanAnnouncements(
              invoiceAnnouncements,
              stealthKeys.viewingKey,
              stealthKeys.spendingPubKey,
              stealthKeys.spendingScalar
            );

            // Check balances of matched stealth addresses
            const matchedPayments: Array<{ address: string; balance: string }> = [];
            for (const m of invoiceMatched) {
              try {
                const res = await fetch(`${HORIZON_URL}/accounts/${m.stealthAddress}`);
                if (res.ok) {
                  const accountData = await res.json();
                  const nativeBalance = accountData.balances?.find((b: any) => b.asset_type === "native");
                  if (nativeBalance) {
                    matchedPayments.push({ address: m.stealthAddress, balance: nativeBalance.balance });
                  }
                }
              } catch {
                // Skip
              }
            }

            // Match payments to pending invoices by amount
            const paidInvoiceIds: string[] = [];
            for (const invoice of pendingInvoices) {
              const invoiceAmount = parseFloat(invoice.amount);
              const paymentMatch = matchedPayments.find((p) => {
                // Account for the base reserve: the actual sent amount is roughly the balance minus reserve
                const balance = parseFloat(p.balance);
                // Check if balance approximately matches the invoice amount (within 1.5 XLM for reserves)
                return Math.abs(balance - invoiceAmount) < 1.5 || Math.abs(balance - invoiceAmount - 1.0) < 0.5;
              });
              if (paymentMatch) {
                db.prepare(`UPDATE invoices SET status = 'paid' WHERE id = ?`).run(invoice.id);
                paidInvoiceIds.push(invoice.id);
                createNotification(
                  row.id,
                  "invoice_paid",
                  "Invoice Paid",
                  `Invoice for ${invoice.amount} XLM ("${invoice.memo}") has been paid.`
                );
              }
            }

            // Load all invoices for summary
            const allInvoices = db
              .prepare(`SELECT * FROM invoices WHERE agent_id = ?`)
              .all(row.id) as Array<{ id: string; amount: string; memo: string; status: string; tx_hash: string | null; created_at: number }>;

            const pendingCount = allInvoices.filter((i) => i.status === "pending").length;
            const paidCount = allInvoices.filter((i) => i.status === "paid").length;

            toolResult = {
              summary: {
                total: allInvoices.length,
                pending: pendingCount,
                paid: paidCount,
                justPaid: paidInvoiceIds.length,
              },
              invoices: allInvoices.map((i) => ({
                id: i.id,
                amount: i.amount,
                memo: i.memo,
                status: i.status,
                txHash: i.tx_hash || null,
                txLink: i.tx_hash ? `https://stellar.expert/explorer/testnet/tx/${i.tx_hash}` : null,
                createdAt: i.created_at,
              })),
            };
            detail = `Invoices: ${paidCount} paid, ${pendingCount} pending (${paidInvoiceIds.length} newly matched)`;
            break;
          }

          case "pay_agent": {
            const recipientName = (args.agent_name as string).replace(/\.wraith$/, "");
            const payAsset = ((args.asset as string) || "XLM").toUpperCase();
            toolResult = await toolSendPayment(keypair, stealthKeys, row.name, recipientName, args.amount as string, payAsset);
            detail = `Paid ${args.amount} ${payAsset} to ${recipientName}.wraith`;
            createNotification(row.id, "payment_sent", "Agent Payment Sent", `Paid ${args.amount} ${payAsset} to ${recipientName}.wraith.`);
            break;
          }

          case "schedule_payment": {
            const interval = (args.interval as string).toLowerCase();
            const intervalMs: Record<string, number> = {
              hourly: 60 * 60,
              daily: 24 * 60 * 60,
              weekly: 7 * 24 * 60 * 60,
              monthly: 30 * 24 * 60 * 60,
            };
            if (!intervalMs[interval]) {
              toolResult = { error: "Invalid interval. Use: hourly, daily, weekly, or monthly" };
              status = "error";
              detail = "Invalid interval";
            } else {
              const schedId = randomUUID();
              const nextRun = Math.floor(Date.now() / 1000) + intervalMs[interval];

              // Parse end date if provided
              let endsAt: number | null = null;
              if (args.end_date) {
                const parsed = Date.parse(args.end_date as string);
                if (!isNaN(parsed)) {
                  endsAt = Math.floor(parsed / 1000);
                } else {
                  // Try relative parsing
                  const endStr = (args.end_date as string).toLowerCase();
                  const daysMatch = endStr.match(/in\s+(\d+)\s+days?/);
                  const weeksMatch = endStr.match(/in\s+(\d+)\s+weeks?/);
                  const monthsMatch = endStr.match(/in\s+(\d+)\s+months?/);
                  const now = Math.floor(Date.now() / 1000);
                  if (daysMatch) endsAt = now + parseInt(daysMatch[1]) * 86400;
                  else if (weeksMatch) endsAt = now + parseInt(weeksMatch[1]) * 7 * 86400;
                  else if (monthsMatch) endsAt = now + parseInt(monthsMatch[1]) * 30 * 86400;
                }
              }

              db.prepare(
                "INSERT INTO scheduled_payments (id, agent_id, recipient, amount, memo, cron, next_run, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(schedId, row.id, args.recipient as string, args.amount as string, (args.memo as string) || "", interval, nextRun, endsAt);

              const freqLabel = interval === "daily" ? "day" : interval === "weekly" ? "week" : interval === "monthly" ? "month" : "hour";
              toolResult = {
                scheduleId: schedId.slice(0, 8),
                recipient: args.recipient,
                amount: `${args.amount} XLM`,
                frequency: `Every ${freqLabel}`,
                nextPayment: formatHumanDate(nextRun),
                endsOn: endsAt ? formatHumanDate(endsAt) : "No end date (runs until cancelled)",
                status: "active",
              };
              detail = `Scheduled ${args.amount} XLM to ${args.recipient} (${interval})`;
              createNotification(row.id, "schedule_created", "Payment Scheduled", `${args.amount} XLM to ${args.recipient} — ${interval}.`);
            }
            break;
          }

          case "list_schedules": {
            const schedules = db.prepare(
              "SELECT * FROM scheduled_payments WHERE agent_id = ? AND status IN ('active', 'paused') ORDER BY created_at DESC"
            ).all(row.id) as Array<any>;
            toolResult = {
              count: schedules.length,
              schedules: schedules.map((s: any) => ({
                id: s.id.slice(0, 8),
                recipient: s.recipient,
                amount: `${s.amount} XLM`,
                frequency: s.cron,
                status: s.status,
                nextPayment: s.status === "active" ? formatHumanDate(s.next_run) : "—",
                lastPayment: s.last_run ? formatHumanDate(s.last_run) : "Never",
                endsOn: s.ends_at ? formatHumanDate(s.ends_at) : "No end date",
              })),
            };
            detail = `${schedules.length} scheduled payment(s)`;
            break;
          }

          case "manage_schedule": {
            const action = (args.action as string).toLowerCase();
            const searchId = args.schedule_id as string;
            // Support partial ID matching (first 8 chars)
            const schedRow = db.prepare(
              "SELECT * FROM scheduled_payments WHERE (id = ? OR id LIKE ?) AND agent_id = ?"
            ).get(searchId, `${searchId}%`, row.id) as any;
            if (!schedRow) {
              toolResult = { error: "Schedule not found" };
              status = "error";
              detail = "Schedule not found";
            } else if (action === "pause") {
              if (schedRow.status === "paused") {
                toolResult = { error: "Schedule is already paused" };
                status = "error";
              } else {
                db.prepare("UPDATE scheduled_payments SET status = 'paused' WHERE id = ?").run(schedRow.id);
                toolResult = { status: "paused", id: schedRow.id.slice(0, 8), recipient: schedRow.recipient, amount: `${schedRow.amount} XLM` };
                detail = `Paused schedule for ${schedRow.amount} XLM to ${schedRow.recipient}`;
              }
            } else if (action === "resume") {
              if (schedRow.status === "active") {
                toolResult = { error: "Schedule is already active" };
                status = "error";
              } else if (schedRow.status === "cancelled") {
                toolResult = { error: "Cannot resume a cancelled schedule. Create a new one instead." };
                status = "error";
              } else {
                const intervalMs: Record<string, number> = { hourly: 3600, daily: 86400, weekly: 604800, monthly: 2592000 };
                const nextRun = Math.floor(Date.now() / 1000) + (intervalMs[schedRow.cron] || 86400);
                db.prepare("UPDATE scheduled_payments SET status = 'active', next_run = ? WHERE id = ?").run(nextRun, schedRow.id);
                toolResult = { status: "active", id: schedRow.id.slice(0, 8), recipient: schedRow.recipient, amount: `${schedRow.amount} XLM`, nextPayment: formatHumanDate(nextRun) };
                detail = `Resumed schedule for ${schedRow.amount} XLM to ${schedRow.recipient}`;
              }
            } else if (action === "cancel") {
              db.prepare("UPDATE scheduled_payments SET status = 'cancelled' WHERE id = ?").run(schedRow.id);
              toolResult = { status: "cancelled", id: schedRow.id.slice(0, 8), recipient: schedRow.recipient, amount: `${schedRow.amount} XLM` };
              detail = `Cancelled schedule for ${schedRow.amount} XLM to ${schedRow.recipient}`;
            } else {
              toolResult = { error: "Invalid action. Use: pause, resume, or cancel" };
              status = "error";
            }
            break;
          }

          default:
            toolResult = { error: `Unknown tool: ${toolName}` };
            status = "error";
            detail = `Unknown tool: ${toolName}`;
        }
      } catch (err: any) {
        toolResult = { error: err.message || String(err) };
        status = "error";
        detail = err.message || String(err);
      }

      toolCallResults.push({ name: toolName, status, detail });
      functionResponses.push({
        functionResponse: { name: toolName, response: toolResult },
      });
    }

    // Send tool results back to the model
    result = await chatSession.sendMessage(functionResponses as any);
  }

  // Extract final text response
  const responseText =
    result.response.candidates?.[0]?.content?.parts
      ?.filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join("\n") || "I could not generate a response.";

  return { response: responseText, toolCalls: toolCallResults };
}

// ---------------------------------------------------------------------------
// Scheduled payment executor — called periodically from index.ts
// ---------------------------------------------------------------------------

export async function executeScheduledPayments(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Auto-expire schedules past their end date
  db.prepare(
    "UPDATE scheduled_payments SET status = 'ended' WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ?"
  ).run(now);

  const due = db.prepare(
    "SELECT sp.*, a.encrypted_secret, a.name as agent_name FROM scheduled_payments sp JOIN agents a ON sp.agent_id = a.id WHERE sp.status = 'active' AND sp.next_run <= ?"
  ).all(now) as Array<any>;

  if (due.length === 0) return;

  for (const sched of due) {
    try {
      const secret = decrypt(sched.encrypted_secret);
      const keypair = Keypair.fromSecret(secret);
      const stealthKeys = deriveAgentStealthKeys(secret);

      await toolSendPayment(keypair, stealthKeys, sched.agent_name, sched.recipient, sched.amount, sched.asset || "XLM");

      // Calculate next run
      const intervalMs: Record<string, number> = {
        hourly: 60 * 60,
        daily: 24 * 60 * 60,
        weekly: 7 * 24 * 60 * 60,
        monthly: 30 * 24 * 60 * 60,
      };
      const nextRun = now + (intervalMs[sched.cron] || intervalMs.daily);

      db.prepare(
        "UPDATE scheduled_payments SET last_run = ?, next_run = ? WHERE id = ?"
      ).run(now, nextRun, sched.id);

      createNotification(
        sched.agent_id,
        "scheduled_payment",
        "Scheduled Payment Sent",
        `Auto-paid ${sched.amount} ${sched.asset || "XLM"} to ${sched.recipient}.`
      );

      console.log(`[scheduler] Executed: ${sched.amount} ${sched.asset || "XLM"} to ${sched.recipient} for ${sched.agent_name}.wraith`);
    } catch (err: any) {
      console.error(`[scheduler] Failed for schedule ${sched.id}:`, err.message);
      createNotification(
        sched.agent_id,
        "schedule_error",
        "Scheduled Payment Failed",
        `Failed to send ${sched.amount} ${sched.asset || "XLM"} to ${sched.recipient}: ${err.message}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Autonomous agent status — called on connect
// ---------------------------------------------------------------------------

export async function getAgentStatus(agentId: string): Promise<Record<string, unknown>> {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as AgentRow | undefined;
  if (!row) return { error: "Agent not found" };

  const secret = decrypt(row.encrypted_secret);
  const keypair = Keypair.fromSecret(secret);
  const stealthKeys = deriveAgentStealthKeys(secret);

  // 1. Get balance
  let balance = "0";
  const assets: Array<{ asset: string; balance: string }> = [];
  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${keypair.publicKey()}`);
    if (res.ok) {
      const data = await res.json();
      for (const b of data.balances || []) {
        if (b.asset_type === "native") {
          balance = b.balance;
          assets.push({ asset: "XLM", balance: b.balance });
        } else if (b.asset_code) {
          assets.push({ asset: b.asset_code, balance: b.balance });
        }
      }
    }
  } catch {}

  // 2. Scan for new stealth payments
  let newPayments: Array<{ address: string; balance: string }> = [];
  try {
    const announcements = await fetchAnnouncementEvents();
    const matched = scanAnnouncements(
      announcements,
      stealthKeys.viewingKey,
      stealthKeys.spendingPubKey,
      stealthKeys.spendingScalar
    );

    const seenAddresses = new Set(
      (db.prepare("SELECT address FROM seen_stealth_addresses WHERE agent_id = ?").all(agentId) as any[])
        .map((r: any) => r.address)
    );

    for (const m of matched) {
      if (!seenAddresses.has(m.stealthAddress)) {
        let bal = "0";
        try {
          const acctRes = await fetch(`${HORIZON_URL}/accounts/${m.stealthAddress}`);
          if (acctRes.ok) {
            const acctData = await acctRes.json();
            const native = acctData.balances?.find((b: any) => b.asset_type === "native");
            if (native) bal = native.balance;
          }
        } catch {}

        if (parseFloat(bal) > 0) {
          newPayments.push({ address: m.stealthAddress, balance: bal });
          // Mark as seen
          db.prepare(
            "INSERT OR IGNORE INTO seen_stealth_addresses (address, agent_id, balance) VALUES (?, ?, ?)"
          ).run(m.stealthAddress, agentId, bal);
          // Create notification
          createNotification(
            agentId,
            "payment_received",
            "Payment Received",
            `Received ${bal} XLM at stealth address ${m.stealthAddress.slice(0, 8)}...${m.stealthAddress.slice(-4)}.`
          );
        }
      }
    }
  } catch {}

  // 3. Check pending invoices
  const pendingInvoices = db.prepare(
    "SELECT COUNT(*) as count FROM invoices WHERE agent_id = ? AND status = 'pending'"
  ).get(agentId) as any;

  const paidInvoices = db.prepare(
    "SELECT COUNT(*) as count FROM invoices WHERE agent_id = ? AND status = 'paid'"
  ).get(agentId) as any;

  // 4. Check upcoming scheduled payments
  const activeSchedules = db.prepare(
    "SELECT COUNT(*) as count FROM scheduled_payments WHERE agent_id = ? AND status = 'active'"
  ).get(agentId) as any;

  // 5. Unread notifications
  const unread = db.prepare(
    "SELECT COUNT(*) as count FROM notifications WHERE agent_id = ? AND read = 0"
  ).get(agentId) as any;

  // 6. Update last active
  db.prepare(
    "INSERT OR REPLACE INTO agent_sessions (agent_id, last_active) VALUES (?, ?)"
  ).run(agentId, Math.floor(Date.now() / 1000));

  // Build status message
  const parts: string[] = [];
  parts.push(`**${row.name}.wraith** is online.`);
  parts.push(`**Balance:** ${balance} XLM`);

  if (newPayments.length > 0) {
    const totalNew = newPayments.reduce((acc, p) => acc + parseFloat(p.balance), 0);
    parts.push(`**New payments:** ${newPayments.length} stealth payment(s) detected (${totalNew.toFixed(2)} XLM total)`);
  }

  if (pendingInvoices.count > 0) {
    parts.push(`**Pending invoices:** ${pendingInvoices.count}`);
  }
  if (paidInvoices.count > 0) {
    parts.push(`**Paid invoices:** ${paidInvoices.count}`);
  }
  if (activeSchedules.count > 0) {
    parts.push(`**Active schedules:** ${activeSchedules.count} recurring payment(s)`);
  }
  if (unread.count > 0) {
    parts.push(`**Unread notifications:** ${unread.count}`);
  }

  // Privacy tip
  const seenCount = (db.prepare("SELECT COUNT(*) as count FROM seen_stealth_addresses WHERE agent_id = ?").get(agentId) as any).count;
  if (seenCount > 5) {
    parts.push(`\n*Privacy tip: You have ${seenCount} stealth addresses with funds. Consider withdrawing periodically to maintain privacy.*`);
  }

  return {
    statusMessage: parts.join("\n"),
    balance,
    assets,
    newPayments: newPayments.length,
    pendingInvoices: pendingInvoices.count,
    activeSchedules: activeSchedules.count,
    unreadNotifications: unread.count,
  };
}

// ---------------------------------------------------------------------------
// Background scanner — runs periodically for ALL agents
// ---------------------------------------------------------------------------

export async function backgroundScanAllAgents(): Promise<void> {
  const agents = db.prepare("SELECT id, name, encrypted_secret FROM agents").all() as AgentRow[];

  if (agents.length === 0) return;

  // Fetch announcements once for all agents
  let announcements: Announcement[];
  try {
    announcements = await fetchAnnouncementEvents();
  } catch {
    return; // Can't scan without announcements
  }

  for (const agent of agents) {
    try {
      const secret = decrypt(agent.encrypted_secret);
      const stealthKeys = deriveAgentStealthKeys(secret);

      const matched = scanAnnouncements(
        announcements,
        stealthKeys.viewingKey,
        stealthKeys.spendingPubKey,
        stealthKeys.spendingScalar
      );

      const seenAddresses = new Set(
        (db.prepare("SELECT address FROM seen_stealth_addresses WHERE agent_id = ?").all(agent.id) as any[])
          .map((r: any) => r.address)
      );

      for (const m of matched) {
        if (!seenAddresses.has(m.stealthAddress)) {
          let bal = "0";
          try {
            const acctRes = await fetch(`${HORIZON_URL}/accounts/${m.stealthAddress}`);
            if (acctRes.ok) {
              const acctData = await acctRes.json();
              const native = acctData.balances?.find((b: any) => b.asset_type === "native");
              if (native) bal = native.balance;
            }
          } catch {}

          if (parseFloat(bal) > 0) {
            db.prepare(
              "INSERT OR IGNORE INTO seen_stealth_addresses (address, agent_id, balance) VALUES (?, ?, ?)"
            ).run(m.stealthAddress, agent.id, bal);

            createNotification(
              agent.id,
              "payment_received",
              "Payment Received",
              `Received ${bal} XLM at stealth address ${m.stealthAddress.slice(0, 8)}...${m.stealthAddress.slice(-4)}.`
            );

            console.log(`[scanner] New payment for ${agent.name}.wraith: ${bal} XLM at ${m.stealthAddress.slice(0, 12)}...`);
          }
        }
      }
    } catch (err: any) {
      console.error(`[scanner] Error scanning for ${agent.name}:`, err.message);
    }
  }
}

