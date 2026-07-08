# Wraith Agent Client

Chat UI for deploying and managing private payment agents on Horizen.

## What it is

Each user connects their wallet and creates an AI agent with its own EVM wallet, stealth identity, and `.wraith` name. The agent handles all private payment operations through natural language — sending, receiving, invoicing, scheduling, withdrawing, and privacy analysis. All stealth address cryptography happens server-side. The client is a chat interface.

The long-term vision is a managed service where anyone can deploy an agent that handles their entire private payment portfolio — no key management, no transaction building, just tell the agent what to do.

## Setup

```bash
cd packages/client
pnpm install
pnpm dev
```

Opens at `http://localhost:5175`. Requires the agent server running on port 3002.

## Environment variables

Create a `.env` file:

```
VITE_SERVER_URL=http://localhost:3002
VITE_WC_PROJECT_ID=your_walletconnect_project_id
```

## How it works

1. Connect wallet via RainbowKit (MetaMask, WalletConnect, etc.)
2. Create an agent — server generates a wallet, derives stealth keys, registers `.wraith` name
3. Chat with the agent — send payments, scan for incoming transfers, create invoices, schedule recurring payments
4. Agent executes tools server-side and responds with results

The client never touches private keys. All stealth operations happen on the server. The only exception is the Pay and Invoice pages where the user signs transactions directly with their connected wallet to pay another agent.

## Pages

- **Chat** (`/`) — main chat interface with conversation sidebar, notification bell, slash commands, guided tour, settings
- **Agents** (`/agents`) — browse all registered agents with search, click to see profile card with QR code
- **Agent Profile** (`/agent/:name`) — shareable profile card with balance, QR code, pay button, explorer link
- **Pay** (`/pay/:name`) — pay an agent directly. Connects wallet, generates stealth address, sends via WraithSender contract
- **Pay Invoice** (`/pay/invoice/:id`) — pay a specific invoice. Shows amount, memo, QR code, direct wallet payment

## Slash commands

| Command | Description |
|---------|-------------|
| `/send` | Send ETH privately to a .wraith name |
| `/scan` | Scan for incoming stealth payments |
| `/balance` | Check agent wallet balance |
| `/invoice` | Create a payment invoice |
| `/invoices` | Check invoice statuses |
| `/withdraw` | Withdraw from a stealth address |
| `/withdraw_all` | Withdraw from all stealth addresses |
| `/fund` | Fund agent wallet with testnet ETH |
| `/info` | Show agent identity card |
| `/privacy` | Analyze activity for privacy leaks |
| `/schedule` | Schedule a recurring payment |
| `/schedules` | List scheduled payments |
| `/manage_schedule` | Pause, resume, or cancel a schedule |
| `/resolve` | Look up a .wraith name |
| `/pay` | Pay another agent |
| `/agents` | Browse agent directory |

## Agent tools (server-side)

| Tool | Description |
|------|-------------|
| `send_payment` | Send ETH/ZEN/USDC to a meta-address or .wraith name via stealth address |
| `pay_agent` | Pay another Wraith agent privately |
| `scan_payments` | Scan for incoming stealth payments via Goldsky subgraph |
| `get_balance` | Check agent's wallet balance (ETH + ERC-20) |
| `create_invoice` | Generate a clickable payment link with amount and memo |
| `check_invoices` | Check invoice statuses and match incoming payments |
| `withdraw` | Withdraw funds from a stealth address to a destination |
| `withdraw_all` | Withdraw from all detected stealth addresses |
| `register_name` | Register a .wraith name (via relayer, gas-sponsored) |
| `resolve_name` | Look up a .wraith name to get meta-address |
| `get_agent_info` | Get agent identity: name, address, meta-address, balance |
| `fund_wallet` | Fund agent wallet with testnet ETH |
| `privacy_check` | Analyze activity for privacy leaks |
| `schedule_payment` | Schedule a recurring private payment (daily/weekly/monthly) |
| `list_schedules` | List all active scheduled payments |
| `manage_schedule` | Pause, resume, or cancel a scheduled payment |

## Architecture

```
Client (React + RainbowKit)
  │
  │  REST API
  ▼
Server (Express + Gemini AI + SQLite)
  │
  ├──► Horizen RPC (transactions, balances)
  ├──► Goldsky Subgraph (announcement scanning)
  └──► Relayer (gas sponsorship, name registration)
```

The server is the brain. The client is the interface. The SDK is the cryptography. The contracts are the on-chain infrastructure.

## Security

**Current (testnet):** Agent private keys encrypted with AES-256-GCM, stored in SQLite. Encryption key in `.env`.

**Production plan:** Server runs in a TEE (Trusted Execution Environment). Private keys exist only in enclave memory. Encryption keys sealed to the TEE. Even the server operator cannot extract keys.

## Agent SDK vision

The agent engine will be extracted into `@wraith-horizen/agent-sdk`:

- **Pluggable AI** — swap Gemini for OpenAI, Claude, or any LLM with tool calling
- **Pluggable storage** — swap SQLite for Postgres, Redis, or any persistence layer
- **Pluggable key management** — swap AES-256-GCM for TEE-sealed keys, HSM, or MPC

Any dApp on Horizen can embed private payment agents without building stealth address infrastructure from scratch.

## Tech

- React 19, Vite, TailwindCSS
- RainbowKit + wagmi + viem (wallet connection + direct payment)
- `@wraith-horizen/sdk` (stealth address crypto on Pay/Invoice pages)
- `react-markdown` (chat message rendering)
- `qrcode.react` (QR codes on profile/pay pages)
