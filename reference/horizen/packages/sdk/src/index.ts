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
export { generateStealthAddress } from "./stealth";

// Announcement scanning (recipient)
export { checkStealthAddress, scanAnnouncements } from "./scan";

// Spending key derivation (recipient)
export { deriveStealthPrivateKey } from "./spend";

// Name registration signing
export {
  signNameRegistration,
  signNameRegistrationOnBehalf,
  signNameUpdate,
  signNameRelease,
  metaAddressToBytes,
} from "./names";

// Types
export type {
  HexString,
  StealthKeys,
  StealthMetaAddress,
  GeneratedStealthAddress,
  Announcement,
  MatchedAnnouncement,
} from "./types";
