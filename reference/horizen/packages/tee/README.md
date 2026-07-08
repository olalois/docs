# Wraith TEE Agent

Production-grade agent server running inside a Phala TEE (Intel TDX). Private keys are derived on-demand from the TEE's secure enclave and never stored in any database. Same agent tools as the Express server, hardened with hardware-level key security.

## How it works

Each agent's EVM private key is derived deterministically from its UUID via Phala's DStack SDK. The derivation happens inside the TEE enclave — the key exists only in memory during the signing operation and is discarded immediately after. The same agentId always produces the same key, so agents are recoverable without backup. But no one — not the server operator, not the database admin, not anyone with disk access — can extract the key.

TEE attestation via `getQuote()` proves to any verifier that the agent's address was generated inside genuine Intel TDX hardware running the exact published code.

## Architecture

```
Client / API  ◄──HTTP──►  NestJS (inside Phala TEE)
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              Horizen RPC    Goldsky       PostgreSQL
              (txs)          (scanning)    (persistence)
                    │
                    ▼
              DStack SDK
              (key derivation)
```

## Key derivation

```
agentId (UUID, stored in PostgreSQL)
  → DStack.getKey("wraith/agent/{agentId}/horizen")
  → SHA-256 hash → 32-byte EVM private key
  → privateKeyToAccount() → 0x... address
  → account.signMessage(STEALTH_SIGNING_MESSAGE)
  → 65-byte ECDSA signature
  → deriveStealthKeys() → spending + viewing keys
  → Key used for signing, then discarded
```

## vs Express server

| | Express (`packages/server/`) | TEE (`packages/tee/`) |
|---|---|---|
| Framework | Express | NestJS |
| Database | SQLite | PostgreSQL (TypeORM) |
| Key storage | AES-256-GCM encrypted in DB | Never stored — derived from TEE |
| Key security | Encryption key in `.env` | Hardware-sealed enclave |
| Attestation | None | Phala TEE attestation |
| Deployment | Any server | Phala Cloud (Intel TDX) |
| Use case | Development, testnet | Production, mainnet |

## Endpoints

All endpoints from the Express server plus:

- `GET /tee/info` — TEE measurements (app_id, rtmr0-3, compose_hash)
- `GET /tee/attest/:agentId` — Attestation quote + agent address

## Entities (PostgreSQL)

10 tables: agents, conversations, messages, invoices, notifications, scheduled_payments, seen_stealth_addresses, agent_memory, pending_actions, agent_settings

## Deploy

### Docker

```bash
# Build from repo root
docker build -f packages/tee/Dockerfile -t truthixify/wraith-tee:latest .

# Run with docker-compose (includes PostgreSQL)
cd packages/tee
POSTGRES_PASSWORD=yourpass GEMINI_API_KEY=yourkey docker-compose up
```

### Phala Cloud

Deploy the Docker image to Phala Cloud. The `docker-compose.yml` is pre-configured:

```yaml
image: truthixify/wraith-tee:latest@sha256:8cdaa08740eead53cfd4c020d1099e510248797a98771c8fe5b1c2e718b303a1
```

Required environment variables:
- `DATABASE_URL` — PostgreSQL connection string
- `GEMINI_API_KEY` — Google Gemini API key
- `CHAIN_ID` — Horizen chain ID (default: 2651420)
- `RPC_URL` — Horizen RPC endpoint
- `DEPLOYER_KEY` — Funded wallet for seeding new agents
- `PORT` — Server port (default: 3000)

The container expects `/var/run/dstack.sock` mounted for DStack communication.

## Agent tools

Same 16+ tools as the Express server: `send_payment`, `pay_agent`, `scan_payments`, `get_balance`, `create_invoice`, `check_invoices`, `withdraw`, `withdraw_all`, `register_name`, `resolve_name`, `get_agent_info`, `fund_wallet`, `privacy_check`, `schedule_payment`, `list_schedules`, `manage_schedule`, `save_memory`.

## Background jobs

- **Every 60s** — Execute due scheduled payments
- **Every 5min** — Background scan for incoming stealth payments, auto-notify agents
