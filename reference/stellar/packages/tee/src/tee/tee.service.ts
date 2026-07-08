import { Injectable, Logger } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { createHash } from 'crypto';
import { deriveStealthKeys, encodeStealthMetaAddress } from '@wraith/sdk';
import type { StealthKeys } from '@wraith/sdk';
import { DstackClient } from '@phala/dstack-sdk';

@Injectable()
export class TeeService {
  private readonly logger = new Logger(TeeService.name);
  private readonly dstack: DstackClient;

  constructor() {
    this.dstack = new DstackClient();
    this.logger.log('DstackClient initialized');
  }

  /**
   * Derive a Stellar keypair for an agent from the TEE.
   * Deterministic: same agentId always produces the same keypair.
   * Private key never leaves TEE memory, never stored in database.
   *
   * getKey() returns a 32-byte secp256k1 key. Stellar uses ed25519,
   * so we SHA-256 hash the raw key to get a 32-byte ed25519 seed.
   */
  async deriveAgentKeypair(agentId: string): Promise<Keypair> {
    const result = await this.dstack.getKey(
      `wraith/agent/${agentId}/stellar`,
      'stellar',
    );
    const ed25519Seed = createHash('sha256').update(result.key).digest();
    return Keypair.fromRawEd25519Seed(ed25519Seed);
  }

  /**
   * Derive stealth keys for an agent from the TEE.
   */
  async deriveAgentStealthKeys(agentId: string): Promise<StealthKeys> {
    const keypair = await this.deriveAgentKeypair(agentId);
    const rawSecret = keypair.rawSecretKey();

    const syntheticSig = new Uint8Array(64);
    syntheticSig.set(
      createHash('sha256')
        .update(Buffer.from([...rawSecret, 0x01]))
        .digest(),
      0,
    );
    syntheticSig.set(
      createHash('sha256')
        .update(Buffer.from([...rawSecret, 0x02]))
        .digest(),
      32,
    );

    return deriveStealthKeys(syntheticSig);
  }

  /**
   * Get the stealth meta-address for an agent.
   */
  async getAgentMetaAddress(agentId: string): Promise<string> {
    const stealthKeys = await this.deriveAgentStealthKeys(agentId);
    return encodeStealthMetaAddress(
      stealthKeys.spendingPubKey,
      stealthKeys.viewingPubKey,
    );
  }

  /**
   * Generate a TEE attestation quote bound to a Stellar public key.
   * Proves that this public key was generated inside genuine TEE hardware.
   */
  async getAttestation(stellarPublicKey: string) {
    const reportData = createHash('sha256')
      .update(stellarPublicKey)
      .digest();

    const attestation = await this.dstack.getQuote(reportData);
    const info = await this.dstack.info();

    return {
      quote: attestation.quote,
      appId: info.app_id,
      composeHash: info.tcb_info.compose_hash,
    };
  }

  /**
   * Get TEE environment info — app_id, measurements, compose_hash.
   */
  async getInfo() {
    const info = await this.dstack.info();
    return {
      appId: info.app_id,
      instanceId: info.instance_id,
      appName: info.app_name,
      deviceId: info.device_id,
      composeHash: info.tcb_info.compose_hash,
      osImageHash: info.tcb_info.os_image_hash,
      mrtd: info.tcb_info.mrtd,
      rtmr0: info.tcb_info.rtmr0,
      rtmr1: info.tcb_info.rtmr1,
      rtmr2: info.tcb_info.rtmr2,
      rtmr3: info.tcb_info.rtmr3,
    };
  }

  /**
   * Check if running inside a real TEE.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const info = await this.dstack.info();
      return !!info?.app_id;
    } catch {
      return false;
    }
  }
}
