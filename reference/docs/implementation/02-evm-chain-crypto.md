# 02 — EVM Chain Crypto Implementation

Stealth address cryptography for all EVM-compatible chains using secp256k1. This module lives at `@wraith-protocol/sdk/chains/evm`.

## Reference Implementation

The existing Horizen SDK at `packages/sdk/src/` is the canonical reference. This document describes the exact algorithms so they can be reimplemented or verified.

## Dependencies

```
@noble/curves   — secp256k1 elliptic curve operations
viem            — keccak256, toHex, toBytes, encodePacked, getAddress
```

## Constants

```ts
STEALTH_SIGNING_MESSAGE = "Sign this message to generate your Wraith stealth keys.\n\nChain: Horizen\nNote: This signature is used for key derivation only and does not authorize any transaction."
SCHEME_ID = 1n  // bigint for on-chain compatibility
META_ADDRESS_PREFIX = "st:eth:0x"
```

## Types

```ts
type HexString = `0x${string}`;

interface StealthKeys {
  spendingKey: HexString;      // 32-byte private key
  viewingKey: HexString;       // 32-byte private key
  spendingPubKey: HexString;   // 33-byte compressed public key
  viewingPubKey: HexString;    // 33-byte compressed public key
}

interface GeneratedStealthAddress {
  stealthAddress: HexString;   // 20-byte EVM address
  ephemeralPubKey: HexString;  // 33-byte compressed public key
  viewTag: number;             // 0-255
}

interface Announcement {
  schemeId: bigint;
  stealthAddress: HexString;
  caller: HexString;
  ephemeralPubKey: HexString;
  metadata: HexString;         // first byte is view tag
}

interface MatchedAnnouncement extends Announcement {
  stealthPrivateKey: HexString;
}
```

## Algorithm 1: Key Derivation (`deriveStealthKeys`)

**Input:** 65-byte ECDSA signature (r || s || v) from wallet signing `STEALTH_SIGNING_MESSAGE`

**Process:**
1. Split signature: `r = sig[0:32]`, `s = sig[32:64]`, `v = sig[64]` (v is ignored)
2. `spendingKey = keccak256(toHex(r))`
3. `viewingKey = keccak256(toHex(s))`
4. Validate both scalars: `0 < scalar < secp256k1.CURVE.n`
5. `spendingPubKey = secp256k1.getPublicKey(spendingKey, compressed=true)`
6. `viewingPubKey = secp256k1.getPublicKey(viewingKey, compressed=true)`

**Output:** `StealthKeys`

**Test:** Same signature always produces same keys. Spending key != viewing key. Both pub keys are valid 33-byte compressed points.

## Algorithm 2: Stealth Address Generation (`generateStealthAddress`)

**Input:** Recipient's `spendingPubKey` and `viewingPubKey` (from their meta-address)

**Process:**
1. Generate random ephemeral private key `r` (or use provided for testing)
2. `R = r * G` (ephemeral public key, compressed)
3. `S = r * K_view` (ECDH shared secret, compressed)
4. `hashedSecret = keccak256(toHex(S))`
5. `viewTag = hashedSecret[0]` (first byte)
6. `secretScalar = BigInt(hashedSecret) % n`
7. `P_stealth = K_spend + secretScalar * G` (point addition)
8. `uncompressed = P_stealth.toRawBytes(false)` (65 bytes: 04 || x || y)
9. `addressHash = keccak256(uncompressed[1:65])` (hash the 64-byte x||y)
10. `stealthAddress = getAddress("0x" + addressHash.slice(-40))` (last 20 bytes, checksummed)

**Output:** `{ stealthAddress, ephemeralPubKey: R, viewTag }`

**Test:** Fixed ephemeral key produces deterministic output. Different recipients produce different addresses.

## Algorithm 3: Stealth Address Checking (`checkStealthAddress`)

**Input:** `ephemeralPubKey`, `viewingKey` (private), `spendingPubKey`, `viewTag`

**Process:**
1. `S = viewingKey * R` (ECDH shared secret using viewing private key)
2. `hashedSecret = keccak256(toHex(S))`
3. `computedTag = hashedSecret[0]`
4. If `computedTag != viewTag` → not a match (fast rejection, eliminates ~255/256)
5. `secretScalar = BigInt(hashedSecret) % n`
6. `P_stealth = K_spend + secretScalar * G`
7. Derive address same as Algorithm 2 steps 8-10
8. Compare with announced stealth address

**Output:** `{ isMatch: boolean, stealthAddress: HexString | null }`

**Test:** Matches own announcements. Rejects announcements with wrong view tag. Rejects announcements for other recipients.

## Algorithm 4: Announcement Scanning (`scanAnnouncements`)

**Input:** Array of `Announcement`, `viewingKey`, `spendingPubKey`, `spendingKey`

**Process:**
1. For each announcement:
   a. Skip if `schemeId != SCHEME_ID`
   b. Extract `viewTag = metadata[0]`
   c. Call `checkStealthAddress(ephemeralPubKey, viewingKey, spendingPubKey, viewTag)`
   d. If match AND addresses equal:
      - Call `deriveStealthPrivateKey(spendingKey, ephemeralPubKey, viewingKey)`
      - Add to results with `stealthPrivateKey`

**Output:** Array of `MatchedAnnouncement`

## Algorithm 5: Stealth Private Key Derivation (`deriveStealthPrivateKey`)

**Input:** `spendingKey`, `ephemeralPubKey`, `viewingKey`

**Process:**
1. `S = viewingKey * R` (same shared secret as scanning)
2. `hashedSecret = keccak256(toHex(S))`
3. `s_h = BigInt(hashedSecret) % n`
4. `m = BigInt(spendingKey)`
5. `stealthPrivKey = (m + s_h) % n`
6. Convert to 0x-prefixed 32-byte hex (zero-padded)

**Output:** `HexString` (the private key that controls the stealth address)

**Test:** Derived key's corresponding address matches the stealth address from Algorithm 2. `privateKeyToAccount(stealthPrivKey).address == stealthAddress`.

## Algorithm 6: Meta-Address Encoding/Decoding

**Encode:** `"st:eth:0x" + spendingPubKey.slice(2) + viewingPubKey.slice(2)`
- Validates both are 33-byte compressed secp256k1 points

**Decode:** Split after prefix, first 66 hex chars = spending, next 66 = viewing
- Validates prefix is `"st:eth:0x"`, total hex length is 132, both are valid curve points

## Algorithm 7: Name Registration Signing

**`signNameRegistration(name, metaAddressBytes, spendingKey)`**
1. `digest = keccak256(encodePacked(["string", "bytes"], [name, metaAddressBytes]))`
2. `prefixed = keccak256(encodePacked(["string", "bytes32"], ["\x19Ethereum Signed Message:\n32", digest]))`
3. `sig = secp256k1.sign(toBytes(prefixed), toBytes(spendingKey))`
4. Return `0x{r}{s}{v}` where v = recovery + 27

**`metaAddressToBytes(metaAddress)`**
- Input: `"st:eth:0x{hex}"` → Output: `"0x{hex}"` (strip the `st:eth:` prefix)

## End-to-End Flow

```
1. User signs STEALTH_SIGNING_MESSAGE with wallet → 65-byte sig
2. deriveStealthKeys(sig) → { spendingKey, viewingKey, spendingPubKey, viewingPubKey }
3. encodeStealthMetaAddress(spendingPubKey, viewingPubKey) → "st:eth:0x..."
4. Sender: generateStealthAddress(spendingPubKey, viewingPubKey) → { stealthAddress, ephemeralPubKey, viewTag }
5. Sender: sends ETH to stealthAddress, calls announcer contract with (ephemeralPubKey, viewTag)
6. Recipient: scanAnnouncements(events, viewingKey, spendingPubKey, spendingKey) → matched[]
7. Recipient: uses matched[i].stealthPrivateKey to sign transactions from stealthAddress
```
