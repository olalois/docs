import Database, { type Database as DatabaseType } from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "wraith.db");
const db: DatabaseType = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    owner_wallet TEXT,
    public_key TEXT NOT NULL,
    encrypted_secret TEXT NOT NULL,
    meta_address TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )
`);

// Add owner_wallet column if it doesn't exist (migration for existing DBs)
try {
  db.exec(`ALTER TABLE agents ADD COLUMN owner_wallet TEXT`);
} catch {
  // Column already exists
}

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    amount TEXT NOT NULL,
    memo TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    tx_hash TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);

// Add tx_hash column if it doesn't exist (migration for existing DBs)
try {
  db.exec(`ALTER TABLE invoices ADD COLUMN tx_hash TEXT`);
} catch {
  // Column already exists
}

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_payments (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    recipient TEXT NOT NULL,
    amount TEXT NOT NULL,
    asset TEXT NOT NULL DEFAULT 'XLM',
    memo TEXT,
    cron TEXT NOT NULL,
    next_run INTEGER NOT NULL,
    last_run INTEGER,
    ends_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);

// Add ends_at column if it doesn't exist (migration for existing DBs)
try {
  db.exec(`ALTER TABLE scheduled_payments ADD COLUMN ends_at INTEGER`);
} catch {
  // Column already exists
}

db.exec(`
  CREATE TABLE IF NOT EXISTS seen_stealth_addresses (
    address TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    balance TEXT NOT NULL DEFAULT '0',
    first_seen INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_sessions (
    agent_id TEXT PRIMARY KEY,
    last_active INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);

export default db;
