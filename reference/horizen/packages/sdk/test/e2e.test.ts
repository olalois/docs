import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256, toHex, getAddress } from "viem";
import { deriveStealthKeys } from "../src/keys.js";
import {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from "../src/meta-address.js";
import { generateStealthAddress } from "../src/stealth.js";
import { scanAnnouncements } from "../src/scan.js";
import { deriveStealthPrivateKey } from "../src/spend.js";
import { SCHEME_ID } from "../src/constants.js";
import type { HexString, Announcement } from "../src/types.js";

describe("end-to-end stealth address flow", () => {
  // Simulate a wallet signature (65 bytes)
  const walletSignature: HexString =
    "0xaa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc55dd66ee77ff88aa99bb00cc11dd22ee33ff44aa55bb66cc77dd88ee99ff00aa11bb221c";

  it("full flow: derive keys → encode meta-address → generate stealth → scan → spend", () => {
    // Recipient derives their stealth keys from a wallet signature
    const recipientKeys = deriveStealthKeys(walletSignature);

    // Recipient publishes their stealth meta-address
    const metaAddress = encodeStealthMetaAddress(
      recipientKeys.spendingPubKey,
      recipientKeys.viewingPubKey
    );

    // Sender decodes the meta-address
    const decoded = decodeStealthMetaAddress(metaAddress);
    expect(decoded.spendingPubKey.toLowerCase()).toBe(
      recipientKeys.spendingPubKey.toLowerCase()
    );
    expect(decoded.viewingPubKey.toLowerCase()).toBe(
      recipientKeys.viewingPubKey.toLowerCase()
    );

    // Sender generates a stealth address
    const ephemeralPrivateKey =
      "0x6666666666666666666666666666666666666666666666666666666666666666" as HexString;
    const generated = generateStealthAddress(
      decoded.spendingPubKey,
      decoded.viewingPubKey,
      ephemeralPrivateKey
    );

    // Sender creates an on-chain announcement
    const viewTagHex = generated.viewTag.toString(16).padStart(2, "0");
    const announcement: Announcement = {
      schemeId: SCHEME_ID,
      stealthAddress: generated.stealthAddress,
      caller: "0x0000000000000000000000000000000000000001" as HexString,
      ephemeralPubKey: generated.ephemeralPubKey,
      metadata: `0x${viewTagHex}${"00".repeat(56)}` as HexString,
    };

    // Recipient scans announcements and finds the match
    const matched = scanAnnouncements(
      [announcement],
      recipientKeys.viewingKey,
      recipientKeys.spendingPubKey,
      recipientKeys.spendingKey
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].stealthAddress.toLowerCase()).toBe(
      generated.stealthAddress.toLowerCase()
    );

    // Verify the derived spending key controls the stealth address
    const stealthPrivKey = matched[0].stealthPrivateKey;
    const derivedPubKey = secp256k1.getPublicKey(
      stealthPrivKey.slice(2),
      false
    );
    const pubKeyNoPrefix = derivedPubKey.slice(1);
    const addressHash = keccak256(toHex(pubKeyNoPrefix));
    const derivedAddress = getAddress(`0x${addressHash.slice(-40)}`);

    expect(derivedAddress.toLowerCase()).toBe(
      generated.stealthAddress.toLowerCase()
    );
  });

  it("independently derived spending key matches scan result", () => {
    const recipientKeys = deriveStealthKeys(walletSignature);

    const ephemeralPrivateKey =
      "0x7777777777777777777777777777777777777777777777777777777777777777" as HexString;
    const generated = generateStealthAddress(
      recipientKeys.spendingPubKey,
      recipientKeys.viewingPubKey,
      ephemeralPrivateKey
    );

    // Derive spending key directly (not via scan)
    const directKey = deriveStealthPrivateKey(
      recipientKeys.spendingKey,
      generated.ephemeralPubKey,
      recipientKeys.viewingKey
    );

    // Derive via scan
    const viewTagHex = generated.viewTag.toString(16).padStart(2, "0");
    const matched = scanAnnouncements(
      [
        {
          schemeId: SCHEME_ID,
          stealthAddress: generated.stealthAddress,
          caller: "0x0000000000000000000000000000000000000001" as HexString,
          ephemeralPubKey: generated.ephemeralPubKey,
          metadata: `0x${viewTagHex}` as HexString,
        },
      ],
      recipientKeys.viewingKey,
      recipientKeys.spendingPubKey,
      recipientKeys.spendingKey
    );

    expect(matched).toHaveLength(1);
    expect(directKey).toBe(matched[0].stealthPrivateKey);
  });
});
