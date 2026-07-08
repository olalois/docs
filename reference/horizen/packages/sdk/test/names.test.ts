import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { toHex, keccak256, encodePacked, toBytes } from "viem";
import {
  signNameRegistration,
  signNameRegistrationOnBehalf,
  signNameUpdate,
  signNameRelease,
  metaAddressToBytes,
} from "../src/names.js";
import type { HexString } from "../src/types.js";

const spendPrivHex =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as HexString;
const viewPrivHex =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as HexString;

const spendPub = toHex(
  secp256k1.getPublicKey(spendPrivHex.slice(2), true)
) as HexString;
const viewPub = toHex(
  secp256k1.getPublicKey(viewPrivHex.slice(2), true)
) as HexString;

const metaAddress = `st:eth:0x${spendPub.slice(2)}${viewPub.slice(2)}`;
const metaBytes = metaAddressToBytes(metaAddress);

describe("metaAddressToBytes", () => {
  it("should extract raw bytes from st:eth:0x format", () => {
    expect(metaBytes).toMatch(/^0x[0-9a-f]{132}$/);
    expect(metaBytes.length).toBe(2 + 132); // 0x + 66 bytes hex
  });

  it("should reject invalid format", () => {
    expect(() => metaAddressToBytes("0xabcd")).toThrow("Invalid meta-address format");
  });
});

describe("signNameRegistration", () => {
  it("should return a 65-byte signature", () => {
    const sig = signNameRegistration("truth", metaBytes, spendPrivHex);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("should be deterministic", () => {
    const sig1 = signNameRegistration("truth", metaBytes, spendPrivHex);
    const sig2 = signNameRegistration("truth", metaBytes, spendPrivHex);
    expect(sig1).toBe(sig2);
  });

  it("should differ for different names", () => {
    const sig1 = signNameRegistration("alice", metaBytes, spendPrivHex);
    const sig2 = signNameRegistration("bob", metaBytes, spendPrivHex);
    expect(sig1).not.toBe(sig2);
  });
});

describe("signNameRegistrationOnBehalf", () => {
  it("should include nonce in the signature", () => {
    const sig0 = signNameRegistrationOnBehalf("relayed", metaBytes, spendPrivHex, 0n);
    const sig1 = signNameRegistrationOnBehalf("relayed", metaBytes, spendPrivHex, 1n);
    expect(sig0).not.toBe(sig1);
  });
});

describe("signNameUpdate", () => {
  it("should return a valid signature", () => {
    const newMetaBytes = `0x${"ab".repeat(66)}` as HexString;
    const sig = signNameUpdate("truth", newMetaBytes, spendPrivHex);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });
});

describe("signNameRelease", () => {
  it("should return a valid signature", () => {
    const sig = signNameRelease("truth", spendPrivHex);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
