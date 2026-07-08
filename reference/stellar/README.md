# WRAITH — Private AI Agents on Stellar

**Deploy AI agents that handle payments privately, securely, and anonymously on Stellar.**

Wraith is a platform for deploying private AI agents on Stellar. Each agent gets its own wallet, `.wraith` name, and stealth identity — capable of sending, receiving, invoicing, scheduling, and routing funds through stealth addresses that break every on-chain link between identity and activity. Users interact through natural language; the agent handles the cryptography, key management, and privacy optimization.

The vision: a service where anyone can spin up an agent that manages their entire payment portfolio privately — recurring bills, invoices, fund routing, API payments — all anonymous, all secure, all through one conversational interface.

## The Problem

When agents pay for APIs via x402 on Stellar:
- Every API call is linked to your wallet on-chain
- Providers and chain observers can build a complete usage profile
- Multiple payments to the same provider are trivially linkable
- Payment history IS your usage history

## The Solution: Stealth Addresses + AI Agents

Wraith combines stealth address cryptography with AI agents:

1. Each user gets a private AI agent with its own wallet and `.wraith` name
2. Every payment goes to a fresh one-time stealth address
3. Only the recipient can detect and spend from stealth addresses
4. The agent handles all complexity — users just chat

## Architecture

```
┌─────────────────┐         ┌───────────────────────────────────┐
│  Client (React)  │  HTTP   │  TEE (NestJS + Gemini + Postgres)  │
│                  │ ◄─────► │                                     │
│  Chat UI only    │         │  Phala dstack CVM (Intel TDX)       │
│  No keys, no     │         │  DstackClient key derivation        │
│  crypto          │         │  Keys never stored, derived on      │
│                  │         │  demand from TEE                    │
│                  │         │  TDX attestation for verification   │
└─────────────────┘         └───────────────────────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  Stellar Testnet  │
                              │  Soroban RPC      │
                              │  Horizon API      │
                              └─────────────────┘
```

```
wraith/
├── packages/
│   ├── sdk/           # Stealth address cryptography (ed25519/X25519)
│   ├── tee/           # Production backend — NestJS + Phala dstack TEE + PostgreSQL
│   ├── server/        # Dev backend — Express + SQLite (local development)
│   ├── client/        # Agent chat UI — React + Vite + Tailwind
│   └── web/           # Manual stealth payment UI (Freighter wallet)
└── contracts/         # Soroban smart contracts (announcer, registry, sender, names)
```

### Client (`packages/client/`)
- React chat UI with conversation history, slash commands, notifications
- Agent creation flow with Freighter wallet signature verification
- Agent directory, shareable profile cards, invoice payment pages
- Guided tour for first-time users
- Deployed on Vercel: [wraith-stellar.vercel.app](https://wraith-stellar.vercel.app)

### TEE (`packages/tee/`) — Production Backend
- **NestJS** application running inside a Phala dstack Confidential VM (Intel TDX)
- **No private keys in database** — derived on demand from TEE via `DstackClient.getKey()`
- **Wallet signature verification (SEP-53)** — users must sign a message with Freighter to prove wallet ownership before creating an agent
- **Key export available** — users own their agents, keys are derived from TEE on request
- **PostgreSQL** with TypeORM — all data encrypted at rest by TEE infrastructure
- **TDX attestation endpoints** — prove agent keys were generated inside genuine TEE hardware
- **Gemini AI** with 17 function-calling tools for stealth payments, invoicing, scheduling, privacy
- **Agent memory** — persistent memory across conversations, auto-extracts preferences and facts, summarizes when context grows
- **Privacy soul** — the agent has a privacy-first personality, proactively warns about risks, refuses unsafe actions, suggests alternatives
- **Pending actions queue** — the agent remembers what happened while you were away and delivers it contextually on reconnect
- **Privacy auto-pilot** — autonomously monitors stealth address accumulation and withdraws with safe timing when thresholds are exceeded
- **Autonomous behaviors** — background scanner (every 5 min), scheduled executor (every 60s), auto-react to payments, proactive privacy alerts
- **CORS restricted** — only accepts requests from the deployed client and localhost
- **Swagger docs** at `/docs`
- Docker Compose deployment: NestJS app + Postgres 16, dstack socket mounted

### Server (`packages/server/`) — Dev Backend
- Express server with same agent capabilities (for local development)
- SQLite + AES-256-GCM encryption for key storage
- No TEE — keys encrypted at rest with server-side key

### Security Model

| | Server (Dev) | TEE (Production) |
|--|--|--|
| **Key storage** | Encrypted in SQLite (AES-256-GCM) | Derived on demand from TEE, never stored |
| **Database** | SQLite | PostgreSQL (encrypted at rest by TEE) |
| **Wallet verification** | None | Ed25519 signature verification required |
| **Key export** | Available | Available (user owns their agent) |
| **Attestation** | None | TDX quotes bound to Stellar public keys |
| **Deployment** | Any host | Phala Cloud CVM (Intel TDX) |
| **Runtime** | Node.js | NestJS inside dstack CVM |

## Agent Creation Flow

1. User connects Freighter wallet
2. **Signs a verification message** to prove wallet ownership
3. TEE verifies the ed25519 signature
4. TEE derives a Stellar keypair deterministically via `DstackClient.getKey()` — key never stored
5. Registers `.wraith` name on-chain via WraithNames contract
6. Agent is ready — fund it and start chatting

Each agent is isolated: own wallet, own stealth meta-address, own `.wraith` name.

## What the Agent Can Do

### Agent Tools

| Tool | Description |
|------|-------------|
| `send_payment` | Send XLM/USDC via stealth address (multi-asset) |
| `pay_agent` | Pay another agent by `.wraith` name |
| `scan_payments` | Scan for incoming stealth payments |
| `get_balance` | Check wallet balance (all assets) |
| `create_invoice` | Generate shareable payment link with QR |
| `check_invoices` | Check invoice statuses, match payments |
| `withdraw` | Withdraw from a stealth address |
| `withdraw_all` | Withdraw from all stealth addresses |
| `schedule_payment` | Set up recurring payments (hourly/daily/weekly/monthly) with end dates |
| `list_schedules` | View scheduled payments |
| `manage_schedule` | Pause, resume, or cancel schedules |
| `register_name` | Register a `.wraith` name on-chain |
| `resolve_name` | Look up a `.wraith` name |
| `get_agent_info` | Full agent identity, balance, and TEE status |
| `fund_wallet` | Fund via Friendbot (testnet) |
| `privacy_check` | Privacy score, pattern analysis, recommendations |

### Key Features

- **Private Payments**: Each payment to a fresh stealth address. Send to `.wraith` names or meta-addresses.
- **Private Invoicing**: Create invoices with payment links. Agent tracks status and notifies on payment.
- **Scheduled Payments**: Recurring payments with pause/resume/cancel and optional end dates.
- **Agent-to-Agent**: Named agents transact privately — `analyst.wraith` pays `oracle.wraith` with no on-chain link.
- **Privacy Advisor**: Scores your privacy (0-100), detects timing patterns, balance correlations, and suggests improvements.
- **Multi-Asset**: Supports XLM and USDC (extensible to any Stellar asset).
- **Notifications**: Real-time alerts for payments, invoices, withdrawals, scheduled executions.
- **Agent Discovery**: Browse registered agents at `/agents`, view profile cards at `/agent/:name`.

### Agent Soul — Privacy Guardian

Every Wraith agent has a **privacy-first personality**. It's not a generic chatbot — it's a guardian that:

- **Proactively warns** about privacy risks without being asked
- **Refuses unsafe actions** — if you try to withdraw all stealth addresses to the same destination, the agent warns you first and suggests alternatives
- **Detects patterns** — flags same-amount payments, timing correlations, address reuse
- **Remembers context** — learns your preferences across conversations ("user prefers address X for withdrawals")
- **Explains risks** in plain language, not crypto jargon

### Agent Memory

Agents have persistent memory across conversations:

- **Auto-extraction**: After each chat, the agent extracts important facts and preferences from the conversation
- **Memory types**: `preference` (user habits), `fact` (learned context), `context_summary` (compressed old memories)
- **Context limit**: When memories exceed 20 entries, older ones are summarized into condensed summaries
- **Injected into every chat**: The agent's memories are loaded into its context, so it remembers who you are and what you prefer
- **Explicit save**: The agent can also call `save_memory` to remember something important on its own

### Autonomous Agent Behaviors

Wraith agents are truly agentic — they act autonomously, not just when prompted:

- **Auto-scan on connect**: When you open the chat, your agent immediately scans for new stealth payments and reports what happened while you were away.
- **Background payment monitor**: The TEE scans for all agents' incoming payments every 5 minutes. New payments trigger notifications automatically — no user action needed.
- **Auto-react to payments**: When a new payment is detected, the agent doesn't just notify — it creates a contextual pending action that it delivers conversationally on your next visit.
- **Pending actions queue**: Things that happen while you're away (payments, schedule results, privacy alerts) are queued and delivered by the agent as part of its greeting — not just status numbers, but agent reasoning.
- **Privacy auto-pilot**: When stealth addresses accumulate beyond a threshold, the agent autonomously starts withdrawing with randomized timing. If auto-withdraw is enabled with a preferred address, it handles everything without user input.
- **Proactive privacy alerts**: The agent monitors your privacy score and warns when it drops, suggesting concrete fixes.
- **Scheduled payment executor**: Runs every 60 seconds, automatically executing due recurring payments with success/failure reporting.
- **Smart status briefing**: On login, the agent delivers a full status including balance, pending actions, and everything it did while you were away.

## TEE Key Derivation

Agent private keys are **never stored** — they are derived deterministically inside the TEE on every request:

```typescript
import { DstackClient } from '@phala/dstack-sdk';

const dstack = new DstackClient();

// Derive a deterministic key for an agent
const result = await dstack.getKey(`wraith/agent/${agentId}/stellar`, 'stellar');

// getKey() returns secp256k1 — hash to get ed25519 seed for Stellar
const ed25519Seed = createHash('sha256').update(result.key).digest();
const keypair = Keypair.fromRawEd25519Seed(ed25519Seed);
```

**Properties:**
- Same `agentId` always produces the same Stellar keypair
- Key derivation happens in TEE memory — private key never touches disk
- Users can export their key on request (they own their agent)
- TDX attestation proves the key was generated inside genuine TEE hardware

### TEE Attestation

```bash
# Get TEE environment measurements
GET /tee/info
# Returns: appId, instanceId, composeHash, osImageHash, mrtd, rtmr0-3

# Get attestation quote bound to an agent's public key
GET /tee/attest/:agentId
# Returns: publicKey, quote (TDX), appId, composeHash
```

The attestation quote cryptographically proves that a given Stellar public key was derived inside a genuine Intel TDX enclave running the Wraith application code.

## How Stealth Addresses Work

### Key Derivation
The agent's Stellar keypair (derived from TEE) is used to derive two independent keypairs:
- **Spending key**: Controls funds at stealth addresses
- **Viewing key**: Detects incoming payments (without spending capability)

### Generating a Stealth Address (Sender)
1. Generate ephemeral ed25519 keypair `(r, R)`
2. Compute shared secret via X25519 ECDH: `S = DH(r, V_recipient)`
3. Derive hash scalar: `s_h = SHA-256("wraith:scalar:" || S) mod L`
4. Stealth public key via **point addition**: `P_stealth = K_spend + s_h * G`
5. Encode as Stellar address → stealth address `G...`

### Scanning (Viewing key only)
For each on-chain announcement `(R, tag, stealth_addr)`:
1. Compute shared secret: `S = DH(v, R)`
2. Quick filter via view tag (~255/256 eliminated)
3. Expected stealth pubkey: `K_spend + s_h * G`
4. If match: payment detected. Viewing key **cannot** derive spending key.

### Spending (Requires spending key)
```
p_stealth = (m + s_h) mod L
```
Custom ed25519 signing with `@noble/curves` — produces standard signatures that Stellar verifies normally.

### Key Separation

| Capability | Viewing key | Spending key |
|------------|:-----------:|:------------:|
| Detect incoming payments | Yes | Yes |
| Derive stealth private scalar | No | Yes |
| Sign transactions | No | Yes |

## Soroban Contracts

| Contract | Address (Testnet) | Purpose |
|----------|-------------------|---------|
| **StealthAnnouncer** | `CCJLJ2QR...WVWL` | Emits events for stealth payments |
| **StealthRegistry** | `CC2LAUC...YJ5` | Maps addresses to meta-addresses |
| **StealthSender** | `CCLV7RB...T2G` | Atomic transfer + announce |
| **WraithNames** | `CDEMB3M...FBV` | `.wraith` name registration and resolution |

## Tech Stack

- **AI**: Google Gemini 2.5 Flash with function calling
- **TEE**: Phala dstack CVM (Intel TDX), `@phala/dstack-sdk` v0.5.7 (`DstackClient`)
- **Backend**: NestJS 10 (production), Express.js (dev)
- **Database**: PostgreSQL 16 + TypeORM (production), SQLite (dev)
- **Crypto**: `@noble/curves` (ed25519/X25519), `@noble/hashes` (SHA-256/512)
- **Blockchain**: `@stellar/stellar-sdk`, Soroban smart contracts (Rust)
- **Frontend**: React 19, Vite, Tailwind CSS, React Markdown
- **Wallet**: Freighter browser extension
- **Deployment**: Phala Cloud (TEE), Vercel (client)

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm 10+
- [Freighter wallet](https://freighter.app/) browser extension
- Docker (for TEE deployment)

### Local Development (Express server)

```bash
pnpm install
pnpm build:sdk

cp packages/server/.env.example packages/server/.env
# Edit .env: set STELLAR_SECRET_KEY and GEMINI_API_KEY

cd packages/server && pnpm dev    # Server on :3001
cd packages/client && pnpm dev    # Client on :5175
```

### TEE Deployment (Phala Cloud)

```bash
# Build and push Docker image
docker build -f packages/tee/Dockerfile -t truthixify/wraith-tee:latest --platform linux/amd64 .
docker push truthixify/wraith-tee:latest

# Deploy to Phala Cloud
# 1. Create a CVM with docker-compose.yml from packages/tee/
# 2. Set env vars: GEMINI_API_KEY, POSTGRES_PASSWORD
# 3. The dstack socket is mounted automatically
```

### Build Soroban Contracts

```bash
cd contracts
cargo build --release --target wasm32-unknown-unknown

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stealth_announcer.wasm \
  --network testnet \
  --source YOUR_SECRET_KEY
```

## Live Deployment

| Component | URL |
|-----------|-----|
| **Client** | [wraith-stellar.vercel.app](https://wraith-stellar.vercel.app) |
| **TEE Backend** | Phala Cloud CVM (Intel TDX) |
| **TEE Health** | `/health` |
| **TEE Attestation** | `/tee/info` |
| **Swagger Docs** | `/docs` |

## Client Routes

| Route | Description |
|-------|-------------|
| `/` | Main chat interface — create/manage your agent |
| `/agents` | Agent directory — browse all registered agents |
| `/agent/:name` | Shareable agent profile card with QR and pay button |
| `/pay/:name` | Pay an agent with amount input and Freighter |
| `/pay/invoice/:id` | Pay a specific invoice |

## API Endpoints

### TEE
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | TEE runtime status |
| GET | `/tee/info` | TEE measurements (RTMR, compose hash) |
| GET | `/tee/attest/:agentId` | TDX attestation for agent's public key |

### Agent
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/agent/create` | Create agent (requires wallet signature) |
| GET | `/agents` | List all registered agents |
| GET | `/agent/:id` | Get agent by ID |
| GET | `/agent/info/:name` | Get agent by .wraith name |
| GET | `/agent/wallet/:address` | Get agent by owner wallet |
| GET | `/agent/:id/status` | Autonomous status report |
| GET | `/agent/:id/export` | Export agent secret key |
| POST | `/agent/:id/chat` | Chat with agent (Gemini AI) |

### Invoices
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/invoice/:id` | Get invoice details |
| POST | `/invoice/:id/paid` | Mark invoice as paid |

### Conversations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agent/:id/conversations` | List conversations |
| POST | `/agent/:id/conversations` | Create conversation |
| GET | `/agent/:id/conversations/:convId/messages` | Get messages |
| DELETE | `/agent/:id/conversations/:convId` | Delete conversation |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agent/:id/notifications` | Get notifications |
| POST | `/agent/:id/notifications/read` | Mark all as read |

## Roadmap

### Done
- Agent creation with wallet signature verification (SEP-53) + stealth identity + `.wraith` name
- Natural language chat with Gemini AI and 17 tools
- Private payments (send, receive, scan, withdraw) with multi-asset support (XLM + USDC)
- Invoice lifecycle (create, track, pay, notify)
- Agent-to-agent payments
- Scheduled/recurring payments with pause/resume/cancel and end dates
- Privacy advisor with scoring (0-100) and pattern analysis
- Notifications system with background monitoring
- Agent directory and shareable profile cards
- Guided onboarding tour
- Conversation history with multiple chats
- **Agent soul**: Privacy-first personality that proactively warns, refuses unsafe actions, and explains risks
- **Persistent memory**: Auto-extracts preferences and facts, summarizes when context grows, injected into every chat
- **Pending actions queue**: Events during absence are queued and delivered contextually by the agent
- **Privacy auto-pilot**: Autonomous stealth address management — monitors accumulation, auto-withdraws with safe timing
- **Auto-react to payments**: Background scanner creates contextual pending actions, not just notifications
- **Phala TEE deployment**: NestJS + PostgreSQL + DstackClient key derivation + TDX attestation
- **SEP-53 wallet verification**: Freighter message signing with `"Stellar Signed Message:\n"` prefix
- **CORS restricted**: TEE only accepts requests from authorized origins

### Future — Platform Vision
Wraith is evolving into a hosted platform where anyone can deploy a private agent to manage their entire financial portfolio anonymously:

- **Hosted agent deployment** — one-click agent creation, no server setup
- **Full portfolio management** — agents track balances, optimize timing, manage recurring obligations
- **Persistent monitoring** — agents watch for payments 24/7, auto-withdraw, auto-notify
- **Agent-to-agent messaging** — encrypted coordination between agents
- **Multi-chain stealth routing** — stealth payments across Stellar, Ethereum, and beyond
- **Payment channels (MPP)** — high-frequency micropayments for API-heavy agents
- **Decentralized scanning** — Mercury indexer for permissionless announcement scanning
- **Custom agent plugins** — users define their own tools and workflows

## How It Fits the Hackathon Theme

This hackathon is about exploring what happens when agents can pay. Wraith extends this: **what happens when agents can pay privately?**

- Agents access paid APIs without creating permanent on-chain usage profiles
- API providers receive payments without exposing identity to chain observers
- Multiple sessions are unlinkable — each payment to a fresh stealth address
- Named agents transact freely — no financial surveillance between agents
- All keys derived inside TEE — provably secure, never stored

## License

MIT
