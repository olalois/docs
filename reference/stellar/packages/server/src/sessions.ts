import { randomBytes } from "crypto";

interface SessionData {
  id: string;
  stealthAddress: string;
  ephemeralPubKey: string;
  viewTag: number;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Simple in-memory session store for stealth x402 payment sessions.
 *
 * Each session maps a payment to a stealth address to an access token.
 * Sessions expire after 1 hour.
 */
export class SessionStore {
  private sessions = new Map<string, SessionData>();
  private byStealthAddress = new Map<string, string>(); // stealthAddress -> sessionId
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Periodically clean up expired sessions every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Creates a new session tied to a stealth address payment.
   * Returns the session ID (used as the bearer token).
   */
  create(
    stealthAddress: string,
    ephemeralPubKey: string,
    viewTag: number
  ): string {
    const id = randomBytes(32).toString("hex");
    const now = Date.now();

    const session: SessionData = {
      id,
      stealthAddress,
      ephemeralPubKey,
      viewTag,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };

    this.sessions.set(id, session);
    this.byStealthAddress.set(stealthAddress, id);

    return id;
  }

  /**
   * Verifies a session token and returns its data, or null if invalid/expired.
   */
  verify(sessionId: string): SessionData | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      this.byStealthAddress.delete(session.stealthAddress);
      return null;
    }

    return session;
  }

  /**
   * Looks up a session by its stealth address destination.
   */
  getByStealthAddress(address: string): SessionData | null {
    const sessionId = this.byStealthAddress.get(address);
    if (!sessionId) return null;
    return this.verify(sessionId);
  }

  /**
   * Removes expired sessions from memory.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
        this.byStealthAddress.delete(session.stealthAddress);
      }
    }
  }

  /**
   * Shuts down the cleanup timer (for graceful shutdown).
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
