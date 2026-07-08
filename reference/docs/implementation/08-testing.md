# 08 — Testing

Comprehensive test strategy for the entire Wraith platform. Test framework: Vitest for SDK/TypeScript, Hardhat+chai for EVM contracts, native Rust tests for Stellar contracts.

## Test Structure

```
packages/sdk/test/
  chains/
    evm/
      keys.test.ts
      stealth.test.ts
      scan.test.ts
      spend.test.ts
      meta-address.test.ts
      names.test.ts
      e2e.test.ts
    stellar/
      keys.test.ts
      stealth.test.ts
      scan.test.ts
      spend.test.ts
      meta-address.test.ts
      e2e.test.ts
  agent/
    client.test.ts

contracts/test/
  ERC5564Announcer.test.ts
  ERC6538Registry.test.ts
  WraithNames.test.ts
  WraithSender.test.ts
  WraithWithdrawer.test.ts
```

## SDK Tests — EVM Chain Crypto

### keys.test.ts

| Test Case | Input | Expected Result |
|---|---|---|
| Valid key derivation | 65-byte signature | Returns StealthKeys with all 4 fields |
| Deterministic | Same signature twice | Identical keys both times |
| Spending != viewing | Valid signature | `spendingKey !== viewingKey` |
| Valid curve points | Valid signature | Both pub keys are 33 bytes, valid secp256k1 points |
| Wrong signature length | 64-byte input | Throws "Expected 65-byte signature" |
| Wrong signature length | 66-byte input | Throws "Expected 65-byte signature" |

```ts
test("derives valid keys from signature", () => {
  const sig = "0x" + "aa".repeat(32) + "bb".repeat(32) + "1b";
  const keys = deriveStealthKeys(sig as HexString);

  expect(keys.spendingKey).toMatch(/^0x[0-9a-f]{64}$/);
  expect(keys.viewingKey).toMatch(/^0x[0-9a-f]{64}$/);
  expect(keys.spendingPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
  expect(keys.viewingPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
  expect(keys.spendingKey).not.toBe(keys.viewingKey);
});
```

### stealth.test.ts

| Test Case | Input | Expected Result |
|---|---|---|
| Valid generation | Recipient pub keys | Returns stealthAddress (0x, 42 chars), ephemeralPubKey (33 bytes), viewTag (0-255) |
| Deterministic | Fixed ephemeral key | Same output every time |
| Different ephemeral keys | Same recipient, random keys | Different stealth addresses |
| Different recipients | Same ephemeral key | Different stealth addresses |
| Address is valid EVM | Any input | `getAddress(stealthAddress)` doesn't throw |

```ts
test("generates valid stealth address", () => {
  const keys = deriveStealthKeys(testSig);
  const result = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);

  expect(result.stealthAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  expect(result.ephemeralPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
  expect(result.viewTag).toBeGreaterThanOrEqual(0);
  expect(result.viewTag).toBeLessThanOrEqual(255);
});
```

### scan.test.ts

| Test Case | Input | Expected Result |
|---|---|---|
| Matches own announcement | Generated stealth address | `isMatch: true`, correct stealthAddress |
| Wrong view tag | Modified view tag | `isMatch: false` (fast rejection) |
| Wrong viewing key | Different recipient's key | `isMatch: false` |
| Scan multiple | Mix of own + foreign announcements | Only own announcements matched |
| Wrong scheme ID | `schemeId: 99` | Skipped |
| Includes private key | Matched announcement | `stealthPrivateKey` is valid 32-byte hex |

```ts
test("scanAnnouncements finds matching payments", () => {
  const keys = deriveStealthKeys(testSig);
  const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

  const announcements: Announcement[] = [{
    schemeId: SCHEME_ID,
    stealthAddress: stealth.stealthAddress,
    caller: "0x" + "00".repeat(20) as HexString,
    ephemeralPubKey: stealth.ephemeralPubKey,
    metadata: ("0x" + stealth.viewTag.toString(16).padStart(2, "0")) as HexString,
  }];

  const matched = scanAnnouncements(announcements, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);
  expect(matched).toHaveLength(1);
  expect(matched[0].stealthAddress.toLowerCase()).toBe(stealth.stealthAddress.toLowerCase());
  expect(matched[0].stealthPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
});
```

### spend.test.ts

| Test Case | Input | Expected Result |
|---|---|---|
| Valid private key | Keys + ephemeral pub | Returns 0x-prefixed 32-byte hex |
| Controls stealth address | Derived key | `privateKeyToAccount(key).address === stealthAddress` |
| Deterministic | Same inputs twice | Same key |

```ts
test("derived key controls the stealth address", () => {
  const keys = deriveStealthKeys(testSig);
  const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, fixedEphKey);
  const privKey = deriveStealthPrivateKey(keys.spendingKey, stealth.ephemeralPubKey, keys.viewingKey);
  const account = privateKeyToAccount(privKey);
  expect(account.address.toLowerCase()).toBe(stealth.stealthAddress.toLowerCase());
});
```

### meta-address.test.ts

| Test Case | Input | Expected Result |
|---|---|---|
| Encode valid keys | 33-byte spend + view pub | `"st:eth:0x" + 132 hex chars` |
| Reject wrong length | 32-byte key | Throws |
| Decode valid | Encoded meta-address | Returns original keys |
| Reject bad prefix | `"st:xlm:..."` | Throws "Invalid prefix" |
| Reject bad length | Truncated hex | Throws "Invalid length" |
| Roundtrip | Encode then decode | `decoded.spendingPubKey === original` |

### names.test.ts

| Test Case | Input | Expected Result |
|---|---|---|
| metaAddressToBytes | `"st:eth:0x{hex}"` | `"0x{hex}"` (strip prefix) |
| metaAddressToBytes invalid | `"invalid"` | Throws |
| signNameRegistration | name + metaBytes + key | 65-byte hex signature |
| signNameRegistrationOnBehalf | name + metaBytes + key + nonce | Different sig than without nonce |
| signNameUpdate | name + newMeta + key | Valid 65-byte sig |
| signNameRelease | name + key | Valid 65-byte sig |

### e2e.test.ts — Full End-to-End

```ts
test("full stealth payment flow", () => {
  // 1. Derive keys
  const keys = deriveStealthKeys(testSig);

  // 2. Encode meta-address
  const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
  expect(meta).toMatch(/^st:eth:0x/);

  // 3. Decode meta-address (sender side)
  const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(meta);

  // 4. Generate stealth address (sender side)
  const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);

  // 5. Build announcement
  const announcement: Announcement = {
    schemeId: SCHEME_ID,
    stealthAddress: stealth.stealthAddress,
    caller: "0x" + "aa".repeat(20) as HexString,
    ephemeralPubKey: stealth.ephemeralPubKey,
    metadata: ("0x" + stealth.viewTag.toString(16).padStart(2, "0")) as HexString,
  };

  // 6. Scan (recipient side)
  const matched = scanAnnouncements([announcement], keys.viewingKey, keys.spendingPubKey, keys.spendingKey);
  expect(matched).toHaveLength(1);

  // 7. Verify spending key
  const account = privateKeyToAccount(matched[0].stealthPrivateKey);
  expect(account.address.toLowerCase()).toBe(stealth.stealthAddress.toLowerCase());

  // 8. Verify independent derivation matches
  const independentKey = deriveStealthPrivateKey(keys.spendingKey, stealth.ephemeralPubKey, keys.viewingKey);
  expect(independentKey).toBe(matched[0].stealthPrivateKey);
});
```

## SDK Tests — Stellar Chain Crypto

Same test categories adapted for ed25519:

| Test | Key Differences |
|---|---|
| keys.test.ts | 64-byte sig input, Uint8Array keys, bigint scalars, 32-byte pub keys |
| stealth.test.ts | G... addresses, X25519 ECDH |
| scan.test.ts | `stealthPrivateScalar` (bigint) instead of `stealthPrivateKey` (hex) |
| spend.test.ts | `deriveStealthPrivateScalar` returns bigint, verify via point multiplication |
| meta-address.test.ts | `"st:xlm:"` prefix, 128 hex chars, 32-byte keys |
| e2e.test.ts | Full flow: sign → derive → generate → scan → derive scalar → sign tx |

### Stellar E2E Verification

```ts
test("full stealth payment flow on stellar", () => {
  const keys = deriveStealthKeys(testSig64);

  const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
  const decoded = decodeStealthMetaAddress(meta);

  const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey, fixedSeed);
  expect(stealth.stealthAddress).toMatch(/^G[A-Z2-7]{55}$/);

  // Build announcement
  const ann = { schemeId: SCHEME_ID, stealthAddress: stealth.stealthAddress, ... };

  const matched = scanAnnouncements([ann], keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
  expect(matched).toHaveLength(1);

  // Verify: scalar * G == stealth pub key
  const stealthPub = ed25519.ExtendedPoint.BASE.multiply(matched[0].stealthPrivateScalar);
  expect(bytesToHex(stealthPub.toRawBytes())).toBe(bytesToHex(matched[0].stealthPubKeyBytes));
});
```

## SDK Tests — Agent Client

### client.test.ts

Test the `Wraith` and `WraithAgent` classes with a mock HTTP server.

| Test Case | Action | Expected |
|---|---|---|
| Create agent | `wraith.createAgent(config)` | POST /agent/create with config, returns WraithAgent |
| Chat | `agent.chat("hello")` | POST /agent/{id}/chat, returns ChatResponse |
| Auth header | Any request | `Authorization: Bearer wraith_...` present |
| AI header | Config with ai option | `X-AI-Provider` and `X-AI-Key` present |
| HTTP error | Server returns 400 | Throws with server error message |
| Export key | `agent.exportKey(sig, msg)` | POST /agent/{id}/export with signature |
| Get notifications | `agent.getNotifications()` | GET /agent/{id}/notifications |

## Contract Tests

### EVM (Hardhat + chai)

Run: `cd contracts && npx hardhat test`

| Contract | Test Coverage |
|---|---|
| ERC5564Announcer | Event emission, multiple callers, metadata preservation |
| ERC6538Registry | Register/lookup, EIP-712 delegation, replay prevention, nonce management, DOMAIN_SEPARATOR |
| WraithNames | Register/resolve, reverse lookup, duplicate rejection, name length (3-32), invalid chars, signature verification, update by owner, update by non-owner (reject), release + re-register |
| WraithSender | sendETH, sendERC20 with/without gas tip, batch operations, value mismatch rejection, length mismatch rejection |
| WraithWithdrawer | Revert on empty balance, revert on fee >= balance |

### Stellar (Rust native)

Run: `cd contracts/stealth-announcer && cargo test` (for each contract)

| Contract | Test Coverage |
|---|---|
| stealth-announcer | Event emission, different scheme IDs |
| stealth-registry | Register/lookup, wrong-length rejection, not-registered, update existing |
| stealth-sender | (integration tests deferred — requires announcer mock) |
| wraith-names | Register/resolve, name-taken, reverse lookup, release/re-register, invalid name validation |

## Integration Testing Checklist

End-to-end tests that verify the full system works across components:

### Agent Lifecycle
- [ ] Create agent → agent has address, meta-address, .wraith name
- [ ] Fund agent → faucet sends testnet tokens
- [ ] Chat "what's my balance?" → returns balance
- [ ] Chat "show my info" → returns agent identity card

### Stealth Payments
- [ ] Send stealth payment via chat → tx succeeds, announcement emitted
- [ ] Scan payments → detects the sent payment
- [ ] Withdraw specific amount → correct amount transferred, gas deducted
- [ ] Withdraw all → max amount transferred (balance minus gas)

### Invoicing
- [ ] Create invoice → returns payment link
- [ ] Pay invoice via Pay page → marks as paid, notification created
- [ ] Check invoices → shows paid status
- [ ] Duplicate paid call → no duplicate notification

### Agent-to-Agent
- [ ] Pay agent by .wraith name → resolves name, sends stealth payment
- [ ] Both agents can scan and see the payment

### Privacy
- [ ] Privacy check → returns score, issues, best practices
- [ ] Multiple stealth addresses → warns about consolidation risk
- [ ] Withdraw to connected wallet → warns about address linking

### Scheduled Payments
- [ ] Schedule daily payment → stored in DB
- [ ] List schedules → shows active schedule
- [ ] Cancel schedule → status changes to cancelled
- [ ] Scheduler cron fires → executes due payments

### Notifications
- [ ] Payment received → notification created
- [ ] Invoice paid → single notification (no duplicates)
- [ ] Mark read → unread count drops to 0
- [ ] Clear all → notifications deleted

### Key Export
- [ ] Export with valid signature → returns private key
- [ ] Export with wrong wallet signature → rejects
- [ ] Export without signature → rejects (400)

## Running All Tests

```bash
# SDK unit tests
cd packages/sdk && pnpm test

# Contract tests
cd contracts && npx hardhat test

# Stellar contract tests
cd stellar/contracts/stealth-announcer && cargo test
cd stellar/contracts/stealth-registry && cargo test
cd stellar/contracts/wraith-names && cargo test
```

## Expected Test Output

```
SDK:
 ✓ keys: derives valid keys from signature
 ✓ keys: deterministic derivation
 ✓ keys: spending != viewing
 ✓ keys: rejects wrong signature length
 ✓ stealth: generates valid stealth address
 ✓ stealth: deterministic with fixed ephemeral key
 ✓ stealth: different recipients → different addresses
 ✓ scan: matches own announcement
 ✓ scan: rejects wrong view tag
 ✓ scan: rejects wrong viewing key
 ✓ scan: skips wrong scheme ID
 ✓ spend: derived key controls stealth address
 ✓ spend: deterministic
 ✓ meta-address: encode/decode roundtrip
 ✓ meta-address: rejects invalid prefix
 ✓ meta-address: rejects wrong key length
 ✓ names: metaAddressToBytes strips prefix
 ✓ names: signNameRegistration produces valid sig
 ✓ e2e: full stealth payment flow
 All tests passed

Contracts:
 ERC5564Announcer: 3 passing
 ERC6538Registry: 8 passing
 WraithNames: 10 passing
 WraithSender: 7 passing
 WraithWithdrawer: 3 passing
 All tests passed
```
