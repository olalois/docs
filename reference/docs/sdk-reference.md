# SDK Reference

## Installation

```bash
npm install @wraith-protocol/sdk
```

---

## Agent Client

The primary interface for building with Wraith. Handles all communication with the managed TEE infrastructure.

### Initialization

```typescript
import { Wraith } from "@wraith-protocol/sdk";

const wraith = new Wraith({
  apiKey: "wraith_...",
});
```

#### Options

| Parameter | Type | Required | Description |
|---|---|---|---|
| `apiKey` | string | Yes | Your Wraith platform API key |
| `ai` | object | No | Bring your own AI model |
| `ai.provider` | string | No | `"openai"`, `"gemini"`, or `"claude"` |
| `ai.apiKey` | string | No | Your AI provider API key |

### Creating an Agent

```typescript
const agent = await wraith.createAgent({
  name: "alice",
  chain: "horizen",
  wallet: "0x...",
  signature: "0x...",
});
```

#### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Agent name (becomes `name.wraith`) |
| `chain` | string | Yes | Target chain: `"horizen"`, `"ethereum"`, `"stellar"`, `"solana"` |
| `wallet` | string | Yes | Owner wallet address |
| `signature` | string | Yes | EIP-191 signature proving wallet ownership |
| `message` | string | No | Message that was signed (for verification) |

#### Returns

```typescript
{
  id: string;          // Agent UUID
  name: string;        // "alice"
  chain: string;       // "horizen"
  address: string;     // Agent's on-chain address
  metaAddress: string; // Stealth meta-address
}
```

### Connecting to an Existing Agent

```typescript
const agent = wraith.agent(agentId);
// or
const agent = await wraith.getAgentByWallet(walletAddress);
```

### Chat

Natural language interaction with the AI agent.

```typescript
const response = await agent.chat("send 0.1 ETH to bob.wraith");
```

#### Returns

```typescript
{
  response: string;         // Agent's text reply
  toolCalls?: ToolCall[];   // Tools the agent executed
  conversationId: string;   // Conversation ID for continuity
}
```

### Balance

```typescript
const balance = await agent.getBalance();
// { eth: "1.5", tokens: { ZEN: "100.0", USDC: "50.0" } }
```

### Scan Payments

Scan for incoming stealth payments.

```typescript
const payments = await agent.scanPayments();
// [{ stealthAddress: "0x...", balance: "0.5", ephemeralPubKey: "0x..." }]
```

### Send Payment

```typescript
const result = await agent.sendPayment({
  recipient: "bob.wraith",  // or stealth meta-address
  amount: "0.1",
  asset: "ETH",             // optional, defaults to native
});
// { txHash: "0x...", txLink: "https://..." }
```

### Withdraw

```typescript
// Withdraw specific amount
const result = await agent.withdraw({
  from: "0x...",    // stealth address
  to: "0x...",      // destination
  amount: "0.05",   // optional, defaults to max
});

// Withdraw all from all stealth addresses
const results = await agent.withdrawAll({ to: "0x..." });
```

### Invoices

```typescript
// Create
const invoice = await agent.createInvoice({
  amount: "1.0",
  memo: "consulting fee",
});
// { id: "...", paymentLink: "https://...", markdownLink: "[Pay 1.0 ETH](https://...)" }

// Check status
const invoices = await agent.getInvoices();
// [{ id: "...", amount: "1.0", status: "pending" | "paid", ... }]
```

### Scheduled Payments

```typescript
// Create
await agent.schedulePayment({
  recipient: "bob.wraith",
  amount: "0.5",
  interval: "daily",    // "daily" | "weekly" | "monthly"
});

// List
const schedules = await agent.getSchedules();

// Cancel
await agent.cancelSchedule(scheduleId);
```

### Name Resolution

```typescript
const meta = await agent.resolveName("bob");
// { metaAddress: "st:eth:0x...", address: "0x..." }
```

### Privacy Check

```typescript
const report = await agent.privacyCheck();
// { score: 85, issues: [...], bestPractices: [...] }
```

### Notifications

```typescript
const notifs = await agent.getNotifications();
await agent.markNotificationsRead();
await agent.clearNotifications();
```

### Export Private Key

Requires a fresh wallet signature for verification.

```typescript
const key = await agent.exportKey({
  signature: "0x...",
  message: "Export private key for agent ...",
});
// { secret: "0x..." }
```

### Agent Status

```typescript
const status = await agent.getStatus();
// { balance: "1.5", pendingInvoices: 2, ... }
```

### Conversations

```typescript
const conversations = await agent.getConversations();
const messages = await agent.getMessages(conversationId);
await agent.deleteConversation(conversationId);
```

---

## Chain Crypto Primitives

Low-level stealth address functions for developers building custom integrations.

### EVM (`@wraith-protocol/sdk/chains/evm`)

```typescript
import {
  generateStealthAddress,
  deriveStealthKeys,
  scanAnnouncements,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  signNameRegistration,
  signNameRegistrationWithNonce,
  signNameUpdate,
  signNameRelease,
  metaAddressToBytes,
  SCHEME_ID,
} from "@wraith-protocol/sdk/chains/evm";
```

#### Generate Stealth Address

Create a one-time stealth address from a recipient's meta-address.

```typescript
const { stealthAddress, ephemeralPubKey, viewTag } = generateStealthAddress(
  spendingPubKey,
  viewingPubKey
);
```

#### Derive Stealth Keys

Derive spending and viewing keys from a wallet signature.

```typescript
const signature = await wallet.signMessage("Sign to derive stealth keys");
const { spendingKey, viewingKey, spendingPubKey, viewingPubKey } =
  deriveStealthKeys(signature);
```

#### Scan Announcements

Detect incoming stealth payments.

```typescript
const payments = scanAnnouncements(
  announcements,  // from chain events or subgraph
  viewingKey,
  spendingPubKey,
  spendingKey      // optional, needed only for spending
);
```

#### Derive Stealth Private Key

Compute the private key for a specific stealth address to spend from it.

```typescript
const privateKey = deriveStealthPrivateKey(
  spendingKey,
  ephemeralPubKey,
  viewingKey
);
```

#### Meta-Address Encoding

```typescript
const metaAddress = encodeStealthMetaAddress(spendingPubKey, viewingPubKey);
// "st:eth:0x{spend}{view}"

const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(metaAddress);
```

#### Name Signing

Sign messages for on-chain name registration and management.

```typescript
const sig = signNameRegistration(name, metaAddressBytes, spendingKey);
const sig = signNameRegistrationWithNonce(name, metaAddressBytes, spendingKey, nonce);
const sig = signNameUpdate(name, newMetaAddressBytes, spendingKey);
const sig = signNameRelease(name, spendingKey);
```

### Stellar (`@wraith-protocol/sdk/chains/stellar`)

Same conceptual API adapted to ed25519 and Stellar address formats.

```typescript
import {
  generateStealthAddress,
  deriveStealthKeys,
  scanAnnouncements,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  SCHEME_ID,
} from "@wraith-protocol/sdk/chains/stellar";
```

Key differences from EVM:
- Uses ed25519 curve instead of secp256k1
- Addresses are Stellar public keys (`G...` format)
- Meta-address format: `st:xlm:{spendPubKey}{viewPubKey}`
- Announcements come from Soroban contract events

---

## Supported Chains

| Chain | Family | Status | Native Asset |
|---|---|---|---|
| Horizen | EVM | Live | ETH |
| Ethereum | EVM | Planned | ETH |
| Polygon | EVM | Planned | MATIC |
| Base | EVM | Planned | ETH |
| Stellar | Stellar | Live | XLM |
| Solana | Solana | Planned | SOL |

Adding a new EVM chain requires only config (RPC URL + contract addresses). Adding a new chain family requires implementing the `ChainConnector` interface.

---

## Types

```typescript
interface StealthKeys {
  spendingKey: HexString;
  viewingKey: HexString;
  spendingPubKey: HexString;
  viewingPubKey: HexString;
}

interface Announcement {
  stealthAddress: string;
  ephemeralPubKey: string;
  viewTag: number;
  caller: string;
  schemeId: number;
}

interface Payment {
  stealthAddress: string;
  ephemeralPubKey: string;
  balance: string;
}

interface TxResult {
  txHash: string;
  txLink: string;
}

type HexString = `0x${string}`;
```
