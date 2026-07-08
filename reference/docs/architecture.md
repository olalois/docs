# Wraith Architecture

Wraith is a multichain stealth address platform with a managed AI agent service. Developers integrate stealth payments into their apps through a single SDK, while Wraith handles key management, hosting, and chain-specific logic inside TEE hardware.

---

## Overview

The system has three layers:

```
Developers
    │
    ▼
@wraith-protocol/sdk              ← npm package (client library)
    │
    ▼
Wraith TEE Infrastructure ← managed by Wraith (Phala TEE)
    │
    ▼
Blockchains              ← Horizen, Stellar, Solana, EVM chains
```

Developers never run servers, manage keys, or handle chain-specific crypto. They install the SDK, get an API key, and build.

---

## SDK Structure

Single npm package: `@wraith-protocol/sdk`

### Entry Points

| Import | Purpose | Audience |
|---|---|---|
| `@wraith-protocol/sdk` | Agent client — create agents, chat, payments | Most developers |
| `@wraith-protocol/sdk/chains/evm` | Raw secp256k1 stealth crypto primitives | Power users building custom EVM integrations |
| `@wraith-protocol/sdk/chains/stellar` | Raw ed25519 stealth crypto for Stellar | Power users building on Stellar |
| `@wraith-protocol/sdk/chains/solana` | Raw ed25519 stealth crypto for Solana | Power users building on Solana |

### Agent Client (`@wraith-protocol/sdk`)

The primary interface. Handles all communication with Wraith's hosted TEE infrastructure.

```typescript
import { Wraith, Chain } from "@wraith-protocol/sdk";

const wraith = new Wraith({
  apiKey: "wraith_...",
  ai: {                        // optional: bring your own model
    provider: "openai",
    apiKey: "sk-...",
  }
});

// Single-chain agent
const agent = await wraith.createAgent({
  name: "alice",
  chain: Chain.Horizen,
  wallet: "0x...",
  signature: "0x...",
});

// Multichain agent — one name, multiple chains
const multiAgent = await wraith.createAgent({
  name: "bob",
  chain: [Chain.Horizen, Chain.Stellar, Chain.Ethereum],
  wallet: "0x...",
  signature: "0x...",
});

// Or deploy on every supported chain at once
const omniAgent = await wraith.createAgent({
  name: "carol",
  chain: Chain.All,
  wallet: "0x...",
  signature: "0x...",
});

// Chat with natural language — AI routes to the right chain
const response = await agent.chat("send 0.1 ETH to bob.wraith");

// Multichain agents handle cross-chain context
await multiAgent.chat("what's my balance on all chains?");
await multiAgent.chat("send 10 XLM to carol.wraith on stellar");
```

Chains are a `Chain` enum, not a raw string. Pass a single chain or an array for multichain agents. No chain-specific code on the developer's side. The SDK sends API calls to the TEE, which handles everything.

### Chain Crypto Primitives (`@wraith-protocol/sdk/chains/*`)

For developers building custom stealth address integrations without the managed agent platform.

```typescript
// EVM chains (Horizen, Ethereum, Polygon, Base, etc.)
import {
  generateStealthAddress,
  deriveStealthKeys,
  scanAnnouncements,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  signNameRegistration,
  SCHEME_ID,
} from "@wraith-protocol/sdk/chains/evm";

// Stellar
import {
  generateStealthAddress,
  deriveStealthKeys,
  scanAnnouncements,
} from "@wraith-protocol/sdk/chains/stellar";
```

Each chain module exports the same conceptual functions adapted to that chain's cryptographic scheme and address format.

---

## TEE Infrastructure

### Design: Single TEE, Pluggable Chain Modules

One NestJS server deployment with a chain connector registry. The core agent engine is chain-agnostic. Chain-specific logic lives behind a pluggable interface.

```
TEE Server
  ├── Core (chain-agnostic)
  │    ├── AI Engine (Gemini, or developer's own model)
  │    ├── Storage (PostgreSQL)
  │    ├── Session & Conversation Management
  │    ├── Notifications
  │    ├── Scheduled Payments
  │    └── Tool Orchestration
  │
  ├── Chain Connector Registry
  │    ├── EVMConnector        → Horizen, Ethereum, Polygon, Base, ...
  │    ├── StellarConnector    → Stellar
  │    └── SolanaConnector     → Solana
  │
  └── TEE Key Derivation (DStack)
       └── Path: wraith/agent/{agentId}/{chain}
```

### Chain Connector Interface

Every chain connector implements one interface:

```tsx
interface ChainConnector {
  // Identity
  deriveKeys(seed: Uint8Array): {
    address: string;
    stealthKeys: StealthKeys;
    metaAddress: string;
  };

  // Payments
  sendPayment(from: string, to: string, amount: string, stealthKeys: StealthKeys): Promise<TxResult>;
  scanPayments(stealthKeys: StealthKeys): Promise<Payment[]>;
  getBalance(address: string): Promise<Balance>;

  // Withdrawal
  withdraw(stealthKeys: StealthKeys, from: string, to: string, amount?: string): Promise<TxResult>;

  // Names
  registerName(name: string, stealthKeys: StealthKeys): Promise<TxResult>;
  resolveName(name: string): Promise<string | null>;

  // Funding
  fundWallet(address: string): Promise<TxResult>;
}
```

### Adding a New Chain

**New EVM chain** — config only. Same `EVMConnector`, different RPC URL and contract addresses:

```typescript
chainRegistry.register("base", new EVMConnector({
  chainId: 8453,
  rpcUrl: "https://mainnet.base.org",
  contracts: { ... },
}));
```

**New chain family** — one new connector file implementing the `ChainConnector` interface. The core agent logic, AI, storage, and tools remain untouched.

### Key Derivation

Agent keys are derived deterministically inside TEE hardware via DStack. The derivation path includes the chain to prevent key collision:

```
wraith/agent/{agentId}/horizen   → secp256k1 keys for Horizen
wraith/agent/{agentId}/stellar   → ed25519 keys for Stellar
wraith/agent/{agentId}/solana    → ed25519 keys for Solana
```

Keys are never stored. They are re-derived on demand from the TEE's root secret.

### Database Schema

The agent table includes a `chain` column:

| Column | Type | Description |
|---|---|---|
| id | UUID | Agent identifier |
| name | string | .wraith name |
| chain | string | Target chain ("horizen", "stellar", etc.) |
| ownerWallet | string | Owner's wallet address |
| address | string | Agent's on-chain address |
| metaAddress | string | Stealth meta-address |

---

## Platform Model

Wraith operates as a managed service, similar to Privy or Turnkey.

### For Developers

1. Sign up, get an API key
2. `npm install @wraith-protocol/sdk`
3. Create agents, send payments, build features
4. Never touch servers, keys, or chain-specific crypto

### AI Model Options

| Option | Description |
|---|---|
| Default | Use Wraith's hosted Gemini model (included in API usage) |
| Bring Your Own | Pass your own OpenAI/Claude/Gemini API key to reduce cost |

### What Wraith Manages

- TEE infrastructure (Phala deployment)
- Key derivation and security
- Chain connectors and RPC endpoints
- Database and session storage
- Name registration and gas sponsorship
- Payment scanning and notifications

---

## Cryptographic Schemes

### EVM Chains (secp256k1)

Based on ERC-5564 (Stealth Address Messenger) and ERC-6538 (Stealth Meta-Address Registry).

- Stealth meta-address format: `st:eth:0x{spendPubKey}{viewPubKey}`
- Key derivation: ECDH on secp256k1
- Announcement: on-chain event with ephemeral public key and view tag
- Contracts: WraithAnnouncer, WraithRegistry, WraithNames, WraithSender

### Stellar (ed25519)

Same stealth address concept adapted to ed25519 and Soroban smart contracts.

- Stealth meta-address format: `st:xlm:{spendPubKey}{viewPubKey}`
- Key derivation: ECDH on ed25519 (using x25519 conversion)
- Announcement: Soroban contract event

### Solana (ed25519)

Stealth addresses on Solana using ed25519 and Solana programs.

- Stealth meta-address format: `st:sol:{spendPubKey}{viewPubKey}`
- Key derivation: Same as Stellar (ed25519)
- Announcement: Program log events

---

## Security Model

### TEE Guarantees

- Agent private keys derived inside Intel TDX hardware enclaves
- Keys never stored on disk or exported without wallet signature verification
- DStack SDK provides deterministic derivation from hardware root secret
- Remote attestation proves code integrity to clients

### Privacy Properties

- Every payment goes to a fresh one-time stealth address
- On-chain observers see random addresses with no link to sender or receiver
- View tags enable efficient scanning without revealing payment details
- AI agent proactively warns about privacy risks (timing patterns, address reuse)

### Wallet Ownership

- Agent creation requires EIP-191 signature from the owner wallet
- Key export requires a fresh signature from the owner wallet
- Owner wallet address stored for verification, never for key derivation
