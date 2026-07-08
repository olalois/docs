import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { toHex } from "viem";
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from "../src/meta-address.js";
import { META_ADDRESS_PREFIX } from "../src/constants.js";
import type { HexString } from "../src/types.js";

// Generate deterministic test keys
const spendPriv = BigInt(
  "0x1111111111111111111111111111111111111111111111111111111111111111"
);
const viewPriv = BigInt(
  "0x2222222222222222222222222222222222222222222222222222222222222222"
);
const spendPub = toHex(
  secp256k1.getPublicKey(
    spendPriv.toString(16).padStart(64, "0"),
    true
  )
) as HexString;
const viewPub = toHex(
  secp256k1.getPublicKey(
    viewPriv.toString(16).padStart(64, "0"),
    true
  )
) as HexString;

describe("encodeStealthMetaAddress", () => {
  it("should encode spending and viewing keys into a meta-address", () => {
    const encoded = encodeStealthMetaAddress(spendPub, viewPub);

    expect(encoded.startsWith(META_ADDRESS_PREFIX)).toBe(true);
    // 8 chars prefix ("st:eth:0x") + 66 chars spending + 66 chars viewing = 140
    expect(encoded.length).toBe(8 + 1 + 132); // "st:eth:0x" = 9 chars + 132 hex
  });

  it("should reject keys that are not 33 bytes", () => {
    expect(() =>
      encodeStealthMetaAddress("0xabcd" as HexString, viewPub)
    ).toThrow("33 bytes");
  });
});

describe("decodeStealthMetaAddress", () => {
  it("should decode a valid meta-address back to component keys", () => {
    const encoded = encodeStealthMetaAddress(spendPub, viewPub);
    const decoded = decodeStealthMetaAddress(encoded);

    expect(decoded.prefix).toBe(META_ADDRESS_PREFIX);
    expect(decoded.spendingPubKey.toLowerCase()).toBe(
      spendPub.toLowerCase()
    );
    expect(decoded.viewingPubKey.toLowerCase()).toBe(viewPub.toLowerCase());
  });

  it("should roundtrip encode/decode", () => {
    const encoded = encodeStealthMetaAddress(spendPub, viewPub);
    const decoded = decodeStealthMetaAddress(encoded);
    const reEncoded = encodeStealthMetaAddress(
      decoded.spendingPubKey,
      decoded.viewingPubKey
    );

    expect(reEncoded).toBe(encoded);
  });

  it("should reject invalid prefix", () => {
    expect(() => decodeStealthMetaAddress("bad:prefix:0xabcd")).toThrow(
      "Invalid stealth meta-address prefix"
    );
  });

  it("should reject invalid length", () => {
    expect(() =>
      decodeStealthMetaAddress(`${META_ADDRESS_PREFIX}${"ab".repeat(30)}`)
    ).toThrow("Invalid stealth meta-address length");
  });

  it("should reject keys that are not valid curve points", () => {
    // 66 bytes of zeros is not a valid compressed point
    const invalidMeta = `${META_ADDRESS_PREFIX}${"00".repeat(66)}`;
    expect(() => decodeStealthMetaAddress(invalidMeta)).toThrow();
  });
});
