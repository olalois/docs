import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { toHex } from "viem";
import { checkStealthAddress, scanAnnouncements } from "../src/scan.js";
import { generateStealthAddress } from "../src/stealth.js";
import { SCHEME_ID } from "../src/constants.js";
import type { HexString, Announcement } from "../src/types.js";

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

describe("checkStealthAddress", () => {
  it("should match a valid announcement", () => {
    const generated = generateStealthAddress(spendPub, viewPub, ephPrivHex);

    const result = checkStealthAddress(
      generated.ephemeralPubKey,
      viewPrivHex,
      spendPub,
      generated.viewTag
    );

    expect(result.isMatch).toBe(true);
    expect(result.stealthAddress?.toLowerCase()).toBe(
      generated.stealthAddress.toLowerCase()
    );
  });

  it("should not match with wrong view tag", () => {
    const generated = generateStealthAddress(spendPub, viewPub, ephPrivHex);
    const wrongViewTag = (generated.viewTag + 1) % 256;

    const result = checkStealthAddress(
      generated.ephemeralPubKey,
      viewPrivHex,
      spendPub,
      wrongViewTag
    );

    expect(result.isMatch).toBe(false);
    expect(result.stealthAddress).toBeNull();
  });

  it("should not match with wrong viewing key", () => {
    const generated = generateStealthAddress(spendPub, viewPub, ephPrivHex);
    const wrongViewKey =
      "0x4444444444444444444444444444444444444444444444444444444444444444" as HexString;

    // This will either not match the view tag or produce a different address
    const result = checkStealthAddress(
      generated.ephemeralPubKey,
      wrongViewKey,
      spendPub,
      generated.viewTag
    );

    // If the view tag happens to match (1/256 chance), the address should still differ
    if (result.isMatch) {
      expect(result.stealthAddress?.toLowerCase()).not.toBe(
        generated.stealthAddress.toLowerCase()
      );
    }
  });
});

describe("scanAnnouncements", () => {
  it("should find matching announcements", () => {
    const generated = generateStealthAddress(spendPub, viewPub, ephPrivHex);

    // Build metadata: view tag as first byte
    const viewTagHex = generated.viewTag.toString(16).padStart(2, "0");
    const metadata = `0x${viewTagHex}${"00".repeat(56)}` as HexString;

    const announcements: Announcement[] = [
      {
        schemeId: SCHEME_ID,
        stealthAddress: generated.stealthAddress,
        caller: "0x0000000000000000000000000000000000000001" as HexString,
        ephemeralPubKey: generated.ephemeralPubKey,
        metadata,
      },
    ];

    const matched = scanAnnouncements(
      announcements,
      viewPrivHex,
      spendPub,
      spendPrivHex
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress.toLowerCase()).toBe(
      generated.stealthAddress.toLowerCase()
    );
    expect(matched[0].stealthPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("should skip announcements with wrong scheme ID", () => {
    const generated = generateStealthAddress(spendPub, viewPub, ephPrivHex);
    const viewTagHex = generated.viewTag.toString(16).padStart(2, "0");
    const metadata = `0x${viewTagHex}` as HexString;

    const announcements: Announcement[] = [
      {
        schemeId: 999n, // wrong scheme
        stealthAddress: generated.stealthAddress,
        caller: "0x0000000000000000000000000000000000000001" as HexString,
        ephemeralPubKey: generated.ephemeralPubKey,
        metadata,
      },
    ];

    const matched = scanAnnouncements(
      announcements,
      viewPrivHex,
      spendPub,
      spendPrivHex
    );

    expect(matched).toHaveLength(0);
  });

  it("should handle mixed matching and non-matching announcements", () => {
    const generated = generateStealthAddress(spendPub, viewPub, ephPrivHex);
    const viewTagHex = generated.viewTag.toString(16).padStart(2, "0");

    // Different ephemeral key for a non-matching announcement
    const otherEphPriv =
      "0x5555555555555555555555555555555555555555555555555555555555555555" as HexString;
    const otherGenerated = generateStealthAddress(
      spendPub,
      viewPub,
      otherEphPriv
    );
    const otherViewTagHex = otherGenerated.viewTag
      .toString(16)
      .padStart(2, "0");

    const announcements: Announcement[] = [
      // Matching
      {
        schemeId: SCHEME_ID,
        stealthAddress: generated.stealthAddress,
        caller: "0x0000000000000000000000000000000000000001" as HexString,
        ephemeralPubKey: generated.ephemeralPubKey,
        metadata: `0x${viewTagHex}` as HexString,
      },
      // Non-matching (random address, wrong ephemeral key combo)
      {
        schemeId: SCHEME_ID,
        stealthAddress:
          "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as HexString,
        caller: "0x0000000000000000000000000000000000000002" as HexString,
        ephemeralPubKey: generated.ephemeralPubKey,
        metadata: "0xaa" as HexString,
      },
      // Also matching (different ephemeral key)
      {
        schemeId: SCHEME_ID,
        stealthAddress: otherGenerated.stealthAddress,
        caller: "0x0000000000000000000000000000000000000003" as HexString,
        ephemeralPubKey: otherGenerated.ephemeralPubKey,
        metadata: `0x${otherViewTagHex}` as HexString,
      },
    ];

    const matched = scanAnnouncements(
      announcements,
      viewPrivHex,
      spendPub,
      spendPrivHex
    );

    expect(matched).toHaveLength(2);
  });
});
