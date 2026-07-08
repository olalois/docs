import type { Request, Response, NextFunction } from "express";
import { sha256 } from "@noble/hashes/sha256";
import { Keypair } from "@stellar/stellar-sdk";
import {
  deriveStealthKeys,
  generateStealthAddress,
  encodeStealthMetaAddress,
  bytesToHex,
} from "@wraith/sdk";
import type { StealthKeys } from "@wraith/sdk";
import { SessionStore } from "./sessions.js";
import { StealthScanner } from "./scanner.js";

export interface StealthPaymentConfig {
  /** Price to charge per session (e.g. "0.01"). */
  price: string;
  /** Payment asset (e.g. "USDC"). */
  asset: string;
  /** Stellar network to use. */
  network: "testnet" | "pubnet";
  /** Server's Stellar secret key (S...). */
  secretKey: string;
  /** URL of the x402 facilitator service. */
  facilitatorUrl: string;
}

/**
 * Derives stealth keys from a Stellar secret key.
 *
 * Since there is no interactive wallet signature on the server side,
 * we create a synthetic 64-byte "signature" by hashing the raw secret
 * key with two different domain separators.
 */
export function deriveServerStealthKeys(secretKey: string): StealthKeys {
  const keypair = Keypair.fromSecret(secretKey);
  const rawSecret = keypair.rawSecretKey();

  // Create a synthetic "signature" by hashing the secret key twice
  const syntheticSig = new Uint8Array(64);
  syntheticSig.set(sha256(new Uint8Array([...rawSecret, 0x01])), 0);
  syntheticSig.set(sha256(new Uint8Array([...rawSecret, 0x02])), 32);

  return deriveStealthKeys(syntheticSig);
}

// Shared state across middleware instances
const sessions = new SessionStore();

/** Map of pending stealth addresses to their metadata (ephemeral key + view tag). */
const pendingAddresses = new Map<
  string,
  { ephemeralPubKey: string; viewTag: number; price: string }
>();

/**
 * Returns the shared session store (for use by the session endpoint).
 */
export function getSessionStore(): SessionStore {
  return sessions;
}

/**
 * Returns the pending addresses map (for use by the session endpoint).
 */
export function getPendingAddresses(): Map<
  string,
  { ephemeralPubKey: string; viewTag: number; price: string }
> {
  return pendingAddresses;
}

/**
 * Creates an Express middleware that enforces stealth x402 payments.
 *
 * Flow:
 * 1. Check for `Authorization: Bearer <token>` header - if valid session, allow through.
 * 2. If no valid session, generate a fresh stealth address for this request.
 * 3. Return 402 Payment Required with payment details.
 * 4. Client makes payment, then POSTs to /x402/session to claim a session token.
 */
export function stealthPaymentMiddleware(config: StealthPaymentConfig) {
  const keys = deriveServerStealthKeys(config.secretKey);
  const scanner = new StealthScanner(config.network);

  // Store scanner and keys for session verification
  middlewareState.scanner = scanner;
  middlewareState.keys = keys;
  middlewareState.network = config.network;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Check for existing session via Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const session = sessions.verify(token);
      if (session) {
        next();
        return;
      }
    }

    // No valid session - generate a fresh stealth address
    const { stealthAddress, ephemeralPubKey, viewTag } =
      generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);

    const ephemeralPubKeyHex = bytesToHex(ephemeralPubKey);

    // Store as pending so the session endpoint can verify it
    pendingAddresses.set(stealthAddress, {
      ephemeralPubKey: ephemeralPubKeyHex,
      viewTag,
      price: config.price,
    });

    // Clean up pending address after 10 minutes
    setTimeout(() => {
      pendingAddresses.delete(stealthAddress);
    }, 10 * 60 * 1000);

    const networkId =
      config.network === "testnet" ? "stellar:testnet" : "stellar:pubnet";

    res.status(402).json({
      paymentRequired: true,
      amount: config.price,
      asset: config.asset,
      network: networkId,
      payTo: stealthAddress,
      ephemeralPubKey: ephemeralPubKeyHex,
      viewTag,
      facilitatorUrl: config.facilitatorUrl,
      sessionEndpoint: "/x402/session",
    });
  };
}

/**
 * Shared middleware state for the session endpoint to access
 * the scanner and keys from the middleware configuration.
 */
export const middlewareState: {
  scanner: StealthScanner | null;
  keys: StealthKeys | null;
  network: "testnet" | "pubnet";
} = {
  scanner: null,
  keys: null,
  network: "testnet",
};

/**
 * Returns the server's stealth meta-address string.
 */
export function getServerMetaAddress(secretKey: string): string {
  const keys = deriveServerStealthKeys(secretKey);
  return encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
}
