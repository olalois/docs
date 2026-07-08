# @wraith-horizen/sdk

Stealth address cryptography for Horizen. Pure TypeScript, no RPC calls, wallet-agnostic.

Built on [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) and [ERC-6538](https://eips.ethereum.org/EIPS/eip-6538) using the secp256k1 scheme.

## Install

```bash
npm install @wraith-horizen/sdk
```

## Usage

### Derive stealth keys from a wallet signature

```ts
import { deriveStealthKeys, encodeStealthMetaAddress, STEALTH_SIGNING_MESSAGE } from "@wraith-horizen/sdk";

// Have the user sign this message with their wallet
const signature = await wallet.signMessage(STEALTH_SIGNING_MESSAGE);

// Derive spending + viewing keys
const keys = deriveStealthKeys(signature);

// Encode the meta-address to share publicly
const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
// "st:eth:0x..."
```

### Generate a stealth address (sender)

```ts
import { generateStealthAddress, decodeStealthMetaAddress } from "@wraith-horizen/sdk";

const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(recipientMetaAddress);

const { stealthAddress, ephemeralPubKey, viewTag } = generateStealthAddress(
  spendingPubKey,
  viewingPubKey,
);

// Send funds to stealthAddress
// Call announce() on the ERC-5564 contract with ephemeralPubKey and viewTag
```

### Scan announcements (recipient)

```ts
import { scanAnnouncements } from "@wraith-horizen/sdk";

const matched = scanAnnouncements(
  announcements, // from the ERC-5564 contract events
  keys.viewingKey,
  keys.spendingPubKey,
  keys.spendingKey,
);

// matched[].stealthAddress — the address that belongs to you
// matched[].stealthPrivateKey — the key to spend from it
```

### Derive a spending key directly

```ts
import { deriveStealthPrivateKey } from "@wraith-horizen/sdk";

const stealthPrivateKey = deriveStealthPrivateKey(
  keys.spendingKey,
  ephemeralPubKey, // from the announcement
  keys.viewingKey,
);
```

### Register a Wraith name

```ts
import { signNameRegistration, metaAddressToBytes } from "@wraith-horizen/sdk";

const metaBytes = metaAddressToBytes(metaAddress);
const signature = signNameRegistration("yourname", metaBytes, keys.spendingKey);

// Submit to the WraithNames contract: register("yourname", metaBytes, signature)
```

### Sponsored name registration (via relayer)

```ts
import { signNameRegistrationOnBehalf, metaAddressToBytes } from "@wraith-horizen/sdk";

const metaBytes = metaAddressToBytes(metaAddress);
const signature = signNameRegistrationOnBehalf("yourname", metaBytes, keys.spendingKey, nonce);

// Send { name, stealthMetaAddress: metaBytes, signature } to the relayer
```

### Update or release a name

```ts
import { signNameUpdate, signNameRelease, metaAddressToBytes } from "@wraith-horizen/sdk";

// Update: point name to a new meta-address
const newMetaBytes = metaAddressToBytes(newMetaAddress);
const updateSig = signNameUpdate("yourname", newMetaBytes, keys.spendingKey);

// Release: give up the name
const releaseSig = signNameRelease("yourname", keys.spendingKey);
```

## API

| Function | Description |
|---|---|
| `deriveStealthKeys(signature)` | Derive spending/viewing key pairs from a 65-byte wallet signature |
| `encodeStealthMetaAddress(spendPub, viewPub)` | Encode two public keys into a `st:eth:0x...` meta-address string |
| `decodeStealthMetaAddress(metaAddress)` | Decode a meta-address back into its component public keys |
| `generateStealthAddress(spendPub, viewPub)` | Generate a one-time stealth address for a recipient |
| `checkStealthAddress(ephPub, viewKey, spendPub, viewTag)` | Check if a single announcement matches the recipient |
| `scanAnnouncements(anns, viewKey, spendPub, spendKey)` | Scan a list of announcements and return matches with spending keys |
| `deriveStealthPrivateKey(spendKey, ephPub, viewKey)` | Derive the private key that controls a stealth address |
| `signNameRegistration(name, metaBytes, spendKey)` | Sign a name registration for the WraithNames contract |
| `signNameRegistrationOnBehalf(name, metaBytes, spendKey, nonce)` | Sign a name registration for relayer-sponsored submission |
| `signNameUpdate(name, newMetaBytes, spendKey)` | Sign a name update to point to a new meta-address |
| `signNameRelease(name, spendKey)` | Sign a name release to free up the name |
| `metaAddressToBytes(metaAddress)` | Strip the `st:eth:0x` prefix and return raw hex bytes |

## Design

The SDK is pure computation. It makes no RPC calls, holds no state, and works with any wallet library (viem, ethers, or raw signatures). You control the provider and chain interaction.

Dependencies: `@noble/curves` for EC math, `viem` for keccak256/address utilities.

## License

MIT
