import "dotenv/config";
import crypto from "crypto";
import express from "express";
import cors from "cors";
import db from "./db.js";
import { decrypt } from "./crypto.js";
import {
  stealthPaymentMiddleware,
  getSessionStore,
  getPendingAddresses,
  getServerMetaAddress,
  middlewareState,
  deriveServerStealthKeys,
} from "./middleware.js";
import {
  createAgent,
  getAgent,
  getAgentByName,
  getAgentByWallet,
  chat,
  executeScheduledPayments,
  getAgentStatus,
  backgroundScanAllAgents,
} from "./agent.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3001", 10);
const STELLAR_NETWORK = (process.env.STELLAR_NETWORK || "testnet") as
  | "testnet"
  | "pubnet";
const STELLAR_SECRET_KEY = process.env.STELLAR_SECRET_KEY;
const FACILITATOR_URL =
  process.env.FACILITATOR_URL || "https://x402-facilitator.stellar.org";

if (!STELLAR_SECRET_KEY) {
  console.error(
    "[wraith] STELLAR_SECRET_KEY is required. Set it in .env or environment."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Derive stealth keys on startup
// ---------------------------------------------------------------------------

const stealthKeys = deriveServerStealthKeys(STELLAR_SECRET_KEY);
const metaAddress = getServerMetaAddress(STELLAR_SECRET_KEY);

console.log("[wraith] Server stealth meta-address:", metaAddress);
console.log("[wraith] Network:", STELLAR_NETWORK);

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Health endpoint
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "wraith-x402-server",
    network: STELLAR_NETWORK,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Server meta-address endpoint (public)
// ---------------------------------------------------------------------------

app.get("/api/meta-address", (_req, res) => {
  res.json({
    metaAddress,
    network: STELLAR_NETWORK,
  });
});

// ---------------------------------------------------------------------------
// Protected demo endpoints
// ---------------------------------------------------------------------------

const weatherMiddleware = stealthPaymentMiddleware({
  price: "0.01",
  asset: "USDC",
  network: STELLAR_NETWORK,
  secretKey: STELLAR_SECRET_KEY,
  facilitatorUrl: FACILITATOR_URL,
});

const aiMiddleware = stealthPaymentMiddleware({
  price: "0.05",
  asset: "USDC",
  network: STELLAR_NETWORK,
  secretKey: STELLAR_SECRET_KEY,
  facilitatorUrl: FACILITATOR_URL,
});

app.get("/api/weather", weatherMiddleware, (_req, res) => {
  res.json({
    location: "San Francisco, CA",
    temperature: 68,
    unit: "F",
    condition: "Partly Cloudy",
    humidity: 72,
    wind: { speed: 12, direction: "W" },
    forecast: [
      { day: "Today", high: 70, low: 55, condition: "Partly Cloudy" },
      { day: "Tomorrow", high: 73, low: 57, condition: "Sunny" },
      { day: "Wednesday", high: 65, low: 52, condition: "Fog" },
    ],
  });
});

app.get("/api/ai", aiMiddleware, (_req, res) => {
  res.json({
    model: "wraith-demo-v1",
    response:
      "This is a mock AI response. In a real deployment, this endpoint would proxy to an LLM API. The payment was verified via a stealth address, so your usage cannot be linked to your identity.",
    usage: {
      promptTokens: 12,
      completionTokens: 42,
      totalTokens: 54,
    },
  });
});

// ---------------------------------------------------------------------------
// Session management endpoint
// ---------------------------------------------------------------------------

app.post("/x402/session", async (req, res) => {
  const { stealthAddress, txHash } = req.body;

  if (!stealthAddress || typeof stealthAddress !== "string") {
    res.status(400).json({ error: "Missing or invalid stealthAddress" });
    return;
  }

  // Look up the pending stealth address
  const pending = getPendingAddresses().get(stealthAddress);
  if (!pending) {
    res.status(404).json({
      error: "Unknown stealth address. It may have expired.",
    });
    return;
  }

  // Verify the payment arrived at the stealth address
  const scanner = middlewareState.scanner;
  if (!scanner) {
    res.status(500).json({ error: "Payment scanner not initialized" });
    return;
  }

  const price = parseFloat(pending.price);
  const paymentFound = await scanner.checkPayment(stealthAddress, price);

  if (!paymentFound) {
    res.status(402).json({
      error: "Payment not yet detected at stealth address",
      stealthAddress,
      expectedAmount: pending.price,
      hint: "Payment may still be processing. Try again in a few seconds.",
    });
    return;
  }

  // Payment verified - create a session
  const sessions = getSessionStore();
  const sessionToken = sessions.create(
    stealthAddress,
    pending.ephemeralPubKey,
    pending.viewTag
  );

  // Remove from pending
  getPendingAddresses().delete(stealthAddress);

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  console.log(
    `[wraith] Session created for stealth address ${stealthAddress.slice(0, 8)}...${stealthAddress.slice(-4)}`
  );

  res.json({
    sessionToken,
    expiresAt,
    stealthAddress,
    txHash: txHash || null,
  });
});

// ---------------------------------------------------------------------------
// Agent endpoints
// ---------------------------------------------------------------------------

app.post("/agent/create", async (req, res) => {
  try {
    const { name, ownerWallet } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Missing or invalid agent name" });
      return;
    }
    const agent = await createAgent(name.trim(), ownerWallet);
    res.json(agent);
  } catch (err: any) {
    console.error("[agent] Create error:", err);
    res.status(500).json({ error: err.message || "Failed to create agent" });
  }
});

app.get("/agent/:id", (req, res) => {
  try {
    const agent = getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json(agent);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get agent" });
  }
});

app.post("/agent/:id/chat", async (req, res) => {
  try {
    const { message, history, conversationId } = req.body;
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Missing or invalid message" });
      return;
    }
    const agent = getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    // Auto-create conversation if needed
    let convId = conversationId;
    if (!convId) {
      convId = crypto.randomUUID();
      const title = message.length > 50 ? message.slice(0, 50) + "..." : message;
      db.prepare(
        "INSERT INTO conversations (id, agent_id, title) VALUES (?, ?, ?)"
      ).run(convId, req.params.id, title);
    }

    const clientOrigin = req.body.clientOrigin || req.headers.origin || "http://localhost:5175";
    const result = await chat(req.params.id, message, history || [], clientOrigin);

    // Save messages
    db.prepare("INSERT INTO messages (conversation_id, role, text) VALUES (?, ?, ?)").run(convId, "user", message);
    if (result.response) {
      db.prepare("INSERT INTO messages (conversation_id, role, text) VALUES (?, ?, ?)").run(convId, "agent", result.response);
    }
    for (const tc of result.toolCalls || []) {
      db.prepare("INSERT INTO messages (conversation_id, role, text) VALUES (?, ?, ?)").run(convId, "tool", `${tc.name}\n${tc.detail || tc.status}`);
    }
    db.prepare("UPDATE conversations SET updated_at = strftime('%s', 'now') WHERE id = ?").run(convId);

    res.json({ ...result, conversationId: convId });
  } catch (err: any) {
    console.error("[agent] Chat error:", err);
    res.status(500).json({ error: err.message || "Chat failed" });
  }
});

app.get("/agents", (_req, res) => {
  try {
    const rows = db.prepare(
      "SELECT id, name, public_key, meta_address, created_at FROM agents ORDER BY created_at DESC"
    ).all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/agent/info/:name", (req, res) => {
  try {
    const agent = getAgentByName(req.params.name);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json(agent);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get agent" });
  }
});

app.get("/agent/wallet/:address", (req, res) => {
  try {
    const agent = getAgentByWallet(req.params.address);
    if (!agent) {
      res.status(404).json({ error: "No agent found for this wallet" });
      return;
    }
    res.json(agent);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get agent" });
  }
});

app.get("/agent/:id/status", async (req, res) => {
  try {
    const status = await getAgentStatus(req.params.id);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/agent/:id/export", (req, res) => {
  try {
    const row = db.prepare("SELECT encrypted_secret FROM agents WHERE id = ?").get(req.params.id) as any;
    if (!row) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const secret = decrypt(row.encrypted_secret);
    res.json({ secret });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/invoice/:id", (req, res) => {
  try {
    const row = db.prepare(
      "SELECT i.*, a.name as agent_name, a.meta_address FROM invoices i JOIN agents a ON i.agent_id = a.id WHERE i.id = ?"
    ).get(req.params.id) as any;
    if (!row) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    res.json({
      id: row.id,
      agentName: row.agent_name,
      amount: row.amount,
      memo: row.memo,
      status: row.status,
      metaAddress: row.meta_address,
      txHash: row.tx_hash || null,
      createdAt: row.created_at,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/invoice/:id/paid", (req, res) => {
  try {
    const { txHash } = req.body || {};
    if (txHash) {
      db.prepare("UPDATE invoices SET status = 'paid', tx_hash = ? WHERE id = ?").run(txHash, req.params.id);
    } else {
      db.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").run(req.params.id);
    }

    // Create notification for the agent
    const invoice = db.prepare(
      "SELECT i.amount, i.memo, i.agent_id FROM invoices i WHERE i.id = ?"
    ).get(req.params.id) as any;
    if (invoice) {
      db.prepare(
        "INSERT INTO notifications (agent_id, type, title, body) VALUES (?, ?, ?, ?)"
      ).run(
        invoice.agent_id,
        "invoice_paid",
        "Invoice Paid",
        `Invoice for ${invoice.amount} XLM ("${invoice.memo}") has been paid.`
      );
    }

    res.json({ updated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Conversation endpoints
// ---------------------------------------------------------------------------

app.get("/agent/:id/conversations", (req, res) => {
  try {
    const rows = db.prepare(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE agent_id = ? ORDER BY updated_at DESC"
    ).all(req.params.id);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/agent/:id/conversations", (req, res) => {
  try {
    const id = crypto.randomUUID();
    const title = req.body.title || "New Chat";
    db.prepare(
      "INSERT INTO conversations (id, agent_id, title) VALUES (?, ?, ?)"
    ).run(id, req.params.id, title);
    res.json({ id, title, created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/agent/:id/conversations/:convId/messages", (req, res) => {
  try {
    const rows = db.prepare(
      "SELECT role, text, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
    ).all(req.params.convId);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/agent/:id/conversations/:convId", (req, res) => {
  try {
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(req.params.convId);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(req.params.convId);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Notification endpoints
// ---------------------------------------------------------------------------

app.get("/agent/:id/notifications", (req, res) => {
  try {
    const rows = db.prepare(
      "SELECT id, type, title, body, read, created_at FROM notifications WHERE agent_id = ? ORDER BY created_at DESC LIMIT 50"
    ).all(req.params.id);
    const unread = db.prepare(
      "SELECT COUNT(*) as count FROM notifications WHERE agent_id = ? AND read = 0"
    ).get(req.params.id) as any;
    res.json({ notifications: rows, unreadCount: unread?.count || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/agent/:id/notifications/read", (req, res) => {
  try {
    const { ids } = req.body || {};
    if (ids && Array.isArray(ids)) {
      const stmt = db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND agent_id = ?");
      for (const id of ids) {
        stmt.run(id, req.params.id);
      }
    } else {
      db.prepare("UPDATE notifications SET read = 1 WHERE agent_id = ?").run(req.params.id);
    }
    res.json({ updated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/agent/:id/notifications", (req, res) => {
  try {
    db.prepare("DELETE FROM notifications WHERE agent_id = ?").run(req.params.id);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  // Run scheduled payment executor every 60 seconds
  setInterval(async () => {
    try {
      await executeScheduledPayments();
    } catch (err: any) {
      console.error("[scheduler] Error:", err.message);
    }
  }, 60_000);

  // Background scanner — scan for new payments every 5 minutes
  setInterval(async () => {
    try {
      await backgroundScanAllAgents();
    } catch (err: any) {
      console.error("[scanner] Error:", err.message);
    }
  }, 5 * 60_000);

  // Run initial scan 10 seconds after startup
  setTimeout(async () => {
    try {
      await backgroundScanAllAgents();
      console.log("[scanner] Initial background scan complete");
    } catch (err: any) {
      console.error("[scanner] Initial scan error:", err.message);
    }
  }, 10_000);

  console.log(`[wraith] x402 stealth payment server listening on port ${PORT}`);
  console.log(`[wraith] Endpoints:`);
  console.log(`  GET  /health           - Server health check`);
  console.log(`  GET  /api/meta-address  - Server stealth meta-address`);
  console.log(`  GET  /api/weather      - Weather data (0.01 USDC)`);
  console.log(`  GET  /api/ai           - AI response (0.05 USDC)`);
  console.log(`  POST /x402/session     - Claim session after payment`);
  console.log(`  POST /agent/create     - Create a new AI agent`);
  console.log(`  GET  /agent/:id        - Get agent by ID`);
  console.log(`  POST /agent/:id/chat   - Chat with an agent`);
  console.log(`  GET  /agent/info/:name - Get agent by .wraith name`);
});
