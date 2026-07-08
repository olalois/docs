# 06 — Agent Client SDK

The root export of `@wraith-protocol/sdk` — a lightweight HTTP client that communicates with the Wraith managed TEE platform.

## Design

This is not a framework. It's an API client, similar to `@privy-io/react-auth` or `firebase/app`. Developers install it, configure with their API key, and call methods. All heavy logic runs server-side on Wraith's TEE infrastructure.

## Dependencies

Zero heavy dependencies. Only:
- Native `fetch` for HTTP calls
- TypeScript types

No AI libraries, no database drivers, no crypto libraries, no native modules.

## Implementation

### `src/agent/types.ts`

```ts
export enum Chain {
  Horizen = "horizen",
  Ethereum = "ethereum",
  Polygon = "polygon",
  Base = "base",
  Stellar = "stellar",
  Solana = "solana",
  All = "all",
}

export interface WraithConfig {
  apiKey: string;
  baseUrl?: string;
  ai?: {
    provider: "gemini" | "openai" | "claude";
    apiKey: string;
  };
}

export interface AgentConfig {
  name: string;
  chain: Chain | Chain[];    // single chain or multichain
  wallet: string;
  signature: string;
  message?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  chains: Chain[];           // always an array — single or multi
  addresses: Record<Chain, string>;       // address per chain
  metaAddresses: Record<Chain, string>;   // meta-address per chain
}

export interface ChatResponse {
  response: string;
  toolCalls?: ToolCall[];
  conversationId: string;
}

export interface ToolCall {
  name: string;
  status: string;
  detail?: string;
}

export interface Balance {
  native: string;
  tokens: Record<string, string>;
}

export interface Payment {
  stealthAddress: string;
  balance: string;
  ephemeralPubKey: string;
}

export interface Invoice {
  id: string;
  agentName: string;
  amount: string;
  asset: string;
  memo: string;
  status: "pending" | "paid";
  txHash: string | null;
  paymentLink: string;
  createdAt: string;
}

export interface Schedule {
  id: string;
  recipient: string;
  amount: string;
  asset: string;
  interval: "daily" | "weekly" | "monthly";
  status: "active" | "paused" | "cancelled";
  nextRun: string;
}

export interface TxResult {
  txHash: string;
  txLink: string;
}

export interface PrivacyReport {
  score: number;
  issues: Array<{
    severity: "info" | "low" | "medium" | "high" | "critical";
    issue: string;
    recommendation: string;
  }>;
  bestPractices: string[];
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
```

### `src/agent/client.ts`

```ts
import type {
  WraithConfig,
  AgentConfig,
  AgentInfo,
  ChatResponse,
  Balance,
  Payment,
  Invoice,
  Schedule,
  TxResult,
  PrivacyReport,
  Notification,
  Conversation,
} from "./types";

const DEFAULT_BASE_URL = "https://api.wraith.dev";

export class Wraith {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly aiConfig?: { provider: string; apiKey: string };

  constructor(config: WraithConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.aiConfig = config.ai;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        ...(this.aiConfig ? { "X-AI-Provider": this.aiConfig.provider, "X-AI-Key": this.aiConfig.apiKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(error.message || `HTTP ${res.status}`);
    }

    return res.json();
  }

  async createAgent(config: AgentConfig): Promise<WraithAgent> {
    const info = await this.request<AgentInfo>("POST", "/agent/create", config);
    return new WraithAgent(this, info);
  }

  agent(agentId: string): WraithAgent {
    return new WraithAgent(this, { id: agentId, name: "", chain: "", address: "", metaAddress: "" });
  }

  async getAgentByWallet(walletAddress: string): Promise<WraithAgent> {
    const info = await this.request<AgentInfo>("GET", `/agent/wallet/${walletAddress}`);
    return new WraithAgent(this, info);
  }

  async getAgentByName(name: string): Promise<WraithAgent> {
    const info = await this.request<AgentInfo>("GET", `/agent/info/${name}`);
    return new WraithAgent(this, info);
  }

  async listAgents(): Promise<AgentInfo[]> {
    return this.request<AgentInfo[]>("GET", "/agents");
  }

  // Expose request for WraithAgent to use
  _request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.request<T>(method, path, body);
  }
}

export class WraithAgent {
  readonly info: AgentInfo;
  private readonly wraith: Wraith;

  constructor(wraith: Wraith, info: AgentInfo) {
    this.wraith = wraith;
    this.info = info;
  }

  private req<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.wraith._request<T>(method, `/agent/${this.info.id}${path}`, body);
  }

  async chat(message: string, conversationId?: string): Promise<ChatResponse> {
    return this.req<ChatResponse>("POST", "/chat", { message, conversationId });
  }

  async getStatus(): Promise<any> {
    return this.req("GET", "/status");
  }

  async getBalance(): Promise<Balance> {
    const status = await this.getStatus();
    return { native: status.balance || "0", tokens: status.tokens || {} };
  }

  async scanPayments(): Promise<Payment[]> {
    const res = await this.chat("Scan for incoming stealth payments");
    // Tool results embedded in chat response
    return (res.toolCalls || [])
      .filter(tc => tc.name === "scan_payments")
      .flatMap(tc => {
        try { return JSON.parse(tc.detail || "[]"); } catch { return []; }
      });
  }

  async exportKey(signature: string, message: string): Promise<{ secret: string }> {
    return this.req<{ secret: string }>("POST", "/export", { signature, message });
  }

  // Conversations
  async getConversations(): Promise<Conversation[]> {
    return this.req<Conversation[]>("GET", "/conversations");
  }

  async getMessages(conversationId: string): Promise<Array<{ role: string; text: string }>> {
    return this.req("GET", `/conversations/${conversationId}/messages`);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.req("DELETE", `/conversations/${conversationId}`);
  }

  // Notifications
  async getNotifications(): Promise<{ notifications: Notification[]; unreadCount: number }> {
    return this.req("GET", "/notifications");
  }

  async markNotificationsRead(): Promise<void> {
    await this.req("POST", "/notifications/read", {});
  }

  async clearNotifications(): Promise<void> {
    await this.req("DELETE", "/notifications");
  }
}
```

### `src/index.ts`

```ts
export { Wraith, WraithAgent } from "./agent/client";
export { Chain } from "./agent/types";
export type {
  WraithConfig,
  AgentConfig,
  AgentInfo,
  ChatResponse,
  ToolCall,
  Balance,
  Payment,
  Invoice,
  Schedule,
  TxResult,
  PrivacyReport,
  Notification,
  Conversation,
} from "./agent/types";
```

## Usage Examples

### Basic Setup

```ts
import { Wraith, Chain } from "@wraith-protocol/sdk";

const wraith = new Wraith({
  apiKey: "wraith_live_abc123",
});
```

### With Custom AI

```ts
const wraith = new Wraith({
  apiKey: "wraith_live_abc123",
  ai: {
    provider: "openai",
    apiKey: "sk-...",
  },
});
```

### Single-Chain Agent

```ts
const agent = await wraith.createAgent({
  name: "alice",
  chain: Chain.Horizen,
  wallet: "0x...",
  signature: "0x...",
});

console.log(agent.info.chains);                    // [Chain.Horizen]
console.log(agent.info.addresses[Chain.Horizen]);  // "0x..."
console.log(agent.info.metaAddresses[Chain.Horizen]); // "st:eth:0x..."
```

### Multichain Agent

A single agent with identities on multiple chains. One name, multiple addresses.

```ts
const agent = await wraith.createAgent({
  name: "alice",
  chain: [Chain.Horizen, Chain.Stellar, Chain.Ethereum],
  wallet: "0x...",
  signature: "0x...",
});

console.log(agent.info.chains);
// [Chain.Horizen, Chain.Stellar, Chain.Ethereum]

console.log(agent.info.addresses);
// { horizen: "0x...", stellar: "G...", ethereum: "0x..." }

console.log(agent.info.metaAddresses);
// { horizen: "st:eth:0x...", stellar: "st:xlm:...", ethereum: "st:eth:0x..." }
```

### All Chains Agent

Deploy on every supported chain at once:

```ts
const agent = await wraith.createAgent({
  name: "alice",
  chain: Chain.All,
  wallet: "0x...",
  signature: "0x...",
});
// Agent gets identities on every chain the platform currently supports
```

### Multichain Chat

The AI agent is chain-aware. Chat naturally and it routes to the right chain:

```ts
await agent.chat("send 0.1 ETH to bob.wraith on horizen");
await agent.chat("send 10 XLM to carol.wraith on stellar");
await agent.chat("what's my balance on all chains?");
```

### Chat

```ts
const res = await agent.chat("send 0.1 ETH to bob.wraith");
console.log(res.response);    // Agent's natural language reply
console.log(res.toolCalls);   // [{ name: "send_payment", status: "success", detail: "..." }]
```

### Export Key

```ts
// Requires fresh wallet signature
const signature = await wallet.signMessage("Export private key for agent " + agent.info.id);
const { secret } = await agent.exportKey(signature, "Export private key for agent " + agent.info.id);
```

### Notifications

```ts
const { notifications, unreadCount } = await agent.getNotifications();
if (unreadCount > 0) {
  await agent.markNotificationsRead();
}
```

## Error Handling

All methods throw on failure. Errors have a `.message` from the server:

```ts
try {
  await agent.chat("send 100 ETH to bob.wraith");
} catch (err) {
  console.error(err.message); // "Insufficient balance"
}
```

## Authentication

Every request includes:
- `Authorization: Bearer wraith_...` — platform API key
- `X-AI-Provider` + `X-AI-Key` — optional, for BYOM (bring your own model)

The TEE server validates the API key and routes to the correct AI provider.
