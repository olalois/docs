# 04 — Chain Connector Interface

The chain connector is the abstraction between the chain-agnostic agent core and blockchain-specific operations. Each supported chain family implements this interface.

## Interface Definition

```ts
interface ChainConnector {
  readonly chain: string;
  readonly nativeAsset: string;
  readonly addressFormat: "evm" | "stellar" | "solana";

  deriveKeys(seed: Uint8Array): Promise<DerivedKeys>;

  sendPayment(params: SendPaymentParams): Promise<TxResult>;
  scanPayments(stealthKeys: ChainStealthKeys): Promise<DetectedPayment[]>;
  getBalance(address: string): Promise<ChainBalance>;
  withdraw(params: WithdrawParams): Promise<TxResult>;
  withdrawAll(params: WithdrawAllParams): Promise<WithdrawAllResult>;

  registerName(name: string, stealthKeys: ChainStealthKeys): Promise<TxResult>;
  resolveName(name: string): Promise<ResolvedName | null>;

  fundWallet(address: string): Promise<TxResult>;

  getExplorerUrl(type: "tx" | "address", value: string): string;
}
```

## Supporting Types

```ts
interface DerivedKeys {
  address: string;
  stealthKeys: ChainStealthKeys;
  metaAddress: string;
}

interface ChainStealthKeys {
  // Opaque to the core — each chain stores what it needs
  [key: string]: unknown;
}

interface SendPaymentParams {
  senderAddress: string;
  senderStealthKeys: ChainStealthKeys;
  recipientMetaAddress: string;
  amount: string;
  asset?: string;
}

interface WithdrawParams {
  stealthKeys: ChainStealthKeys;
  from: string;
  to: string;
  amount?: string; // undefined = withdraw max
}

interface WithdrawAllParams {
  stealthKeys: ChainStealthKeys;
  to: string;
}

interface DetectedPayment {
  stealthAddress: string;
  balance: string;
  ephemeralPubKey: string;
}

interface ChainBalance {
  native: string;
  tokens: Record<string, string>;
}

interface ResolvedName {
  name: string;
  metaAddress: string;
  address?: string;
}

interface TxResult {
  txHash: string;
  txLink: string;
}

interface WithdrawAllResult {
  results: Array<{ address: string } & (TxResult | { error: string })>;
  count: number;
  totalWithdrawn: string;
}
```

## EVM Connector Implementation

One connector covers all EVM chains. Different chains just use different config.

### Constructor

```ts
interface EVMConnectorConfig {
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  contracts: {
    announcer: `0x${string}`;
    registry: `0x${string}`;
    sender: `0x${string}`;
    names: `0x${string}`;
  };
  subgraphUrl?: string;
  faucetUrl?: string;
  faucetSubdomain?: string;
  tokens?: Record<string, { address: string; decimals: number }>;
}
```

### Key Operations Mapped

| Interface Method | EVM Implementation |
|---|---|
| `deriveKeys(seed)` | SHA-256 seed → `privateKeyToAccount` → `signMessage(STEALTH_SIGNING_MESSAGE)` → `deriveStealthKeys(sig)` → `encodeStealthMetaAddress(spend, view)` |
| `sendPayment` | `decodeStealthMetaAddress` → `generateStealthAddress` → `writeContract(WraithSender, "sendETH", ...)` |
| `scanPayments` | Query subgraph for Announcement events → `scanAnnouncements(events, viewKey, spendPub, spendKey)` → fetch balances |
| `getBalance` | `publicClient.getBalance(address)` + `readContract(erc20, balanceOf)` per token |
| `withdraw` | `deriveStealthPrivateKey` → `privateKeyToAccount(stealthKey)` → `sendTransaction({ to, value: balance - gasCost })` |
| `registerName` | `signNameRegistration(name, metaBytes, spendingKey)` → `writeContract(WraithNames, "register", ...)` |
| `resolveName` | `readContract(WraithNames, "resolve", [name])` → decode meta-address |
| `fundWallet` | POST to Caldera faucet API (testnet) or transfer from deployer (mainnet) |
| `getExplorerUrl` | `${explorerUrl}/tx/${hash}` or `${explorerUrl}/address/${addr}` |

### Adding a New EVM Chain

Just register with different config — same connector class:

```ts
// Horizen Testnet
registry.register("horizen", new EVMConnector({
  chainId: 2651420,
  rpcUrl: "https://horizen-testnet.rpc.caldera.xyz/http",
  explorerUrl: "https://horizen-testnet.explorer.caldera.xyz",
  contracts: {
    announcer: "0x8AE65c05E7eb48B9bA652781Bc0a3DBA09A484F3",
    registry: "0x953E6cEdcdfAe321796e7637d33653F6Ce05c527",
    sender: "0x226C5eb4e139D9fa01cc09eA318638b090b12095",
    names: "0x3d46f709a99A3910f52bD292211Eb5D557F882D6",
  },
  subgraphUrl: "https://api.goldsky.com/api/public/project_.../subgraphs/.../gn",
  faucetUrl: "https://horizen-testnet.hub.caldera.xyz/api/trpc/faucet.requestFaucetFunds",
  faucetSubdomain: "horizen-testnet",
  tokens: {
    ETH: { address: "native", decimals: 18 },
    ZEN: { address: "0x4b36cb6E...", decimals: 18 },
    USDC: { address: "0x01c7AEb2...", decimals: 6 },
  },
}));

// Ethereum Mainnet — same connector, different config
registry.register("ethereum", new EVMConnector({
  chainId: 1,
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/...",
  explorerUrl: "https://etherscan.io",
  contracts: { ... }, // deploy same contracts
}));
```

**Requirements for each new EVM chain:**
1. Deploy the 4 Solidity contracts (Announcer, Registry, Sender, Names)
2. Set up a subgraph (Goldsky, The Graph, or custom indexer) for Announcement events
3. Add config to the registry

## Stellar Connector Implementation

### Key Operations Mapped

| Interface Method | Stellar Implementation |
|---|---|
| `deriveKeys(seed)` | SHA-256 seed → use as ed25519 seed → sign `STEALTH_SIGNING_MESSAGE` → `deriveStealthKeys(sig)` → `encodeStealthMetaAddress(spend, view)` |
| `sendPayment` | `decodeStealthMetaAddress` → `generateStealthAddress` → build `createAccount` tx → sign → submit to Horizon → call Soroban announcer |
| `scanPayments` | Fetch events from Soroban RPC → `scanAnnouncements(events, viewKey, spendPub, spendScalar)` → fetch balances from Horizon |
| `getBalance` | `GET /accounts/{key}` from Horizon → parse native + asset balances |
| `withdraw` | `deriveStealthPrivateScalar` → build payment tx → `signStellarTransaction(txHash, scalar, pubKey)` → submit |
| `registerName` | Call Soroban WraithNames contract `register(name, metaAddress)` |
| `resolveName` | Simulate Soroban WraithNames `resolve(name)` |
| `fundWallet` | Stellar Friendbot `GET /friendbot?addr={key}` |
| `getExplorerUrl` | `https://stellar.expert/explorer/testnet/tx/${hash}` |

### Stellar-Specific Considerations

- **Account creation:** Stellar requires accounts to exist with a minimum balance (1 XLM). Sending to a new stealth address uses `Operation.createAccount`, not `Operation.payment`.
- **Signing:** Stealth private keys are derived scalars that can't be used with `Keypair.fromRawEd25519Seed()`. Must use `signWithScalar()` + `signStellarTransaction()` from the SDK.
- **Events:** Soroban contract events are fetched via `sorobanServer.getEvents()`, not subgraph.

## Chain Registry

```ts
class ChainRegistry {
  private connectors = new Map<string, ChainConnector>();

  register(chain: string, connector: ChainConnector): void {
    this.connectors.set(chain, connector);
  }

  get(chain: string): ChainConnector {
    const c = this.connectors.get(chain);
    if (!c) throw new Error(`Unsupported chain: "${chain}". Available: ${this.supportedChains().join(", ")}`);
    return c;
  }

  supportedChains(): string[] {
    return Array.from(this.connectors.keys());
  }
}
```

## Adding a Completely New Chain Family

1. Create a new file implementing `ChainConnector` (e.g., `SolanaConnector`)
2. Implement all interface methods using the chain's SDK
3. Write the stealth crypto module at `@wraith-protocol/sdk/chains/solana`
4. Deploy stealth address programs/contracts on the chain
5. Register the connector in the chain registry
6. The agent core, AI, storage, and all tools work automatically
