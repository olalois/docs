import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { toHex } from "viem";
import { generateStealthAddress } from "../src/stealth.js";
import type { HexString } from "../src/types.js";

// Fixed test keys
const spendPrivHex =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const viewPrivHex =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const ephPrivHex =
  "0x3333333333333333333333333333333333333333333333333333333333333333";

const spendPub = toHex(
  secp256k1.getPublicKey(spendPrivHex.slice(2), true)
) as HexString;
const viewPub = toHex(
  secp256k1.getPublicKey(viewPrivHex.slice(2), true)
) as HexString;

describe("generateStealthAddress", () => {
  it("should generate a valid stealth address", () => {
    const result = generateStealthAddress(spendPub, viewPub, ephPrivHex as HexString);

    // Stealth address is a valid Ethereum address
    expect(result.stealthAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // Ephemeral public key is 33-byte compressed
    expect(result.ephemeralPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);

    // View tag is a single byte
    expect(result.viewTag).toBeGreaterThanOrEqual(0);
    expect(result.viewTag).toBeLessThanOrEqual(255);
  });

  it("should be deterministic with fixed ephemeral key", () => {
    const result1 = generateStealthAddress(spendPub, viewPub, ephPrivHex as HexString);
    const result2 = generateStealthAddress(spendPub, viewPub, ephPrivHex as HexString);

    expect(result1.stealthAddress).toBe(result2.stealthAddress);
    expect(result1.ephemeralPubKey).toBe(result2.ephemeralPubKey);
    expect(result1.viewTag).toBe(result2.viewTag);
  });

  it("should produce different addresses for different ephemeral keys", () => {
    const eph2 =
      "0x4444444444444444444444444444444444444444444444444444444444444444" as HexString;

    const result1 = generateStealthAddress(spendPub, viewPub, ephPrivHex as HexString);
    const result2 = generateStealthAddress(spendPub, viewPub, eph2);

    expect(result1.stealthAddress).not.toBe(result2.stealthAddress);
  });

  it("should produce different addresses for different recipients", () => {
    const otherSpendPriv =
      "0x5555555555555555555555555555555555555555555555555555555555555555";
    const otherSpendPub = toHex(
      secp256k1.getPublicKey(otherSpendPriv.slice(2), true)
    ) as HexString;

    const result1 = generateStealthAddress(spendPub, viewPub, ephPrivHex as HexString);
    const result2 = generateStealthAddress(
      otherSpendPub,
      viewPub,
      ephPrivHex as HexString
    );

    expect(result1.stealthAddress).not.toBe(result2.stealthAddress);
  });

  it("should generate random addresses when no ephemeral key provided", () => {
    const result1 = generateStealthAddress(spendPub, viewPub);
    const result2 = generateStealthAddress(spendPub, viewPub);

    // Extremely unlikely to collide
    expect(result1.stealthAddress).not.toBe(result2.stealthAddress);
  });
});
