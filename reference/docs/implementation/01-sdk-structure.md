# 01 — SDK Package Structure

## Overview

Single npm package `@wraith-protocol/sdk` with multiple entry points via `package.json` exports.

## Directory Layout

```
packages/sdk/
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts                    ← root: agent client SDK
    agent/
      index.ts                  ← re-exports for @wraith-protocol/sdk
      client.ts                 ← Wraith class (API client)
      types.ts                  ← agent types (AgentInfo, ChatResponse, etc.)
    chains/
      evm/
        index.ts                ← re-exports for @wraith-protocol/sdk/chains/evm
        constants.ts            ← SCHEME_ID=1, META_ADDRESS_PREFIX="st:eth:0x"
        types.ts                ← HexString, StealthKeys, Announcement, etc.
        keys.ts                 ← deriveStealthKeys (secp256k1)
        stealth.ts              ← generateStealthAddress
        scan.ts                 ← checkStealthAddress, scanAnnouncements
        spend.ts                ← deriveStealthPrivateKey
        meta-address.ts         ← encode/decode stealth meta-address
        names.ts                ← signNameRegistration, metaAddressToBytes
      stellar/
        index.ts                ← re-exports for @wraith-protocol/sdk/chains/stellar
        constants.ts            ← SCHEME_ID=1, META_ADDRESS_PREFIX="st:xlm:"
        types.ts                ← StealthKeys (Uint8Array-based), Announcement
        keys.ts                 ← deriveStealthKeys (ed25519)
        stealth.ts              ← generateStealthAddress, computeSharedSecret
        scan.ts                 ← checkStealthAddress, scanAnnouncements
        spend.ts                ← deriveStealthPrivateScalar, signStellarTransaction
        meta-address.ts         ← encode/decode stealth meta-address
        scalar.ts               ← seedToScalar, hashToScalar, signWithScalar, L
        utils.ts                ← bytesToHex, hexToBytes
```

## package.json

```json
{
  "name": "@wraith-protocol/sdk",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./chains/evm": {
      "types": "./dist/chains/evm/index.d.ts",
      "import": "./dist/chains/evm/index.js",
      "require": "./dist/chains/evm/index.cjs"
    },
    "./chains/stellar": {
      "types": "./dist/chains/stellar/index.d.ts",
      "import": "./dist/chains/stellar/index.js",
      "require": "./dist/chains/stellar/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@noble/curves": "^1.8.0",
    "@noble/hashes": "^1.7.0",
    "viem": "^2.23.0"
  },
  "peerDependencies": {
    "@stellar/stellar-sdk": "^13.1.0"
  },
  "peerDependenciesMeta": {
    "@stellar/stellar-sdk": {
      "optional": true
    }
  },
  "devDependencies": {
    "@stellar/stellar-sdk": "^13.1.0",
    "tsup": "^8.4.0",
    "typescript": "^5.7.0",
    "vitest": "^3.1.0"
  }
}
```

Key decisions:
- `@stellar/stellar-sdk` is an optional peer dependency — only needed if importing `@wraith-protocol/sdk/chains/stellar`
- `viem` is a direct dependency — needed for EVM crypto and the agent client's type utilities
- `@noble/curves` and `@noble/hashes` are direct — used by both EVM and Stellar

## tsup.config.ts

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "chains/evm/index": "src/chains/evm/index.ts",
    "chains/stellar/index": "src/chains/stellar/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: true,
  clean: true,
  treeshake: true,
});
```

## Entry Point Contents

### `src/index.ts` (root — agent client)

```ts
export { Wraith } from "./agent/client";
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
} from "./agent/types";
```

### `src/chains/evm/index.ts`

```ts
export { deriveStealthKeys } from "./keys";
export { STEALTH_SIGNING_MESSAGE, SCHEME_ID, META_ADDRESS_PREFIX } from "./constants";
export { encodeStealthMetaAddress, decodeStealthMetaAddress } from "./meta-address";
export { generateStealthAddress } from "./stealth";
export { checkStealthAddress, scanAnnouncements } from "./scan";
export { deriveStealthPrivateKey } from "./spend";
export {
  signNameRegistration,
  signNameRegistrationOnBehalf,
  signNameUpdate,
  signNameRelease,
  metaAddressToBytes,
} from "./names";
export type {
  HexString,
  StealthKeys,
  StealthMetaAddress,
  GeneratedStealthAddress,
  Announcement,
  MatchedAnnouncement,
} from "./types";
```

### `src/chains/stellar/index.ts`

```ts
export { deriveStealthKeys } from "./keys";
export { STEALTH_SIGNING_MESSAGE, SCHEME_ID, META_ADDRESS_PREFIX } from "./constants";
export { encodeStealthMetaAddress, decodeStealthMetaAddress } from "./meta-address";
export { generateStealthAddress, computeSharedSecret, computeViewTag } from "./stealth";
export { checkStealthAddress, scanAnnouncements } from "./scan";
export { deriveStealthPrivateScalar, signStellarTransaction } from "./spend";
export { seedToScalar, hashToScalar, deriveStealthPubKey, pubKeyToStellarAddress, signWithScalar, L } from "./scalar";
export { bytesToHex, hexToBytes } from "./utils";
export type {
  HexString,
  StealthKeys,
  StealthMetaAddress,
  GeneratedStealthAddress,
  Announcement,
  MatchedAnnouncement,
} from "./types";
```

## Build Verification

After setup:
```bash
pnpm build
```

Expected outputs in `dist/`:
```
dist/
  index.js          # agent client (ESM)
  index.cjs         # agent client (CJS)
  index.d.ts        # agent client types
  chains/
    evm/
      index.js      # EVM crypto (ESM)
      index.cjs     # EVM crypto (CJS)
      index.d.ts    # EVM crypto types
    stellar/
      index.js      # Stellar crypto (ESM)
      index.cjs     # Stellar crypto (CJS)
      index.d.ts    # Stellar crypto types
```

Verify imports work:
```ts
// Should resolve without errors
import { Wraith } from "@wraith-protocol/sdk";
import { generateStealthAddress } from "@wraith-protocol/sdk/chains/evm";
import { deriveStealthKeys } from "@wraith-protocol/sdk/chains/stellar";
```
