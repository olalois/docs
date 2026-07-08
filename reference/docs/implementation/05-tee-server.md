# 05 — TEE Server Architecture

The TEE server is the internal infrastructure that powers the managed platform. It runs on Phala TEE (Intel TDX) hardware and handles agent lifecycle, AI chat, tools, and chain operations.

## Stack

- **Runtime:** Node.js 22 (Alpine)
- **Framework:** NestJS
- **Database:** PostgreSQL 16 (TypeORM)
- **AI:** Google Gemini (default), configurable per agent
- **TEE:** Phala DStack SDK for deterministic key derivation
- **Container:** Docker (linux/amd64 for TEE hardware)

## Module Structure

```
src/
  main.ts                           ← NestJS bootstrap, CORS, Swagger
  app.module.ts                     ← root module importing all feature modules
  config/
    configuration.ts                ← centralized config from env vars
  tee/
    tee.module.ts
    tee.service.ts                  ← DStack key derivation
    tee.controller.ts               ← TEE attestation endpoints
  agent/
    agent.module.ts
    agent.controller.ts             ← HTTP endpoints (create, chat, export, etc.)
    agent.service.ts                ← agent lifecycle, chat orchestration
    tools/
      tool-definitions.ts           ← Gemini function declarations + system prompt
      agent-tools.service.ts        ← tool execution (send, scan, withdraw, etc.)
  storage/
    storage.module.ts
    database.service.ts             ← TypeORM repository access
    entities/
      agent.entity.ts               ← id, name, chain, ownerWallet, address, metaAddress
      conversation.entity.ts
      message.entity.ts
      invoice.entity.ts
      notification.entity.ts
      scheduled-payment.entity.ts
      pending-action.entity.ts
      seen-stealth.entity.ts
      memory.entity.ts
      agent-settings.entity.ts
  notifications/
    notification.module.ts
    notification.service.ts         ← create, list, mark read, delete
    notification.controller.ts      ← notification HTTP endpoints
  scheduler/
    scheduler.module.ts
    scheduler.service.ts            ← cron-based scheduled payment execution
  health/
    health.module.ts
    health.controller.ts            ← /health endpoint
```

## Key Derivation (TEE Service)

Keys are derived deterministically from DStack's hardware root secret. Never stored.

```ts
class TeeService {
  async deriveAgentPrivateKey(agentId: string, chain: string): Promise<Hex> {
    const raw = await dstack.getKey(`wraith/agent/${agentId}/${chain}`);
    const hash = sha256(raw);
    return `0x${toHex(hash)}`;
  }

  async deriveAgentKeypair(agentId: string, chain: string) {
    const connector = this.chainRegistry.get(chain);
    const seed = await this.deriveRawSeed(agentId, chain);
    return connector.deriveKeys(seed);
  }
}
```

The path `wraith/agent/{agentId}/{chain}` ensures different chains produce different keys for the same agent.

## Agent Controller — HTTP API

| Method | Path | Purpose |
|---|---|---|
| POST | `/agent/create` | Create agent (name, wallet, signature, chain) |
| GET | `/agents` | List all agents |
| GET | `/agent/:id` | Get agent by ID |
| GET | `/agent/info/:name` | Get agent by .wraith name |
| GET | `/agent/wallet/:address` | Get agent by owner wallet |
| GET | `/agent/:id/status` | Agent status (balance, stats) |
| POST | `/agent/:id/export` | Export private key (requires wallet signature) |
| POST | `/agent/:id/chat` | Chat with agent |
| GET | `/invoice/:id` | Get invoice |
| POST | `/invoice/:id/paid` | Mark invoice paid (idempotent) |
| GET | `/agent/:id/conversations` | List conversations |
| POST | `/agent/:id/conversations` | Create conversation |
| GET | `/agent/:id/conversations/:convId/messages` | Get messages |
| DELETE | `/agent/:id/conversations/:convId` | Delete conversation |
| GET | `/agent/:id/notifications` | List notifications |
| POST | `/agent/:id/notifications/read` | Mark all read |
| DELETE | `/agent/:id/notifications` | Clear all |
| GET | `/health` | Health check |
| GET | `/tee/info` | TEE status |
| GET | `/tee/attest/:agentId` | Remote attestation |

## Agent Creation Flow

```
1. Client sends POST /agent/create { name, wallet, signature, message, chain }
2. Verify EIP-191 signature matches wallet (for EVM) or ed25519 (for Stellar)
3. Generate UUID for agent
4. Derive keys via TEE: seed → chain connector → { address, stealthKeys, metaAddress }
5. Fund agent wallet via chain faucet
6. Store agent in DB (id, name, chain, ownerWallet, address, metaAddress)
7. Register .wraith name on-chain (best effort)
8. Return { id, name, chain, address, metaAddress }
```

## Chat Orchestration (Agent Service)

The chat method manages the Gemini AI conversation loop:

```
1. Load agent from DB
2. Re-derive keys from TEE (never stored)
3. Build Gemini chat with system prompt + tool declarations
4. Send user message to Gemini
5. While Gemini returns function calls:
   a. Execute each tool via agent-tools.service
   b. Return results to Gemini as functionResponse
   c. Gemini processes results and may call more tools
6. Return final text response + tool call log
```

## Tool Definitions

16 tools declared as Gemini function_declarations:

| Tool | Parameters | Purpose |
|---|---|---|
| `send_payment` | recipient, amount, asset | Send stealth payment |
| `pay_agent` | agent_name, amount, asset | Pay by .wraith name |
| `scan_payments` | (none) | Scan for incoming payments |
| `get_balance` | (none) | Check wallet balance |
| `create_invoice` | amount, memo | Create payment invoice |
| `check_invoices` | (none) | Check invoice statuses |
| `withdraw` | from, to, amount | Withdraw from stealth address |
| `withdraw_all` | to | Withdraw from all stealth addresses |
| `register_name` | name | Register .wraith name |
| `resolve_name` | name | Look up .wraith name |
| `get_agent_info` | (none) | Show agent identity |
| `fund_wallet` | (none) | Fund via faucet |
| `privacy_check` | (none) | Analyze privacy score |
| `schedule_payment` | recipient, amount, interval, asset | Schedule recurring payment |
| `list_schedules` | (none) | List scheduled payments |
| `cancel_schedule` | schedule_id | Cancel schedule |

## Tool Execution

Each tool call resolves to the appropriate chain connector method:

```ts
async executeTool(toolName: string, args: any, agent: Agent) {
  const connector = this.chainRegistry.get(agent.chain);
  const stealthKeys = await this.tee.deriveStealthKeys(agent.id, agent.chain);

  switch (toolName) {
    case "send_payment":
      return connector.sendPayment({ ... });
    case "scan_payments":
      return connector.scanPayments(stealthKeys);
    case "withdraw":
      return connector.withdraw({ stealthKeys, from: args.from, to: args.to, amount: args.amount });
    // ...
  }
}
```

## Database Schema

### agents
| Column | Type | Description |
|---|---|---|
| id | UUID (PK) | Agent identifier |
| name | VARCHAR | .wraith name (unique) |
| chain | VARCHAR | Target chain identifier |
| ownerWallet | VARCHAR | Owner's wallet address |
| address | VARCHAR | Agent's on-chain address |
| metaAddress | TEXT | Stealth meta-address |
| createdAt | TIMESTAMP | Creation time |

### conversations
| Column | Type |
|---|---|
| id | UUID (PK) |
| agentId | UUID (FK → agents) |
| title | VARCHAR |
| createdAt | TIMESTAMP |
| updatedAt | TIMESTAMP |

### messages
| Column | Type |
|---|---|
| id | SERIAL (PK) |
| conversationId | UUID (FK → conversations) |
| role | VARCHAR (user/agent/tool/system) |
| text | TEXT |
| createdAt | TIMESTAMP |

### invoices
| Column | Type |
|---|---|
| id | UUID (PK) |
| agentId | UUID (FK → agents) |
| amount | VARCHAR |
| asset | VARCHAR |
| memo | TEXT |
| status | VARCHAR (pending/paid) |
| txHash | VARCHAR (nullable) |
| createdAt | TIMESTAMP |

### notifications
| Column | Type |
|---|---|
| id | SERIAL (PK) |
| agentId | UUID (FK → agents) |
| type | VARCHAR |
| title | VARCHAR |
| body | TEXT |
| read | BOOLEAN |
| createdAt | TIMESTAMP |

### scheduled_payments
| Column | Type |
|---|---|
| id | UUID (PK) |
| agentId | UUID (FK → agents) |
| recipient | VARCHAR |
| amount | VARCHAR |
| asset | VARCHAR |
| interval | VARCHAR (daily/weekly/monthly) |
| status | VARCHAR (active/paused/cancelled) |
| lastRun | TIMESTAMP (nullable) |
| nextRun | TIMESTAMP |
| createdAt | TIMESTAMP |

## System Prompt

The Gemini system prompt establishes the agent's identity and behavior:

- Privacy-first personality: warns about timing analysis, address correlation
- Refuses unsafe actions (withdrawing all to same address without warning)
- Knows the chain context (Horizen vs Stellar, native asset, address format)
- Reports balances, transaction links, and privacy scores
- Uses structured tool responses for invoices (includes markdownLink)

## Deployment

### Docker Build

```bash
docker buildx build --platform linux/amd64 -t truthixify/wraith-tee:latest --push -f packages/tee/Dockerfile .
```

The Dockerfile builds from repo root, copies SDK + TEE packages, installs deps, compiles both.

### docker-compose.yml

```yaml
services:
  app:
    image: truthixify/wraith-tee:latest@sha256:...
    ports: ["3000:3000"]
    volumes: ["/var/run/dstack.sock:/var/run/dstack.sock"]
    environment:
      - DATABASE_URL=postgresql://wraith:${POSTGRES_PASSWORD}@db:5432/wraith
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - DEPLOYER_KEY=${DEPLOYER_KEY}
      - CHAIN_ID=2651420
      - RPC_URL=...
    depends_on:
      db: { condition: service_healthy }
  db:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data]
```

### Deploy to Phala

```bash
phala deploy --cvm-id <app_id> -c docker-compose.yml
```
