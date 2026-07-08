# 03 — Stellar Chain Crypto Implementation

Stealth address cryptography for Stellar using ed25519. This module lives at `@wraith-protocol/sdk/chains/stellar`.

## Reference Implementation

The existing Stellar SDK at `stellar/packages/sdk/src/` is the canonical reference.

## Dependencies

```
@noble/curves       — ed25519, x25519, edwardsToMontgomeryPub/Priv
@noble/hashes       — sha256, sha512
@stellar/stellar-sdk — StrKey (for G... address encoding)
```

Note: `@stellar/stellar-sdk` is an optional peer dep. Only needed when importing this module.

## Key Differences from EVM

| Aspect | EVM | Stellar |
|---|---|---|
| Curve | secp256k1 | ed25519 |
| Key format | `HexString` (0x-prefixed) | `Uint8Array` (raw bytes) |
| ECDH | `secp256k1.getSharedSecret` | X25519 (Montgomery form) |
| Key derivation | `keccak256(r)`, `keccak256(s)` | `SHA-256("wraith:spending:" \|\| sig)` |
| Private key | raw scalar (BigInt hex) | seed → SHA-512 → clamp → scalar |
| Address format | `0x...` (20 bytes) | `G...` (Stellar StrKey) |
| Pub key size | 33 bytes (compressed) | 32 bytes |
| Meta-address | `st:eth:0x{66}{66}` (132 hex) | `st:xlm:{64}{64}` (128 hex) |
| View tag | `keccak256(S)[0]` | `SHA-256("wraith:tag:" \|\| S)[0]` |
| Hash to scalar | `BigInt(keccak256(S)) % n` | `SHA-256("wraith:scalar:" \|\| S) % L` |
| Signing | secp256k1 ECDSA | ed25519 with raw scalar |

## Constants

```ts
STEALTH_SIGNING_MESSAGE = "Sign this message to generate your Wraith stealth keys.\n\nChain: Stellar\nNote: This signature is used for key derivation only and does not authorize any transaction."
SCHEME_ID = 1
META_ADDRESS_PREFIX = "st:xlm:"
L = 2n**252n + 27742317777372353535851937790883648493n  // ed25519 group order
```

## Types

```ts
interface StealthKeys {
  spendingKey: Uint8Array;       // 32-byte seed
  spendingScalar: bigint;        // clamped scalar from SHA-512(seed)
  viewingKey: Uint8Array;        // 32-byte seed
  viewingScalar: bigint;         // clamped scalar
  spendingPubKey: Uint8Array;    // 32-byte ed25519 public key
  viewingPubKey: Uint8Array;     // 32-byte ed25519 public key
}

interface GeneratedStealthAddress {
  stealthAddress: string;        // Stellar G... address
  ephemeralPubKey: Uint8Array;   // 32-byte ed25519 public key
  viewTag: number;               // 0-255
}

interface Announcement {
  schemeId: number;
  stealthAddress: string;        // G... address
  caller: string;                // G... address
  ephemeralPubKey: string;       // hex-encoded 32 bytes
  metadata: string;              // hex-encoded, first byte = view tag
}

interface MatchedAnnouncement extends Announcement {
  stealthPrivateScalar: bigint;
  stealthPubKeyBytes: Uint8Array;
}
```

## Algorithm 1: Seed to Scalar (`seedToScalar`)

ed25519 key derivation: seed → SHA-512 → clamp lower 32 bytes → scalar.

**Input:** 32-byte seed

**Process:**
1. `h = SHA-512(seed)` → 64 bytes
2. `a = h[0:32]` (lower half)
3. Clamp: `a[0] &= 248; a[31] &= 127; a[31] |= 64`
4. Interpret `a` as little-endian bigint

**Output:** `bigint` (the clamped scalar)

This mirrors standard ed25519 private key expansion. The scalar is used for point multiplication and signing.

## Algorithm 2: Key Derivation (`deriveStealthKeys`)

**Input:** 64-byte ed25519 signature from wallet signing `STEALTH_SIGNING_MESSAGE`

**Process:**
1. `spendingKey = SHA-256("wraith:spending:" || signature)` → 32-byte seed
2. `viewingKey = SHA-256("wraith:viewing:" || signature)` → 32-byte seed
3. `spendingScalar = seedToScalar(spendingKey)` → clamped bigint
4. `viewingScalar = seedToScalar(viewingKey)` → clamped bigint
5. `spendingPubKey = ed25519.getPublicKey(spendingKey)` → 32 bytes
6. `viewingPubKey = ed25519.getPublicKey(viewingKey)` → 32 bytes

**Output:** `StealthKeys`

**Why domain separation:** Unlike EVM where we split one signature's r/s components, ed25519 signatures are only 64 bytes and the components don't have the same independence. Domain-separated hashing is safer.

## Algorithm 3: ECDH Shared Secret (`computeSharedSecret`)

ed25519 keys must be converted to X25519 (Montgomery form) for Diffie-Hellman.

**Input:** `privateKey` (32-byte seed), `publicKey` (32-byte ed25519 point)

**Process:**
1. `privX = edwardsToMontgomeryPriv(privateKey)` — convert ed25519 seed to X25519 private key
2. `pubX = edwardsToMontgomeryPub(publicKey)` — convert ed25519 point to X25519 point
3. `sharedSecret = x25519.getSharedSecret(privX, pubX)` — 32-byte shared secret

**Output:** 32-byte `Uint8Array`

**Important:** `edwardsToMontgomeryPub` and `edwardsToMontgomeryPriv` come from `@noble/curves/ed25519`.

## Algorithm 4: View Tag (`computeViewTag`)

**Input:** 32-byte shared secret

**Process:**
1. `hash = SHA-256("wraith:tag:" || sharedSecret)`
2. `viewTag = hash[0]`

**Output:** `number` (0-255)

## Algorithm 5: Hash to Scalar (`hashToScalar`)

**Input:** 32-byte shared secret

**Process:**
1. `hash = SHA-256("wraith:scalar:" || sharedSecret)` → 32 bytes
2. Interpret as little-endian bigint
3. Reduce mod L (ed25519 group order)

**Output:** `bigint`

## Algorithm 6: Stealth Address Generation (`generateStealthAddress`)

**Input:** Recipient's `spendingPubKey` and `viewingPubKey`

**Process:**
1. Generate random ephemeral ed25519 seed (or use provided for testing)
2. `ephPubKey = ed25519.getPublicKey(ephSeed)` → 32 bytes
3. `sharedSecret = computeSharedSecret(ephSeed, viewingPubKey)` (X25519 ECDH)
4. `viewTag = computeViewTag(sharedSecret)`
5. `hScalar = hashToScalar(sharedSecret)` (SHA-256, mod L)
6. `P_stealth = K_spend + hScalar * G` (ed25519 point addition)
7. `stealthAddress = StrKey.encodeEd25519PublicKey(P_stealth)` → `G...`

**Output:** `{ stealthAddress, ephemeralPubKey, viewTag }`

## Algorithm 7: Stealth Address Checking (`checkStealthAddress`)

**Input:** `ephemeralPubKey`, `viewingKey` (seed), `spendingPubKey`, `viewTag`

**Process:**
1. `sharedSecret = computeSharedSecret(viewingKey, ephemeralPubKey)`
2. `computedTag = computeViewTag(sharedSecret)`
3. If `computedTag != viewTag` → not a match
4. `hScalar = hashToScalar(sharedSecret)`
5. `stealthPubKey = deriveStealthPubKey(spendingPubKey, hScalar)` — point addition
6. `stealthAddress = pubKeyToStellarAddress(stealthPubKey)`
7. Compare with announced address

**Output:** `{ isMatch, stealthAddress, hashScalar, stealthPubKeyBytes }`

## Algorithm 8: Stealth Private Scalar Derivation (`deriveStealthPrivateScalar`)

**Input:** `spendingScalar`, `viewingKey` (seed), `ephemeralPubKey`

**Process:**
1. `sharedSecret = computeSharedSecret(viewingKey, ephemeralPubKey)`
2. `hScalar = hashToScalar(sharedSecret)`
3. `stealthScalar = (spendingScalar + hScalar) % L`

**Output:** `bigint` — the private scalar that controls the stealth address

## Algorithm 9: Signing with Raw Scalar (`signWithScalar`)

Standard ed25519 signatures use a seed, but stealth private keys are derived scalars that can't be represented as seeds. This function implements ed25519 signing directly with a scalar.

**Input:** `message` (Uint8Array), `scalar` (bigint), `publicKey` (32 bytes)

**Process:**
1. `prefix = SHA-256(scalarToBytes(scalar))` — synthetic nonce prefix
2. `rHash = SHA-512(prefix || message)`
3. `r = bytesToScalar(rHash) % L` — nonce scalar
4. `R = r * G` — nonce point
5. `kHash = SHA-512(R || publicKey || message)`
6. `k = bytesToScalar(kHash) % L`
7. `S = (r + k * scalar) % L`
8. `signature = R || S` (64 bytes)

**Output:** 64-byte `Uint8Array`

**Why this exists:** `Keypair.fromRawEd25519Seed()` cannot produce a keypair for a derived (non-clamped) scalar. The stealth scalar `(spendingScalar + hashScalar) % L` is not necessarily clamped, so standard Stellar signing doesn't work.

## Algorithm 10: Signing Stellar Transactions (`signStellarTransaction`)

**Input:** 32-byte transaction hash, stealth scalar, stealth public key

**Process:** Calls `signWithScalar(transactionHash, stealthScalar, stealthPubKey)`

**Output:** 64-byte ed25519 signature — can be added to a Stellar transaction envelope

## End-to-End Flow

```
1. User signs STEALTH_SIGNING_MESSAGE with Stellar wallet → 64-byte ed25519 sig
2. deriveStealthKeys(sig) → { spendingKey, spendingScalar, viewingKey, viewingScalar, spendingPubKey, viewingPubKey }
3. encodeStealthMetaAddress(spendingPubKey, viewingPubKey) → "st:xlm:..."
4. Sender: generateStealthAddress(spendingPubKey, viewingPubKey) → { stealthAddress (G...), ephemeralPubKey, viewTag }
5. Sender: sends XLM to stealthAddress via createAccount, calls Soroban announcer
6. Recipient: scanAnnouncements(events, viewingKey, spendingPubKey, spendingScalar) → matched[]
7. Recipient: signStellarTransaction(txHash, matched[i].stealthPrivateScalar, matched[i].stealthPubKeyBytes) → signature
8. Recipient: attaches signature to transaction, submits to Horizon
```
