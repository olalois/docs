import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { deriveStealthKeys } from "../src/keys.js";
import type { HexString } from "../src/types.js";

describe("deriveStealthKeys", () => {
  // A fixed 65-byte signature for deterministic testing
  // 65 bytes = 130 hex chars
  const testSignature: HexString = `0x${"ab".repeat(32)}${"cd".repeat(32)}1c` as HexString;

  it("should derive valid spending and viewing keys", () => {
    const keys = deriveStealthKeys(testSignature);

    // Keys should be 32-byte hex strings (0x + 64 chars)
    expect(keys.spendingKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(keys.viewingKey).toMatch(/^0x[0-9a-f]{64}$/);

    // Public keys should be 33-byte compressed (0x + 66 chars)
    expect(keys.spendingPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
    expect(keys.viewingPubKey).toMatch(/^0x(02|03)[0-9a-f]{64}$/);
  });

  it("should produce different spending and viewing keys", () => {
    const keys = deriveStealthKeys(testSignature);
    expect(keys.spendingKey).not.toEqual(keys.viewingKey);
    expect(keys.spendingPubKey).not.toEqual(keys.viewingPubKey);
  });

  it("should be deterministic — same signature always gives same keys", () => {
    const keys1 = deriveStealthKeys(testSignature);
    const keys2 = deriveStealthKeys(testSignature);

    expect(keys1).toEqual(keys2);
  });

  it("should derive public keys that are valid secp256k1 points", () => {
    const keys = deriveStealthKeys(testSignature);

    // These should not throw
    const spendPoint = secp256k1.ProjectivePoint.fromHex(
      keys.spendingPubKey.slice(2)
    );
    const viewPoint = secp256k1.ProjectivePoint.fromHex(
      keys.viewingPubKey.slice(2)
    );

    // Points should be on the curve (fromHex validates this)
    expect(spendPoint).toBeDefined();
    expect(viewPoint).toBeDefined();
  });

  it("should reject signatures that are not 65 bytes", () => {
    expect(() => deriveStealthKeys("0xabcd" as HexString)).toThrow(
      "Expected 65-byte signature"
    );
    expect(() =>
      deriveStealthKeys(("0x" + "ab".repeat(64)) as HexString)
    ).toThrow("Expected 65-byte signature");
  });
});
