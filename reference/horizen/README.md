# Wraith

Private payments on Horizen. Two SDKs, five contracts, and AI-powered agents that manage your portfolio privately, securely, and anonymously.

## What is Wraith

Wraith is privacy infrastructure for Horizen built on stealth addresses. It ships as two SDKs:

**`@wraith-horizen/sdk`** — the stealth address cryptography SDK. Pure TypeScript, no RPC calls, wallet-agnostic. Handles key derivation, stealth address generation, announcement scanning, spending key derivation, and name registration signing. Any developer drops this into their dApp to add private payment support. This is the cryptographic foundation everything else is built on.

**`@wraith-horizen/agent-sdk`** *(coming)* — the agent SDK. A complete framework for deploying AI-powered payment agents that manage private transactions autonomously. Each agent gets its own wallet, stealth identity, and `.wraith` name. The agent handles sending, receiving, invoicing, scheduled payments, withdrawal optimization, and privacy analysis — all through natural language via an LLM with tool calling. Developers integrate this to give their users a managed private payment service where the user never touches a key, never builds a transaction, and never thinks about stealth address mechanics. They just tell the agent what to do.

The current agent server (`packages/server/`) is the reference implementation. It uses Gemini AI, SQLite, and Express. The SDK extraction will make each of these pluggable:

- **Pluggable AI** — the agent tools are LLM-agnostic. They take structured arguments and return structured results. Swap Gemini for OpenAI, Claude, Llama, or any model that supports tool calling. The tool declarations are plain JSON schemas. The chat loop is a thin wrapper that routes function calls to tool implementations and feeds results back to the model.

- **Pluggable storage** — the SDK defines interfaces for agent persistence (`AgentStore`), conversation history (`ConversationStore`), invoice tracking (`InvoiceStore`), notification delivery (`NotificationStore`), and scheduled payment management (`ScheduleStore`). The reference implementation uses SQLite. Swap for Postgres, Redis, DynamoDB, or anything that implements the interfaces.

- **Pluggable key management** — the SDK defines a `KeyStore` interface with `create()`, `sign()`, and `derive()` methods. The reference implementation uses AES-256-GCM encryption with a server-side key. Swap for TEE-sealed keys (the production plan), HSM, MPC, or any secure enclave. The agent never handles raw keys directly — it calls `KeyStore.sign(agentId, message)` and gets a signature back.

The production deployment plan is TEE (Trusted Execution Environment). The server runs inside a secure enclave. Private keys exist only in enclave memory. Encryption keys are sealed to the TEE hardware. The client cannot extract keys even with full server access. TEE attestation proves the server is running the exact published code. This is what makes the agent trustworthy for real funds on mainnet.

## How stealth addresses work

A sender takes a recipient's public stealth meta-address, generates a one-time stealth address using elliptic curve math (secp256k1 ECDH), sends assets to it, and publishes an on-chain announcement. The recipient scans announcements with their viewing key to find incoming transfers, then derives the private key to spend from them. To outside observers, it looks like a transaction to a random fresh wallet. The viewing key finds transfers. The spending key accesses them. You can delegate scanning without risking funds.

## Contracts (Horizen Testnet)

| Contract | Address | Purpose |
|----------|---------|---------|
| ERC5564Announcer | [`0x8AE65c05E7eb48B9bA652781Bc0a3DBA09A484F3`](https://horizen-testnet.explorer.caldera.xyz/address/0x8AE65c05E7eb48B9bA652781Bc0a3DBA09A484F3) | Stealth transfer announcements (ERC-5564) |
| ERC6538Registry | [`0x953E6cEdcdfAe321796e7637d33653F6Ce05c527`](https://horizen-testnet.explorer.caldera.xyz/address/0x953E6cEdcdfAe321796e7637d33653F6Ce05c527) | Stealth meta-address registry (ERC-6538) |
| WraithSender | [`0x226C5eb4e139D9fa01cc09eA318638b090b12095`](https://horizen-testnet.explorer.caldera.xyz/address/0x226C5eb4e139D9fa01cc09eA318638b090b12095) | Atomic send + announce, single & batch, ERC-20 gas tipping |
| WraithWithdrawer | [`0x9F7f1C9d8B5a83245c6fC8415Ef744C458101711`](https://horizen-testnet.explorer.caldera.xyz/address/0x9F7f1C9d8B5a83245c6fC8415Ef744C458101711) | EIP-7702 gas-sponsored withdrawals |
| WraithNames | [`0x3d46f709a99A3910f52bD292211Eb5D557F882D6`](https://horizen-testnet.explorer.caldera.xyz/address/0x3d46f709a99A3910f52bD292211Eb5D557F882D6) | Human-readable name → stealth meta-address registry |

## Quick start

```bash
pnpm install

# Contract tests
cd contracts && npx hardhat test

# SDK tests
cd packages/sdk && pnpm test

# Web app (manual stealth transfers)
cd packages/web && pnpm dev

# Agent server (requires PRIVATE_KEY and GEMINI_API_KEY in packages/server/.env)
cd packages/server && pnpm dev

# Agent client
cd packages/client && pnpm dev
```

## Monorepo

```
wraith/
├── contracts/            # Solidity — Announcer, Registry, Sender, Withdrawer, Names
├── packages/
│   ├── sdk/              # @wraith-horizen/sdk — stealth address cryptography
│   ├── web/              # Vite + React — manual stealth transfers UI
│   ├── server/           # Express — AI agent server (reference implementation)
│   ├── client/           # Vite + React — agent chat UI
│   └── tee/              # NestJS — TEE-secured agent server (Phala TEE + PostgreSQL)
├── relayer/              # Express — gas sponsorship + name registration
├── subgraph/             # Goldsky subgraph for indexing announcements
└── SPEC.md               # Full protocol specification
```

## Stealth SDK (`@wraith-horizen/sdk`)

Pure computation. No RPC calls. No state. Works with viem, ethers, or raw signatures.

```typescript
import {
  deriveStealthKeys,          // wallet signature → spending/viewing key pairs
  encodeStealthMetaAddress,   // two public keys → shareable st:eth:0x... string
  generateStealthAddress,     // recipient meta-address → one-time stealth address
  scanAnnouncements,          // viewing key + announcements → matched transfers
  deriveStealthPrivateKey,    // spending key + ephemeral key → stealth private key
  signNameRegistration,       // spending key signs name registration for WraithNames
  STEALTH_SIGNING_MESSAGE,    // the fixed message users sign to derive keys
} from "@wraith-horizen/sdk";
```

See [`packages/sdk/README.md`](packages/sdk/README.md) for full API.

## Web App

Manual stealth transfer interface. Connect wallet via RainbowKit, derive stealth keys, send/receive privately.

- **Setup** — derive keys, register meta-address, claim `.wraith` name
- **Send** — send ETH/ZEN/USDC privately (single and batch), gas tip for ERC-20
- **Receive** — scan via Goldsky subgraph, one-click withdrawal, batch withdraw, privacy protections
- **Pay** — payment links with QR codes, `.wraith` name resolution

## Agent

A privacy-first AI assistant for managing payments on Horizen. Users deploy their own agent with its own wallet, stealth identity, and `.wraith` name. The agent handles everything through natural language.

### What the agent does

| Capability | Example | What happens |
|---|---|---|
| Send privately | *"Send 0.01 ETH to alice.wraith"* | Resolves name → generates stealth address → sends via WraithSender → announces atomically |
| Receive privately | *"Check my incoming payments"* | Scans Goldsky subgraph → matches with viewing key → reports balances |
| Invoice | *"Invoice 0.01 ETH for consulting"* | Generates clickable payment link → tracks status → notifies on payment |
| Withdraw | *"Withdraw all to 0xABC..."* | Derives stealth keys in memory → signs → discards. Warns about patterns |
| Schedule | *"Pay alice.wraith weekly"* | Recurring payments, each to a fresh stealth address |
| Privacy analysis | *"Check my privacy"* | Analyzes dust, funded count, gas levels, suggests improvements |
| Agent-to-agent | *"Pay oracle.wraith"* | Private payment between agents, no on-chain link |
| API gating (x402) | Middleware on any Express endpoint | Stealth payment → session token → 1 hour access |

### 16 agent tools

`send_payment` · `pay_agent` · `scan_payments` · `get_balance` · `create_invoice` · `check_invoices` · `withdraw` · `withdraw_all` · `register_name` · `resolve_name` · `get_agent_info` · `fund_wallet` · `privacy_check` · `schedule_payment` · `list_schedules` · `manage_schedule`

### Architecture

```
Client (React + RainbowKit)  ◄──REST──►  Server (Express + Gemini + SQLite)
                                                    │
                                      ┌─────────────┼─────────────┐
                                      ▼             ▼             ▼
                                Horizen RPC    Goldsky       Relayer
                                (txs, balances) (scanning)  (gas sponsorship)
```

### Security

**Express server** (`packages/server/`): Agent private keys encrypted with AES-256-GCM in SQLite. Encryption key in `.env`. Suitable for testnet and development.

**TEE server** (`packages/tee/`): NestJS running inside Phala TEE (Intel TDX). Private keys derived on-demand from DStack — never stored in any database. Same agentId always produces the same key, but the key only exists in enclave memory during signing. PostgreSQL for persistence. TEE attestation proves the server runs the published code. Even the operator cannot extract keys. This is the production deployment for mainnet.

### Agent SDK (`@wraith-horizen/agent-sdk`) — planned

The agent engine extracted into a standalone TypeScript package. The current `packages/server/` is the reference implementation. The SDK will expose:

- `createAgent(name, options)` — generate wallet, derive stealth keys, register name
- `chat(agentId, message, history)` — LLM chat with automatic tool execution
- `executeScheduledPayments()` — cron runner for recurring payments
- All 16 tools as standalone functions callable without an LLM
- `AgentStore`, `KeyStore`, `ConversationStore`, `InvoiceStore` interfaces for pluggable backends

Any dApp on Horizen embeds private payment agents without building stealth address infrastructure. The developer provides the AI model, the database, and the key storage. The SDK provides the stealth payment logic, tool implementations, and agent lifecycle management.

## Roadmap

**Done:**
- [x] Stealth address SDK (ERC-5564 + ERC-6538)
- [x] Atomic send-and-announce (WraithSender)
- [x] Gas-sponsored withdrawals (EIP-7702 WraithWithdrawer)
- [x] Batch send and batch withdraw
- [x] One-click withdrawal (key derived in memory, signed, discarded)
- [x] Subgraph indexing via Goldsky
- [x] UX privacy protections (connected wallet blocking, fresh destinations, timing warnings)
- [x] Human-readable names (WraithNames — no wallet stored, spending key ownership)
- [x] Payment links with QR codes
- [x] AI agent system (Gemini + 16 tools + x402 + invoices + scheduling)
- [x] ERC-20 gas tipping (sender includes ETH for recipient's withdrawal gas)

**Next:**
- [ ] Agent SDK extraction (`@wraith-horizen/agent-sdk`)
- [x] TEE deployment (Phala TEE + PostgreSQL + NestJS)
- [ ] On-chain private messaging (ECDH encrypted, sender anonymous)
- [ ] Multi-chain stealth routing (Horizen + Stellar + more)
- [ ] FHE-DKSAP (trustless outsourced scanning without sharing viewing key)
- [ ] Mobile

## References

- [ERC-5564 — Stealth Address Messenger](https://eips.ethereum.org/EIPS/eip-5564)
- [ERC-6538 — Stealth Meta-Address Registry](https://eips.ethereum.org/EIPS/eip-6538)
- [Vitalik's stealth address guide](https://vitalik.ca/general/2023/01/20/stealth.html)
- [RFC 6979 — Deterministic signatures](https://www.rfc-editor.org/rfc/rfc6979)
- [FHE-DKSAP research](https://ethresear.ch/t/fhe-dksap-fully-homomorphic-encryption-based-dual-key-stealth-address-protocol/16213)
- [Goldsky](https://goldsky.com/)

## License

MIT
