import {
  computeSharedSecret,
  computeViewTag,
} from "./stealth";
import {
  hashToScalar,
  deriveStealthPubKey,
  pubKeyToStellarAddress,
  L,
} from "./scalar";
import { SCHEME_ID } from "./constants";
import type { Announcement, MatchedAnnouncement } from "./types";
import { hexToBytes } from "./utils";

/**
 * Checks whether a single announcement belongs to the recipient.
 *
 * Uses only the viewing key and spending PUBLIC key (no spending private key):
 *   1. Compute shared secret: S = ECDH(viewing_key, R_ephemeral)
 *   2. View tag quick filter (eliminates ~255/256 non-matches)
 *   3. Compute hash_scalar = SHA-256("wraith:scalar:" || S) mod L
 *   4. Expected stealth pubkey = K_spend + hash_scalar * G
 *   5. Compare with announced stealth address
 *
 * This is view-only: it can detect payments but NOT derive the spending key.
 */
export function checkStealthAddress(
  ephemeralPubKey: Uint8Array,
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  viewTag: number
): {
  isMatch: boolean;
  stealthAddress: string | null;
  hashScalar: bigint | null;
  stealthPubKeyBytes: Uint8Array | null;
} {
  // S = ECDH(viewing_key, ephemeral_pubkey)
  const sharedSecret = computeSharedSecret(viewingKey, ephemeralPubKey);

  // View tag check — eliminates ~255/256 of non-matching announcements
  const computedTag = computeViewTag(sharedSecret);
  if (computedTag !== viewTag) {
    return { isMatch: false, stealthAddress: null, hashScalar: null, stealthPubKeyBytes: null };
  }

  // hash_scalar = SHA-256("wraith:scalar:" || S) mod L
  const hScalar = hashToScalar(sharedSecret);

  // P_stealth = K_spend + hash_scalar * G  (point addition, public keys only)
  const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);
  const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);

  return { isMatch: true, stealthAddress, hashScalar: hScalar, stealthPubKeyBytes };
}

/**
 * Scans a list of on-chain announcements to find those belonging to the recipient.
 *
 * Requires the spending SCALAR (not just public key) to derive the stealth
 * private scalar for each match. This is the key separation:
 *   - Scanning (detection) needs: viewing_key + spending_pubkey
 *   - Spending needs: spending_scalar
 *
 * The stealth private scalar is: (spending_scalar + hash_scalar) mod L
 * This matches the EVM version: p_stealth = (m + s_h) mod n
 */
export function scanAnnouncements(
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint
): MatchedAnnouncement[] {
  const matched: MatchedAnnouncement[] = [];

  for (const ann of announcements) {
    if (ann.schemeId !== SCHEME_ID) continue;

    // Extract view tag from first byte of metadata
    const metadataBytes = hexToBytes(ann.metadata);
    if (metadataBytes.length === 0) continue;
    const viewTag = metadataBytes[0];

    // Parse ephemeral pubkey from hex
    const ephPubKey = hexToBytes(ann.ephemeralPubKey);
    if (ephPubKey.length !== 32) continue;

    const result = checkStealthAddress(
      ephPubKey,
      viewingKey,
      spendingPubKey,
      viewTag
    );

    if (
      result.isMatch &&
      result.stealthAddress === ann.stealthAddress &&
      result.hashScalar !== null &&
      result.stealthPubKeyBytes !== null
    ) {
      // Derive the stealth private scalar: (spending_scalar + hash_scalar) mod L
      const stealthPrivateScalar =
        (spendingScalar + result.hashScalar) % L;

      matched.push({
        ...ann,
        stealthPrivateScalar,
        stealthPubKeyBytes: result.stealthPubKeyBytes,
      });
    }
  }

  return matched;
}
