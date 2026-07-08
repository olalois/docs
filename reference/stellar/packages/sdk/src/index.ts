// Key derivation
export { deriveStealthKeys } from "./keys";

// Constants
export {
  STEALTH_SIGNING_MESSAGE,
  SCHEME_ID,
  META_ADDRESS_PREFIX,
} from "./constants";

// Meta-address encoding
export {
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from "./meta-address";

// Stealth address generation (sender)
export {
  generateStealthAddress,
  computeSharedSecret,
  computeViewTag,
} from "./stealth";

// Announcement scanning (recipient)
export { checkStealthAddress, scanAnnouncements } from "./scan";

// Spending key derivation + signing (recipient)
export { deriveStealthPrivateScalar, signStellarTransaction } from "./spend";

// Scalar arithmetic
export {
  seedToScalar,
  hashToScalar,
  deriveStealthPubKey,
  pubKeyToStellarAddress,
  signWithScalar,
  L,
} from "./scalar";

// Utilities
export { bytesToHex, hexToBytes } from "./utils";

// Types
export type {
  HexString,
  StealthKeys,
  StealthMetaAddress,
  GeneratedStealthAddress,
  Announcement,
  MatchedAnnouncement,
} from "./types";
