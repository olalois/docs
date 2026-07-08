import { Injectable, Logger } from '@nestjs/common';
import { privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount, Hex } from 'viem';
import { createHash } from 'crypto';
import { deriveStealthKeys, encodeStealthMetaAddress, STEALTH_SIGNING_MESSAGE } from '@wraith-horizen/sdk';
import type { StealthKeys } from '@wraith-horizen/sdk';
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
   * Derive an EVM account for an agent from the TEE.
   * Deterministic: same agentId always produces the same account.
   * Private key never leaves TEE memory, never stored in database.
   *
   * getKey() returns a 32-byte secp256k1 key. We SHA-256 hash the raw key
   * to get a 32-byte private key suitable for EVM.
   */
  async deriveAgentPrivateKey(agentId: string): Promise<Hex> {
    const result = await this.dstack.getKey(
      `wraith/agent/${agentId}/horizen`,
      'horizen',
    );
    const privateKey = createHash('sha256').update(result.key).digest();
    return `0x${privateKey.toString('hex')}` as Hex;
  }

  async deriveAgentKeypair(agentId: string): Promise<PrivateKeyAccount> {
    const privateKey = await this.deriveAgentPrivateKey(agentId);
    return privateKeyToAccount(privateKey);
  }

  /**
   * Derive stealth keys for an agent from the TEE.
   */
  async deriveAgentStealthKeys(agentId: string): Promise<StealthKeys> {
    const account = await this.deriveAgentKeypair(agentId);

    const signature = await account.signMessage({ message: STEALTH_SIGNING_MESSAGE });

    return deriveStealthKeys(signature);
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
   * Generate a TEE attestation quote bound to an EVM address.
   * Proves that this address was generated inside genuine TEE hardware.
   */
  async getAttestation(address: string) {
    const reportData = createHash('sha256')
      .update(address)
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
