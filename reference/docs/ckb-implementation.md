# CKB (Nervos) Stealth Address Implementation

Full implementation spec for adding CKB support across the Wraith Protocol stack.

## Overview

CKB uses secp256k1 (same curve as EVM) but has a fundamentally different model: UTXO-based Cells instead of accounts. The key insight from the Obscell wallet reference implementation is that **the Cell itself is the announcement**. There is no separate announcer contract. The stealth lock script args contain both the ephemeral public key and the stealth address hash.

## Reference Implementation

The `reference/ckb-reference/` folder contains source code from the Obscell project:
- `wallet-src/stealth.rs` - Core stealth address crypto (ECDH, key derivation, matching)
- `wallet-src/tx_builder.rs` - Transaction building for stealth cells
- `wallet-src/scanner.rs` - Blockchain scanning for stealth cells
- `wallet-src/account.rs` - Account/key management
- `wallet-src/cell.rs` - Cell data structures
- `contracts-src/stealth-lock.rs` - The on-chain lock script
- `contracts-src/tests.rs` - Contract tests
- `testnet.toml` - Testnet contract deployment config

Read these files thoroughly before implementing. They show exactly how stealth addresses work on CKB.

## How CKB Stealth Addresses Work

### The Cell Model

CKB stores all state in Cells. A Cell has:
- `capacity` - Amount of CKB stored (like ETH balance)
- `lock` - Script that must be satisfied to spend (like an address)
- `type` - Optional script for additional validation
- `data` - Arbitrary data

### Stealth Lock Script

Instead of a separate announcer contract, CKB uses a custom lock script called `stealth-lock`. The lock script args are exactly 53 bytes:

```
args = ephemeral_pubkey (33 bytes) || blake160(stealth_pubkey) (20 bytes)
```

This is brilliant: the announcement data (ephemeral pubkey) is embedded directly in the lock script. No separate transaction or event needed.

### Flow

**Sending:**
1. Sender generates ephemeral key, computes ECDH shared secret with recipient's viewing key
2. Derives stealth public key: `stealth_pub = spend_pub + SHA256(shared_secret) * G`
3. Computes `blake160(stealth_pub)` = first 20 bytes of `blake2b(stealth_pub.serialize())`
4. Creates a Cell with lock script args = `ephemeral_pub (33) || blake160(stealth_pub) (20)`
5. The Cell's lock uses the `stealth-lock` code hash

**Scanning:**
1. Query all live Cells with the `stealth-lock` code hash
2. For each Cell, extract the ephemeral pubkey from args[0:33]
3. Compute ECDH: `shared = ECDH(viewing_key, ephemeral_pub)`
4. Derive expected stealth pub: `expected = spend_pub + SHA256(shared) * G`
5. Compare `blake160(expected)` with args[33:53]
6. If match, this Cell belongs to us

**Spending:**
1. Derive stealth secret: `stealth_key = spend_key + SHA256(shared_secret)`
2. Sign the transaction hash with the stealth key
3. Create a new Cell at the destination, consuming the stealth Cell

### Key Differences from EVM

| Aspect | EVM | CKB |
|---|---|---|
| Model | Account-based | UTXO (Cell) |
| Announcement | Separate event from Announcer contract | Embedded in Cell lock script args |
| Address | keccak256(pubkey)[12:32] | blake2b(pubkey)[0:20] |
| Hash function | keccak256 | blake2b with "ckb-default-hash" personalization |
| Shared secret hash | keccak256(ECDH_shared) | SHA-256(ECDH_shared) |
| Scanning | Query subgraph for Announcement events | Query live Cells with stealth-lock code hash |
| Stealth address format | 0x + 20-byte hex | bech32m CKB address encoding |
| Min balance | None (EOA) | 61 CKB (~$0.30) for cell capacity |
| Spending | Direct sendTransaction | Consume Cell, create new Cell |

### Cryptographic Primitives

Same secp256k1 curve as EVM, but different hash functions:

```
// EVM stealth address derivation:
shared_secret = ECDH(ephemeral_priv, viewing_pub)
hashed = keccak256(shared_secret)
stealth_pub = spending_pub + hashed * G
address = keccak256(uncompressed_stealth_pub)[12:32]

// CKB stealth address derivation:
shared_secret = ECDH(ephemeral_priv, viewing_pub)
hashed = SHA-256(shared_secret)
stealth_pub = spending_pub + hashed * G
pubkey_hash = blake2b(compressed_stealth_pub)[0:20]
```

---

## SDK Implementation (`@wraith-protocol/sdk/chains/ckb`)

### Dependencies

- `@noble/curves` (secp256k1) - already a direct dependency
- `@noble/hashes` (sha256, blake2b) - already a direct dependency
- `@ckb-lumos/lumos` or `@ckb-lumos/base` - optional peer dep for CKB address encoding and RPC

### Constants

```typescript
STEALTH_SIGNING_MESSAGE = "Sign this message to generate your Wraith stealth keys.\n\nChain: CKB\nNote: This signature is used for key derivation only and does not authorize any transaction."
SCHEME_ID = 1
META_ADDRESS_PREFIX = "st:ckb:"
```

### Types

```typescript
type HexString = `0x${string}`;

interface StealthKeys {
  spendingKey: HexString;       // 32-byte private key
  viewingKey: HexString;        // 32-byte private key
  spendingPubKey: HexString;    // 33-byte compressed secp256k1
  viewingPubKey: HexString;     // 33-byte compressed secp256k1
}

interface GeneratedStealthAddress {
  stealthPubKey: HexString;     // 33-byte compressed stealth public key
  stealthPubKeyHash: HexString; // 20-byte blake160 hash
  ephemeralPubKey: HexString;   // 33-byte compressed ephemeral public key
  lockArgs: HexString;          // 53 bytes: ephemeral_pub || blake160(stealth_pub)
}

// CKB doesn't have separate announcements - Cells ARE the announcements
interface StealthCell {
  txHash: HexString;
  index: number;
  capacity: bigint;              // in shannons
  lockArgs: HexString;           // 53 bytes
  ephemeralPubKey: HexString;    // extracted from lockArgs[0:33]
  stealthPubKeyHash: HexString;  // extracted from lockArgs[33:53]
}

interface MatchedStealthCell extends StealthCell {
  stealthPrivateKey: HexString;
}
```

### Algorithms

**Key derivation (`deriveStealthKeys`):**
Same as EVM. 65-byte ECDSA signature, split r/s, keccak256 each to get spending and viewing keys.

**Stealth address generation (`generateStealthAddress`):**
```
1. ephemeral_priv = random 32 bytes
2. ephemeral_pub = secp256k1.getPublicKey(ephemeral_priv, compressed=true)
3. shared_secret = secp256k1.getSharedSecret(ephemeral_priv, viewing_pub, compressed=true)
4. hashed = SHA-256(shared_secret)    // NOT keccak256 like EVM
5. stealth_pub = spending_pub + hashed * G
6. pubkey_hash = blake2b("ckb-default-hash", stealth_pub.serialize())[0:20]
7. lock_args = ephemeral_pub || pubkey_hash
```

**Scanning (`checkStealthCell`, `scanStealthCells`):**
```
For each Cell with stealth-lock code hash:
  1. ephemeral_pub = cell.lock_args[0:33]
  2. shared = ECDH(viewing_key, ephemeral_pub)
  3. hashed = SHA-256(shared)
  4. expected_pub = spending_pub + hashed * G
  5. expected_hash = blake2b(expected_pub.serialize())[0:20]
  6. if expected_hash == cell.lock_args[33:53]: MATCH
```

No view tag optimization on CKB (the Obscell implementation doesn't use view tags). Every Cell must be fully checked.

**Stealth private key derivation:**
```
stealth_key = (spending_key + SHA256(shared_secret)) mod n
```
Same as EVM but using SHA-256 instead of keccak256 for the shared secret hash.

**blake160 helper:**
```typescript
import { blake2b } from "@noble/hashes/blake2b";

function blake160(data: Uint8Array): Uint8Array {
  const hash = blake2b(data, { personalization: "ckb-default-hash", dkLen: 32 });
  return hash.slice(0, 20);
}
```

**Meta-address format:**
`st:ckb:{spendingPubKeyHex}{viewingPubKeyHex}` - 132 hex chars after prefix (two 33-byte compressed keys, same as EVM).

### Files

```
src/chains/ckb/
  constants.ts       - signing message, scheme ID, meta-address prefix
  types.ts           - HexString, StealthKeys, StealthCell, MatchedStealthCell
  keys.ts            - deriveStealthKeys (reuse from EVM, identical)
  stealth.ts         - generateStealthAddress (SHA-256 + blake160 instead of keccak256)
  scan.ts            - checkStealthCell, scanStealthCells (query Cells, not events)
  spend.ts           - deriveStealthPrivateKey (SHA-256 instead of keccak256)
  meta-address.ts    - encode/decode with st:ckb: prefix
  blake.ts           - blake160 and blake2b helpers with CKB personalization
  deployments.ts     - testnet contract code hashes and cell deps
  announcements.ts   - fetchStealthCells via CKB RPC (get_cells with stealth-lock filter)
  index.ts           - re-exports
```

### Announcement Fetching (Cell Scanning via RPC)

CKB has a built-in indexer RPC method `get_cells` that can filter by lock script code hash:

```typescript
async function fetchStealthCells(chain: string = "ckb"): Promise<StealthCell[]> {
  const deployment = getDeployment(chain);
  const cells: StealthCell[] = [];
  let cursor: string | undefined;

  while (true) {
    const result = await fetch(deployment.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 0,
        jsonrpc: "2.0",
        method: "get_cells",
        params: [{
          script: {
            code_hash: deployment.contracts.stealthLockCodeHash,
            hash_type: "data2",
            args: "0x",  // match all stealth-lock cells
          },
          script_type: "lock",
        }, "asc", "0x64", cursor],
      }),
    });
    const data = await result.json();
    const objects = data.result?.objects ?? [];

    for (const obj of objects) {
      const args = obj.output.lock.args;
      if (args.length !== 108) continue; // 0x + 53 bytes * 2 = 108 chars

      cells.push({
        txHash: obj.out_point.tx_hash,
        index: parseInt(obj.out_point.index, 16),
        capacity: BigInt(obj.output.capacity),
        lockArgs: args,
        ephemeralPubKey: ("0x" + args.slice(2, 68)) as HexString,
        stealthPubKeyHash: ("0x" + args.slice(68)) as HexString,
      });
    }

    cursor = data.result?.last_cursor;
    if (!cursor || objects.length === 0) break;
  }

  return cells;
}
```

### Deployments

Deployment config is populated after contracts are deployed on testnet. The structure:

```typescript
export const DEPLOYMENTS = {
  ckb: {
    network: "testnet",
    rpcUrl: "https://testnet.ckbapp.dev",
    explorerUrl: "https://pudge.explorer.nervos.org",
    contracts: {
      stealthLockCodeHash: "", // filled after deployment
    },
    cellDeps: {
      stealthLock: {
        txHash: "",  // filled after deployment
        index: 0,
      },
    },
  },
};
```

Update these values after deploying wraith-stealth-lock to CKB testnet.

### Package.json Updates

Add to exports:
```json
"./chains/ckb": {
  "types": "./dist/chains/ckb/index.d.ts",
  "import": "./dist/chains/ckb/index.js",
  "require": "./dist/chains/ckb/index.cjs"
}
```

No new peer dependency needed. CKB RPC calls use raw `fetch`. For CKB address encoding, use the existing `@noble/hashes` blake2b.

### Tests

Same structure as EVM tests:
- `keys.test.ts` - valid derivation, determinism, spending != viewing
- `stealth.test.ts` - valid generation, lock args are 53 bytes, blake160 hash correct
- `scan.test.ts` - matches own cells, rejects wrong viewing key
- `spend.test.ts` - derived key produces matching public key
- `meta-address.test.ts` - encode/decode roundtrip with st:ckb: prefix
- `e2e.test.ts` - full flow: derive keys, generate stealth, check match, derive private key

---

## Contracts

We write and deploy our own CKB scripts. The reference code in `reference/ckb-reference/contracts-src/stealth-lock.rs` shows the pattern from the Obscell project. Use it as a reference to understand how CKB lock scripts work, but write our own implementation.

CKB scripts are written in Rust (or C) and compiled to RISC-V binaries that run on CKB-VM. Use the `ckb-std` crate for syscalls and `ckb-hash` for blake2b.

### wraith-stealth-lock

A lock script that verifies secp256k1 signatures against the stealth public key hash embedded in the script args.

**Script args format:** 53 bytes = `ephemeral_pubkey (33 bytes) || blake160(stealth_pubkey) (20 bytes)`

**Verification flow:**
1. Load script args (53 bytes)
2. Extract `pubkey_hash = args[33:53]` (the blake160 of the stealth public key)
3. Load transaction hash as the signing message
4. Load 65-byte signature from witness (lock field)
5. Recover the public key from the signature
6. Compute `blake160(recovered_pubkey)` 
7. Compare with `pubkey_hash` from args. If equal, signature is valid.

Use `ckb-auth` (the standard CKB auth library) for signature verification, or implement secp256k1 recovery directly using the `ckb-std` crypto syscalls.

```rust
// Pseudocode for the lock script
fn program_entry() -> i8 {
    let script = load_script();
    let args = script.args().raw_data();
    
    // args must be exactly 53 bytes
    if args.len() != 53 {
        return ERROR_ARGS_LENGTH;
    }
    
    let pubkey_hash = &args[33..53]; // blake160 of stealth pubkey
    
    // Load signature from witness
    let witness_args = load_witness_args(0, Source::GroupInput);
    let signature = witness_args.lock(); // 65 bytes
    
    // Load tx hash as message
    let tx_hash = load_tx_hash();
    
    // Verify secp256k1 signature and check pubkey hash matches
    // Use ckb-auth or direct secp256k1 recovery
    verify_secp256k1(tx_hash, signature, pubkey_hash)
}
```

### wraith-names-type (optional, for .wraith names on CKB)

A Type Script that validates name registration cells. Each name is a Cell with:
- `data`: meta-address bytes (66 bytes: spending_pub + viewing_pub)
- `type.args`: blake2b hash of the name string
- `lock`: owner's lock script

The Type Script validates:
- Name is 3-32 characters, lowercase alphanumeric + hyphens
- No duplicate names (check that no other live Cell has the same type args)
- Updates require the current owner's signature

This is a secondary priority. Implement stealth-lock first.

### Contract Structure

```
contracts/
  ckb/
    Cargo.toml                    # workspace
    contracts/
      wraith-stealth-lock/
        Cargo.toml
        src/main.rs
      wraith-names-type/          # optional
        Cargo.toml
        src/main.rs
    tests/
      src/tests.rs
```

### Deployment

Build to RISC-V:
```bash
cargo build --target riscv64imac-unknown-none-elf --release
```

Deploy the compiled binary as a Cell on CKB testnet. The Cell's data hash becomes the `code_hash` used in lock scripts. Record the deployment transaction hash and index for `cell_deps`.

After deployment, update the SDK's `deployments.ts` with the actual code hash, cell dep tx hash, and index.

---

## Spectre Connector

### CKBConnector

```typescript
class CKBConnector implements ChainConnector {
  readonly chain = "ckb";
  readonly nativeAsset = "CKB";
  readonly addressFormat = "ckb";

  constructor(config: CKBConnectorConfig) { ... }
}
```

### Key Operations

| Method | Implementation |
|---|---|
| `deriveKeys(seed)` | SHA-256 seed, `privateKeyToAccount`, sign message, `deriveStealthKeys(sig)` |
| `sendPayment` | Generate stealth address, create Cell with stealth-lock, submit transaction |
| `scanPayments` | `get_cells` RPC with stealth-lock code hash filter, check each Cell with viewing key |
| `getBalance` | Sum capacity of all matched stealth Cells |
| `withdraw` | Derive stealth private key, consume stealth Cell, create destination Cell |
| `registerName` | Not implemented for CKB initially |
| `resolveName` | Not implemented for CKB initially |
| `fundWallet` | CKB testnet faucet |
| `getExplorerUrl` | `https://pudge.explorer.nervos.org/transaction/{hash}` |

### Sending a Payment

```typescript
async sendPayment(params) {
  const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(params.recipientMetaAddress);
  const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);

  // Build CKB transaction:
  // Input: sender's cells with enough capacity
  // Output 1: stealth cell with lock = { code_hash: stealth_lock, args: stealth.lockArgs }
  // Output 2: change cell back to sender
  // Capacity: amount + 61 CKB minimum for cell

  const tx = buildTransaction(inputs, [{
    capacity: amount,
    lock: {
      codeHash: deployment.contracts.stealthLockCodeHash,
      hashType: "data2",
      args: stealth.lockArgs,
    },
  }], change);

  return { txHash: await submitTransaction(tx) };
}
```

### Withdrawing

```typescript
async withdraw(params) {
  const cell = findMatchedCell(params.from);
  const stealthKey = deriveStealthPrivateKey(stealthKeys.spendingKey, cell.ephemeralPubKey, stealthKeys.viewingKey);

  // Build transaction consuming the stealth cell:
  // Input: the stealth cell
  // Output: destination cell (regular lock script)
  // Witness: signature with stealth key
  // Fee deducted from capacity

  const tx = buildWithdrawTransaction(cell, destination, stealthKey);
  return { txHash: await submitTransaction(tx) };
}
```

### Connector Config

```typescript
interface CKBConnectorConfig {
  rpcUrl: string;
  explorerUrl: string;
  contracts: {
    stealthLockCodeHash: string;
    ckbAuthCodeHash: string;
  };
  cellDeps: {
    stealthLock: { txHash: string; index: number };
    ckbAuth: { txHash: string; index: number };
  };
  network: "testnet" | "mainnet";
}
```

---

## Documentation Updates

1. **New page: `sdk/chains/ckb.mdx`** - CKB crypto primitives, Cell-based scanning, blake160 hashing
2. **New page: `contracts/ckb.mdx`** - Explain stealth-lock script, Cell model, no separate announcer
3. **Update: `sdk/overview.mdx`** - Add CKB entry point
4. **Update: `architecture/chain-connectors.mdx`** - Add CKBConnector
5. **Update: `roadmap.mdx`** - Mark CKB as in progress
6. **Update: `introduction.mdx`** - Add CKB to chains table

---

## Key Implementation Notes

1. **No view tags on CKB.** The Obscell implementation checks every Cell. This is fine because CKB's `get_cells` RPC already filters by lock script code hash, so we only check Cells that use stealth-lock.

2. **blake2b personalization.** CKB uses `"ckb-default-hash"` as the blake2b personalization. This MUST be included or hashes won't match.

3. **Minimum cell capacity.** A stealth-lock cell requires at least 61 CKB due to the 53-byte args. Sender must send at least this amount.

4. **No names contract initially.** CKB names would require a new Type Script. Skip for initial launch.

5. **Reuse EVM secp256k1 math.** The curve operations are identical. Only the hash functions differ (SHA-256 for shared secret, blake2b for address, vs keccak256 for both on EVM).

6. **Deploy our own contracts.** We write and deploy our own wraith-stealth-lock script. The Obscell reference code is for understanding only. SDK deployments.ts is updated after deployment with our code hash and cell dep info.
