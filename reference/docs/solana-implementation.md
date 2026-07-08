# Solana Stealth Address Implementation

Full implementation spec for adding Solana support across the Wraith Protocol stack: SDK crypto module, Solana programs, Spectre chain connector, and documentation.

## Overview

Solana uses ed25519, the same curve as Stellar. The crypto is nearly identical. Key differences from Stellar:

- Addresses are base58-encoded 32-byte ed25519 public keys (not Stellar's `G...` StrKey)
- Accounts don't need deployment. An ed25519 public key IS a valid address. Send SOL directly to it.
- Minimum balance: ~0.00089 SOL for rent exemption
- Programs (smart contracts) are written in Rust with Anchor framework
- Events are emitted via program logs, not contract events
- Transactions use a different structure but signing is standard ed25519
- SPL tokens use associated token accounts (ATAs), not direct transfers

## Cryptographic Primitives

### Curve

ed25519 (same as Stellar). Group order L = 2^252 + 27742317777372353535851937790883648493.

### Dependencies

- `@noble/curves` (ed25519, x25519, edwardsToMontgomeryPub/Priv) — already a direct dependency
- `@noble/hashes` (sha256, sha512) — already a direct dependency
- `@solana/web3.js` — optional peer dependency for address encoding and transaction building

### Constants

```typescript
STEALTH_SIGNING_MESSAGE = "Sign this message to generate your Wraith stealth keys.\n\nChain: Solana\nNote: This signature is used for key derivation only and does not authorize any transaction."
SCHEME_ID = 1
META_ADDRESS_PREFIX = "st:sol:"
```

### Types

```typescript
interface StealthKeys {
  spendingKey: Uint8Array;       // 32-byte seed
  spendingScalar: bigint;        // clamped scalar from SHA-512(seed)
  viewingKey: Uint8Array;        // 32-byte seed
  viewingScalar: bigint;         // clamped scalar
  spendingPubKey: Uint8Array;    // 32-byte ed25519 public key
  viewingPubKey: Uint8Array;     // 32-byte ed25519 public key
}

interface GeneratedStealthAddress {
  stealthAddress: string;        // base58-encoded Solana address
  ephemeralPubKey: Uint8Array;   // 32-byte ed25519 public key
  viewTag: number;               // 0-255
}

interface Announcement {
  schemeId: number;
  stealthAddress: string;        // base58 Solana address
  caller: string;                // base58 Solana address
  ephemeralPubKey: string;       // hex-encoded 32 bytes
  metadata: string;              // hex-encoded, first byte = view tag
}

interface MatchedAnnouncement extends Announcement {
  stealthPrivateScalar: bigint;
  stealthPubKeyBytes: Uint8Array;
}
```

### Algorithms

All algorithms are IDENTICAL to the Stellar module (`@wraith-protocol/sdk/chains/stellar`) with these differences:

1. **Key derivation (`deriveStealthKeys`)**: Same. Sign message with Solana wallet (ed25519 sig, 64 bytes), domain-separated SHA-256 hash to get spending/viewing seeds, seedToScalar for clamped scalars.

2. **Stealth address generation (`generateStealthAddress`)**: Same ECDH + point addition. Only difference is `pubKeyToSolanaAddress()` instead of `pubKeyToStellarAddress()`.

3. **Address encoding (`pubKeyToSolanaAddress`)**: Use base58 encoding of the raw 32-byte ed25519 public key. Use `@solana/web3.js`'s `PublicKey` class or implement base58 encoding directly with `bs58`.

4. **Shared secret (`computeSharedSecret`)**: Identical. X25519 ECDH via `edwardsToMontgomeryPriv/Pub`.

5. **View tag (`computeViewTag`)**: Identical. `SHA-256("wraith:tag:" || sharedSecret)[0]`.

6. **Hash to scalar (`hashToScalar`)**: Identical. `SHA-256("wraith:scalar:" || sharedSecret) mod L`.

7. **Scanning (`checkStealthAddress`, `scanAnnouncements`)**: Identical logic. Compare base58 addresses instead of Stellar G... addresses.

8. **Stealth private scalar (`deriveStealthPrivateScalar`)**: Identical. `(spendingScalar + hashScalar) mod L`.

9. **Signing (`signSolanaTransaction`)**: Same `signWithScalar()` from scalar module. Solana transactions are signed with ed25519 just like Stellar.

10. **Meta-address encoding/decoding**: Same format, different prefix. `st:sol:{spendPubHex}{viewPubHex}` — 128 hex chars after prefix (two 32-byte keys).

### What to reuse from Stellar module

Copy and adapt these files from `src/chains/stellar/`:
- `scalar.ts` — reuse entirely (seedToScalar, hashToScalar, signWithScalar, L, etc.)
- `utils.ts` — reuse entirely (bytesToHex, hexToBytes)
- `stealth.ts` — copy, replace `pubKeyToStellarAddress` with `pubKeyToSolanaAddress`
- `scan.ts` — copy, address comparison uses base58 strings
- `spend.ts` — copy, identical
- `keys.ts` — copy, identical (same domain-separated hashing)
- `meta-address.ts` — copy, change prefix to `st:sol:`

New files:
- `constants.ts` — Solana-specific signing message and prefix
- `types.ts` — same structure as Stellar types
- `deployments.ts` — Solana devnet/mainnet program IDs and RPC URLs
- `announcements.ts` — fetch from Solana RPC (program logs)

### Address Encoding

```typescript
import { PublicKey } from "@solana/web3.js";

function pubKeyToSolanaAddress(pubKeyBytes: Uint8Array): string {
  return new PublicKey(pubKeyBytes).toBase58();
}
```

If avoiding the `@solana/web3.js` dependency for this one function, use `bs58` directly:

```typescript
import bs58 from "bs58";

function pubKeyToSolanaAddress(pubKeyBytes: Uint8Array): string {
  return bs58.encode(pubKeyBytes);
}
```

### Announcement Fetching

Solana doesn't have subgraphs. Announcements are fetched by querying the announcer program's transaction history:

```typescript
async function fetchAnnouncements(chain: string = "solana"): Promise<Announcement[]> {
  const deployment = getDeployment(chain);
  const connection = new Connection(deployment.rpcUrl);
  const programId = new PublicKey(deployment.contracts.announcer);
  
  // Get all signatures for the program
  const signatures = await connection.getSignaturesForAddress(programId, { limit: 1000 });
  
  // Fetch each transaction and parse the announcement from program logs/data
  const announcements: Announcement[] = [];
  for (const sig of signatures) {
    const tx = await connection.getTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx) continue;
    const parsed = parseAnnouncementFromTransaction(tx);
    if (parsed) announcements.push(parsed);
  }
  
  return announcements;
}
```

The exact parsing depends on how the Anchor program emits events. Anchor programs emit events via `emit!()` macro which writes structured data to transaction logs. Parse using Anchor's event CPI format.

### SDK Entry Point

Add to `package.json` exports:
```json
"./chains/solana": {
  "types": "./dist/chains/solana/index.d.ts",
  "import": "./dist/chains/solana/index.js",
  "require": "./dist/chains/solana/index.cjs"
}
```

Add to `tsup.config.ts` entry:
```typescript
"chains/solana/index": "src/chains/solana/index.ts"
```

Add `@solana/web3.js` as optional peer dependency:
```json
"peerDependencies": {
  "@stellar/stellar-sdk": "^13.1.0",
  "@solana/web3.js": "^1.95.0"
},
"peerDependenciesMeta": {
  "@stellar/stellar-sdk": { "optional": true },
  "@solana/web3.js": { "optional": true }
}
```

### Exports

```typescript
// src/chains/solana/index.ts
export { deriveStealthKeys } from "./keys";
export { STEALTH_SIGNING_MESSAGE, SCHEME_ID, META_ADDRESS_PREFIX } from "./constants";
export { encodeStealthMetaAddress, decodeStealthMetaAddress } from "./meta-address";
export { generateStealthAddress, computeSharedSecret, computeViewTag } from "./stealth";
export { checkStealthAddress, scanAnnouncements } from "./scan";
export { deriveStealthPrivateScalar, signSolanaTransaction } from "./spend";
export { seedToScalar, hashToScalar, deriveStealthPubKey, pubKeyToSolanaAddress, signWithScalar, L } from "./scalar";
export { bytesToHex, hexToBytes } from "./utils";
export { fetchAnnouncements } from "./announcements";
export { DEPLOYMENTS, getDeployment } from "./deployments";
export type { SolanaChainDeployment } from "./deployments";
export type { HexString, StealthKeys, StealthMetaAddress, GeneratedStealthAddress, Announcement, MatchedAnnouncement } from "./types";
```

### Tests

Same test structure as Stellar, adapted for Solana addresses:

- `keys.test.ts` — valid derivation, determinism, spending != viewing, wrong length rejection
- `stealth.test.ts` — valid generation, deterministic with fixed seed, different recipients produce different addresses, address is valid base58
- `scan.test.ts` — matches own, rejects wrong view tag, rejects wrong key, skips wrong scheme
- `spend.test.ts` — derived scalar's public key matches stealth pub key
- `meta-address.test.ts` — encode/decode roundtrip, reject bad prefix/length
- `e2e.test.ts` — full flow: derive keys, generate stealth, scan, derive scalar, verify

---

## Solana Programs (Contracts)

Written in Rust with the Anchor framework. Three programs:

### 1. Wraith Announcer Program

Emits stealth address announcement events. No state storage (stateless, like EVM announcer).

```rust
use anchor_lang::prelude::*;

declare_id!("...");

#[program]
pub mod wraith_announcer {
    use super::*;

    pub fn announce(
        ctx: Context<Announce>,
        scheme_id: u32,
        stealth_address: Pubkey,
        ephemeral_pub_key: [u8; 32],
        metadata: Vec<u8>,
    ) -> Result<()> {
        emit!(AnnouncementEvent {
            scheme_id,
            stealth_address,
            caller: ctx.accounts.caller.key(),
            ephemeral_pub_key,
            metadata,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Announce<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
}

#[event]
pub struct AnnouncementEvent {
    pub scheme_id: u32,
    pub stealth_address: Pubkey,
    pub caller: Pubkey,
    pub ephemeral_pub_key: [u8; 32],
    pub metadata: Vec<u8>,
}
```

### 2. Wraith Sender Program

Atomic SOL transfer + announcement in one instruction. Takes SOL from the sender, transfers to the stealth address, and calls the announcer program via CPI.

```rust
use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("...");

#[program]
pub mod wraith_sender {
    use super::*;

    pub fn send_sol(
        ctx: Context<SendSol>,
        amount: u64,
        scheme_id: u32,
        stealth_address: Pubkey,
        ephemeral_pub_key: [u8; 32],
        metadata: Vec<u8>,
    ) -> Result<()> {
        // Transfer SOL to stealth address
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.sender.to_account_info(),
                    to: ctx.accounts.stealth_account.to_account_info(),
                },
            ),
            amount,
        )?;

        // Emit announcement via CPI to announcer program
        // (or emit directly if we want to keep it simpler)
        emit!(AnnouncementEvent {
            scheme_id,
            stealth_address,
            caller: ctx.accounts.sender.key(),
            ephemeral_pub_key,
            metadata,
        });

        Ok(())
    }

    pub fn send_spl(
        ctx: Context<SendSpl>,
        amount: u64,
        scheme_id: u32,
        stealth_address: Pubkey,
        ephemeral_pub_key: [u8; 32],
        metadata: Vec<u8>,
    ) -> Result<()> {
        // Transfer SPL token to stealth address's ATA
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.sender_token_account.to_account_info(),
                    to: ctx.accounts.stealth_token_account.to_account_info(),
                    authority: ctx.accounts.sender.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(AnnouncementEvent {
            scheme_id,
            stealth_address,
            caller: ctx.accounts.sender.key(),
            ephemeral_pub_key,
            metadata,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct SendSol<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    /// CHECK: stealth address, receives SOL
    #[account(mut)]
    pub stealth_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SendSpl<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    #[account(mut)]
    pub sender_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    #[account(mut)]
    pub stealth_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
}

#[event]
pub struct AnnouncementEvent {
    pub scheme_id: u32,
    pub stealth_address: Pubkey,
    pub caller: Pubkey,
    pub ephemeral_pub_key: [u8; 32],
    pub metadata: Vec<u8>,
}
```

### 3. Wraith Names Program

PDA-based name to meta-address mapping. Similar to the Stellar/EVM names contracts.

```rust
use anchor_lang::prelude::*;

declare_id!("...");

const MAX_NAME_LEN: usize = 32;
const META_ADDRESS_LEN: usize = 64; // two 32-byte ed25519 public keys

#[program]
pub mod wraith_names {
    use super::*;

    pub fn register(
        ctx: Context<Register>,
        name: String,
        meta_address: [u8; 64],
    ) -> Result<()> {
        require!(name.len() >= 3 && name.len() <= MAX_NAME_LEN, WraithError::InvalidNameLength);
        require!(
            name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
            WraithError::InvalidNameCharacter
        );

        let record = &mut ctx.accounts.name_record;
        record.name = name;
        record.meta_address = meta_address;
        record.owner = ctx.accounts.owner.key();
        record.created_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn update(
        ctx: Context<Update>,
        new_meta_address: [u8; 64],
    ) -> Result<()> {
        require!(
            ctx.accounts.name_record.owner == ctx.accounts.owner.key(),
            WraithError::NotOwner
        );
        ctx.accounts.name_record.meta_address = new_meta_address;
        Ok(())
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        require!(
            ctx.accounts.name_record.owner == ctx.accounts.owner.key(),
            WraithError::NotOwner
        );
        // Close the account, return rent to owner
        Ok(())
    }

    pub fn resolve(ctx: Context<Resolve>) -> Result<[u8; 64]> {
        Ok(ctx.accounts.name_record.meta_address)
    }
}

#[account]
pub struct NameRecord {
    pub name: String,               // max 32 bytes
    pub meta_address: [u8; 64],     // spending pub + viewing pub
    pub owner: Pubkey,
    pub created_at: i64,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct Register<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 4 + MAX_NAME_LEN + 64 + 32 + 8,
        seeds = [b"name", name.as_bytes()],
        bump,
    )]
    pub name_record: Account<'info, NameRecord>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Update<'info> {
    #[account(mut)]
    pub name_record: Account<'info, NameRecord>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut, close = owner)]
    pub name_record: Account<'info, NameRecord>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    pub name_record: Account<'info, NameRecord>,
}

#[error_code]
pub enum WraithError {
    #[msg("Name must be 3-32 characters")]
    InvalidNameLength,
    #[msg("Name must be lowercase alphanumeric or hyphens")]
    InvalidNameCharacter,
    #[msg("Only the owner can modify this name")]
    NotOwner,
}
```

### Program Structure

```
contracts/
  solana/
    Anchor.toml
    Cargo.toml
    programs/
      wraith-announcer/
        Cargo.toml
        src/lib.rs
      wraith-sender/
        Cargo.toml
        src/lib.rs
      wraith-names/
        Cargo.toml
        src/lib.rs
    tests/
      wraith-announcer.ts
      wraith-sender.ts
      wraith-names.ts
```

### Tests (TypeScript with Anchor)

Use `@coral-xyz/anchor` test framework:

- `wraith-announcer.ts` — announce emits event, multiple callers, metadata preservation
- `wraith-sender.ts` — send_sol transfers + emits, send_spl transfers token + emits, insufficient funds revert
- `wraith-names.ts` — register/resolve, name validation (too short, invalid chars), update by owner, update by non-owner (reject), release and re-register

---

## Spectre Chain Connector

### SolanaConnector

Implements `ChainConnector` interface for Solana.

```typescript
class SolanaConnector implements ChainConnector {
  readonly chain = "solana";
  readonly nativeAsset = "SOL";
  readonly addressFormat = "solana";

  private connection: Connection;
  private programIds: { announcer: PublicKey; sender: PublicKey; names: PublicKey };

  constructor(config: SolanaConnectorConfig) {
    this.connection = new Connection(config.rpcUrl);
    this.programIds = {
      announcer: new PublicKey(config.contracts.announcer),
      sender: new PublicKey(config.contracts.sender),
      names: new PublicKey(config.contracts.names),
    };
  }
}
```

### Key Operations

| Method | Implementation |
|---|---|
| `deriveKeys(seed)` | SHA-256 seed, use as ed25519 seed, sign STEALTH_SIGNING_MESSAGE, `deriveStealthKeys(sig)`, `encodeStealthMetaAddress(spendPub, viewPub)` |
| `sendPayment` | `decodeStealthMetaAddress` then `generateStealthAddress` then build Anchor instruction for `wraith_sender.send_sol` (transfer + announce atomically) |
| `scanPayments` | Fetch announcer program transaction history, parse AnnouncementEvent logs, `scanAnnouncements()`, then `getBalance()` for each match |
| `getBalance` | `connection.getBalance(address)` for SOL, `connection.getTokenAccountsByOwner()` for SPL tokens |
| `withdraw` | `deriveStealthPrivateScalar` then `signWithScalar` to sign a SystemProgram.transfer transaction from stealth address to destination. Calculate `balance - rentExemption - txFee` as max withdrawable. |
| `registerName` | Build Anchor instruction for `wraith_names.register` with name + meta-address bytes |
| `resolveName` | Derive PDA from `["name", nameBytes]`, fetch account data, decode NameRecord |
| `fundWallet` | Solana devnet airdrop: `connection.requestAirdrop(address, lamports)` |
| `getExplorerUrl` | `https://explorer.solana.com/tx/${hash}?cluster=devnet` or `https://solscan.io/tx/${hash}` |

### Withdrawal Details

Solana stealth addresses are regular ed25519 keypairs. No account deployment needed. To withdraw:

1. Derive the stealth private scalar
2. Construct the stealth Keypair from the scalar (need to convert scalar back to a seed-compatible format, or sign the transaction directly with `signWithScalar`)
3. Build a SystemProgram.transfer instruction
4. Sign the transaction with the stealth key
5. Send via `connection.sendRawTransaction()`

The rent-exempt minimum (~0.00089 SOL) must be considered. If withdrawing all, send `balance - 5000 lamports (tx fee)`. The account will be garbage collected once balance drops below rent exemption.

### Connector Config

```typescript
interface SolanaConnectorConfig {
  rpcUrl: string;
  explorerUrl: string;
  contracts: {
    announcer: string;  // program ID base58
    sender: string;
    names: string;
  };
  cluster: "devnet" | "testnet" | "mainnet-beta";
}
```

### Registration in Chain Registry

```typescript
chainRegistry.register("solana", new SolanaConnector({
  rpcUrl: "https://api.devnet.solana.com",
  explorerUrl: "https://explorer.solana.com",
  contracts: {
    announcer: "...",  // deployed program ID
    sender: "...",
    names: "...",
  },
  cluster: "devnet",
}));
```

---

## Documentation Updates

### Pages to create/update:

1. **New page: `sdk/chains/solana.mdx`** — Solana crypto primitives API reference. Same structure as `sdk/chains/evm.mdx` and `sdk/chains/stellar.mdx`. Cover all exports, types, usage examples.

2. **Update: `sdk/overview.mdx`** — Add Solana to the entry points table and import examples.

3. **New page: `contracts/solana.mdx`** — Solana program specs. Cover all three programs (announcer, sender, names), account structures, PDA derivation, deployment instructions.

4. **Update: `architecture/chain-connectors.mdx`** — Add SolanaConnector section with config and key operations.

5. **Update: `roadmap.mdx`** — Move Solana from Phase 4 to Phase 3 or mark as in progress.

6. **Update: `introduction.mdx`** — Add Solana to the chains list.

7. **Update: `getting-started.mdx`** — Add Solana examples alongside EVM and Stellar.

### Example code for docs:

```typescript
// Send SOL privately
import {
  deriveStealthKeys,
  generateStealthAddress,
  encodeStealthMetaAddress,
  fetchAnnouncements,
  scanAnnouncements,
  getDeployment,
  STEALTH_SIGNING_MESSAGE,
} from "@wraith-protocol/sdk/chains/solana";

// Derive keys from wallet signature
const signature = await wallet.signMessage(Buffer.from(STEALTH_SIGNING_MESSAGE));
const keys = deriveStealthKeys(signature);
const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
// "st:sol:ab12...cd34..."

// Generate stealth address
const stealth = generateStealthAddress(recipientSpendPub, recipientViewPub);
// { stealthAddress: "7xKX...", ephemeralPubKey: Uint8Array, viewTag: 42 }

// Scan for payments
const announcements = await fetchAnnouncements("solana");
const payments = scanAnnouncements(announcements, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
```

---

## Deployment Checklist

1. Deploy wraith-announcer program to Solana devnet
2. Deploy wraith-sender program to Solana devnet
3. Deploy wraith-names program to Solana devnet
4. Record program IDs
5. Add program IDs to SDK `deployments.ts`
6. Add Solana devnet to Spectre chain registry config
7. Test full flow: derive keys, send SOL via sender program, scan announcements, withdraw
8. Update documentation with program IDs and examples
9. Publish SDK with Solana support (version bump)
