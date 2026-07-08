import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256, toHex, toBytes, getAddress } from "viem";
import { deriveStealthPrivateKey } from "../src/spend.js";
import { generateStealthAddress } from "../src/stealth.js";
import type { HexString } from "../src/types.js";

const spendPrivHex =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as HexString;
const viewPrivHex =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as HexString;
const ephPrivHex =
  "0x3333333333333333333333333333333333333333333333333333333333333333" as HexString;

const spendPub = toHex(
  secp256k1.getPublicKey(spendPrivHex.slice(2), true)
) as HexString;
const viewPub = toHex(
  secp256k1.getPublicKey(viewPrivHex.slice(2), true)
) as HexString;

describe("deriveStealthPrivateKey", () => {
  it("should derive a valid 32-byte private key", () => {
    const generated = generateStealthAddress(spendPub, viewPub, ephPrivHex);

    const stealthPrivKey = deriveStealthPrivateKey(
      spendPrivHex,
      generated.ephemeralPubKey,
      viewPrivHex
    );

    expect(stealthPrivKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("should derive a key that controls the stealth address", () => {
    const generated = generateStealthAddress(spendPub, viewPub, ephPrivHex);

    const stealthPrivKey = deriveStealthPrivateKey(
      spendPrivHex,
      generated.ephemeralPubKey,
      viewPrivHex
    );

    // Derive the public key from the stealth private key
    const derivedPubKey = secp256k1.getPublicKey(stealthPrivKey.slice(2), false);
    // Get the address: keccak256(pubkey without 04 prefix)[12:]
    const pubKeyNoPrefix = derivedPubKey.slice(1);
    const addressHash = keccak256(toHex(pubKeyNoPrefix));
    const derivedAddress = getAddress(`0x${addressHash.slice(-40)}`);

    expect(derivedAddress.toLowerCase()).toBe(
      generated.stealthAddress.toLowerCase()
    );
  });

  it("should be deterministic", () => {
    const generated = generateStealthAddress(spendPub, viewPub, ephPrivHex);

    const key1 = deriveStealthPrivateKey(
      spendPrivHex,
      generated.ephemeralPubKey,
      viewPrivHex
    );
    const key2 = deriveStealthPrivateKey(
      spendPrivHex,
      generated.ephemeralPubKey,
      viewPrivHex
    );

    expect(key1).toBe(key2);
  });
});
