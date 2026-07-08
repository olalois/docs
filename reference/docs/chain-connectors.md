# Chain Connectors

Chain connectors are the abstraction layer between Wraith's chain-agnostic agent core and blockchain-specific logic. Each connector implements a standard interface, allowing the same agent engine to operate across any supported chain.

---

## Interface

Every chain connector implements `ChainConnector`:

```tsx
interface ChainConnector {
  /** Chain identifier */
  readonly chain: string;

  /** Derive agent keys from a raw seed */
  deriveKeys(seed: Uint8Array): {
    address: string;
    stealthKeys: StealthKeys;
    metaAddress: string;
  };

  /** Send a stealth payment */
  sendPayment(
    senderKeys: StealthKeys,
    senderAddress: string,
    recipientMetaAddress: string,
    amount: string,
    asset?: string,
  ): Promise<TxResult>;

  /** Scan for incoming stealth payments */
  scanPayments(stealthKeys: StealthKeys): Promise<Payment[]>;

  /** Get balance for an address */
  getBalance(address: string): Promise<Balance>;

  /** Withdraw from a stealth address */
  withdraw(
    stealthKeys: StealthKeys,
    from: string,
    to: string,
    amount?: string,
  ): Promise<TxResult>;

  /** Register a .wraith name on-chain */
  registerName(
    name: string,
    stealthKeys: StealthKeys,
  ): Promise<TxResult>;

  /** Resolve a .wraith name to meta-address */
  resolveName(name: string): Promise<string | null>;

  /** Fund a wallet (faucet for testnet, or other mechanism) */
  fundWallet(address: string): Promise<TxResult>;
}
```

---

## EVM Connector

Handles all EVM-compatible chains. A single implementation covers Horizen, Ethereum, Polygon, Base, and any other EVM chain.

### Configuration

```typescript
const connector = new EVMConnector({
  chainId: 2651420,
  rpcUrl: "https://horizen-testnet.rpc.caldera.xyz/http",
  explorerUrl: "https://horizen-testnet.explorer.caldera.xyz",
  contracts: {
    announcer: "0x8AE65c05E7eb48B9bA652781Bc0a3DBA09A484F3",
    registry: "0x953E6cEdcdfAe321796e7637d33653F6Ce05c527",
    sender: "0x226C5eb4e139D9fa01cc09eA318638b090b12095",
    names: "0x3d46f709a99A3910f52bD292211Eb5D557F882D6",
  },
  subgraphUrl: "https://api.goldsky.com/api/public/...",
  tokens: {
    ETH: { address: "native", decimals: 18 },
    ZEN: { address: "0x4b36cb6E7c257E9aA246122a997be0F7Dc1eFCd1", decimals: 18 },
    USDC: { address: "0x01c7AEb2A0428b4159c0E333712f40e127aF639E", decimals: 6 },
  },
  faucetUrl: "https://horizen-testnet.hub.caldera.xyz/api/trpc/faucet.requestFaucetFunds",
});
```

### Adding a New EVM Chain

No code changes required. Register a new chain with its config:

```typescript
chainRegistry.register("ethereum", new EVMConnector({
  chainId: 1,
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/...",
  explorerUrl: "https://etherscan.io",
  contracts: {
    announcer: "0x...",
    registry: "0x...",
    sender: "0x...",
    names: "0x...",
  },
}));

chainRegistry.register("polygon", new EVMConnector({
  chainId: 137,
  rpcUrl: "https://polygon-rpc.com",
  explorerUrl: "https://polygonscan.com",
  contracts: { ... },
}));
```

### Cryptography

- Curve: secp256k1
- Standards: ERC-5564 (Stealth Address Messenger), ERC-6538 (Stealth Meta-Address Registry)
- Meta-address format: `st:eth:0x{spendPubKey}{viewPubKey}`
- Key derivation: ECDH shared secret → stealth address
- Announcements: On-chain events indexed via subgraph

### Contracts

| Contract | Purpose |
|---|---|
| WraithAnnouncer | Emits `Announcement` events with ephemeral key and view tag |
| WraithRegistry | Maps addresses to stealth meta-addresses (ERC-6538) |
| WraithSender | Atomic send + announce in one transaction |
| WraithNames | Privacy-preserving `.wraith` name → meta-address mapping |

---

## Stellar Connector

Handles the Stellar network using ed25519 cryptography and Soroban smart contracts.

### Configuration

```typescript
const connector = new StellarConnector({
  networkPassphrase: Networks.TESTNET,
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanUrl: "https://soroban-testnet.stellar.org",
  contracts: {
    announcer: "CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL",
    names: "CC...",
  },
});
```

### Cryptography

- Curve: ed25519
- Key derivation: ECDH via x25519 conversion of ed25519 keys
- Meta-address format: `st:xlm:{spendPubKey}{viewPubKey}`
- Addresses: Stellar public keys (`G...` format)
- Announcements: Soroban contract events

### Key Differences from EVM

| Aspect | EVM | Stellar |
|---|---|---|
| Curve | secp256k1 | ed25519 |
| Address format | `0x...` (20 bytes) | `G...` (56 chars) |
| Meta-address prefix | `st:eth:0x` | `st:xlm:` |
| Contracts | Solidity | Soroban (Rust) |
| Announcements | EVM events / subgraph | Soroban events / Horizon |
| Native asset | ETH | XLM |
| Account model | Balance-based | Account must exist first |

---

## Solana Connector

Handles Solana using ed25519 and Solana programs.

### Configuration

```typescript
const connector = new SolanaConnector({
  rpcUrl: "https://api.devnet.solana.com",
  programs: {
    announcer: "Wraith...",
  },
});
```

### Cryptography

- Curve: ed25519 (same as Stellar)
- Meta-address format: `st:sol:{spendPubKey}{viewPubKey}`
- Addresses: Base58-encoded public keys
- Announcements: Program log events

---

## Chain Registry

The TEE server maintains a registry of available chain connectors:

```typescript
class ChainRegistry {
  private connectors = new Map<string, ChainConnector>();

  register(chain: string, connector: ChainConnector): void {
    this.connectors.set(chain, connector);
  }

  get(chain: string): ChainConnector {
    const connector = this.connectors.get(chain);
    if (!connector) throw new Error(`Chain "${chain}" is not supported`);
    return connector;
  }

  supportedChains(): string[] {
    return Array.from(this.connectors.keys());
  }
}
```

### Usage in Agent Service

The agent service resolves the connector for each agent based on their chain:

```typescript
async sendPayment(agentId: string, recipient: string, amount: string) {
  const agent = await this.db.agents.findOneBy({ id: agentId });
  const connector = this.chainRegistry.get(agent.chain);
  const stealthKeys = await this.tee.deriveAgentStealthKeys(agentId, agent.chain);
  return connector.sendPayment(stealthKeys, agent.address, recipient, amount);
}
```

---

## Building a New Connector

To add support for a new chain family:

1. Create a class implementing `ChainConnector`
2. Implement all methods using the chain's SDK and cryptographic primitives
3. Register it in the chain registry
4. Deploy the stealth address contracts on the target chain
5. Add the chain to the supported chains list

The agent core, AI engine, storage, notifications, and scheduling work automatically with no changes.
