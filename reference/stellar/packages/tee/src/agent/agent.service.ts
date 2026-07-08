import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHash } from 'crypto';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { encodeStealthMetaAddress } from '@wraith/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { DatabaseService } from '../storage/database.service';
import { TeeService } from '../tee/tee.service';
import { NotificationService } from '../notifications/notification.service';
import { AgentToolsService } from './tools/agent-tools.service';
import { agentTools, buildSystemPrompt } from './tools/tool-definitions';

export interface AgentInfo {
  id: string;
  name: string;
  publicKey: string;
  metaAddress: string;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tee: TeeService,
    private readonly config: ConfigService,
    private readonly notifs: NotificationService,
    private readonly tools: AgentToolsService,
  ) {}

  /**
   * Verify a Stellar wallet signature.
   * The user signs a message with Freighter, we verify using their public key.
   */
  /**
   * Verify a Freighter wallet signature (SEP-53).
   *
   * Freighter signs: ed25519_sign(SHA256("Stellar Signed Message:\n" + message))
   * The signature is returned as base64-encoded 64-byte ed25519 signature.
   */
  private verifyWalletSignature(
    publicKey: string,
    signature: string,
    message: string,
  ): boolean {
    try {
      const keypair = Keypair.fromPublicKey(publicKey);
      const signatureBuffer = Buffer.from(signature, 'base64');

      if (signatureBuffer.length !== 64) {
        this.logger.warn(`Invalid signature length: ${signatureBuffer.length} (expected 64)`);
        return false;
      }

      // SEP-53: SHA256("Stellar Signed Message:\n" + message)
      const SEP53_PREFIX = 'Stellar Signed Message:\n';
      const prefixBytes = Buffer.from(SEP53_PREFIX, 'utf8');
      const messageBytes = Buffer.from(message, 'utf8');
      const encoded = Buffer.concat([prefixBytes, messageBytes]);
      const messageHash = createHash('sha256').update(encoded).digest();

      return keypair.verify(messageHash, signatureBuffer);
    } catch (err: any) {
      this.logger.error(`Signature verification error: ${err.message}`);
      return false;
    }
  }

  async createAgent(
    name: string,
    ownerWallet: string,
    signature: string,
    message: string,
  ): Promise<AgentInfo> {
    this.logger.log(`createAgent: name=${name}, wallet=${ownerWallet?.slice(0, 12)}...`);

    if (!ownerWallet || !signature || !message) {
      this.logger.warn(`createAgent: Missing fields — wallet=${!!ownerWallet}, sig=${!!signature}, msg=${!!message}`);
      throw new BadRequestException(
        'Wallet address, signature, and message are required to create an agent.',
      );
    }

    // Verify the user controls this wallet
    this.logger.log(`createAgent: Verifying signature for wallet ${ownerWallet.slice(0, 8)}...`);
    const isValid = this.verifyWalletSignature(ownerWallet, signature, message);
    if (!isValid) {
      this.logger.warn(`createAgent: Signature verification FAILED for wallet ${ownerWallet.slice(0, 8)}...`);
      throw new BadRequestException(
        'Signature verification failed. Please sign the message with your wallet.',
      );
    }
    this.logger.log(`createAgent: Signature verified for wallet ${ownerWallet.slice(0, 8)}...`);

    const cleanName = name.replace(/\.wraith$/, '');

    const existing = await this.db.agents.findOneBy({ name: cleanName });
    if (existing) {
      throw new Error(`Agent name "${cleanName}" is already taken`);
    }

    // Check if wallet already has an agent
    const existingWallet = await this.db.agents.findOneBy({ ownerWallet });
    if (existingWallet) {
      throw new Error('This wallet already has an agent.');
    }

    const id = randomUUID();

    // Derive keys from TEE — never stored
    const keypair = await this.tee.deriveAgentKeypair(id);
    const publicKey = keypair.publicKey();
    const stealthKeys = await this.tee.deriveAgentStealthKeys(id);
    const metaAddress = encodeStealthMetaAddress(
      stealthKeys.spendingPubKey,
      stealthKeys.viewingPubKey,
    );

    // Fund via Friendbot
    const friendbotUrl = this.config.get<string>('stellar.friendbotUrl');
    const res = await fetch(`${friendbotUrl}/?addr=${publicKey}`);
    if (!res.ok) {
      throw new Error(`Friendbot funding failed: ${await res.text()}`);
    }

    // Store agent — NO private key
    await this.db.agents.save({
      id,
      name: cleanName,
      ownerWallet,
      publicKey,
      metaAddress,
    });

    // Register .wraith name on-chain (best effort)
    try {
      await this.tools.registerName(keypair, stealthKeys, cleanName);
    } catch (err: any) {
      this.logger.warn(`Failed to register name "${cleanName}.wraith": ${err.message}`);
    }

    this.logger.log(`Agent created: ${cleanName}.wraith (${publicKey.slice(0, 8)}...) — verified wallet ${ownerWallet.slice(0, 8)}...`);
    return { id, name: cleanName, publicKey, metaAddress };
  }

  async getAgent(id: string): Promise<AgentInfo | null> {
    const agent = await this.db.agents.findOneBy({ id });
    return agent ? { id: agent.id, name: agent.name, publicKey: agent.publicKey, metaAddress: agent.metaAddress } : null;
  }

  async getAgentByName(name: string): Promise<AgentInfo | null> {
    const cleanName = name.replace(/\.wraith$/, '');
    const agent = await this.db.agents.findOneBy({ name: cleanName });
    return agent ? { id: agent.id, name: agent.name, publicKey: agent.publicKey, metaAddress: agent.metaAddress } : null;
  }

  async getAgentByWallet(wallet: string): Promise<AgentInfo | null> {
    const agent = await this.db.agents.findOneBy({ ownerWallet: wallet });
    return agent ? { id: agent.id, name: agent.name, publicKey: agent.publicKey, metaAddress: agent.metaAddress } : null;
  }

  async getAllAgents() {
    return this.db.agents.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Export the agent's secret key. Derived from TEE on demand.
   * The user owns their agent — they can export if they want.
   */
  async exportAgentKey(agentId: string) {
    const agent = await this.db.agents.findOneBy({ id: agentId });
    if (!agent) throw new NotFoundException('Agent not found');

    const keypair = await this.tee.deriveAgentKeypair(agentId);
    return { secret: keypair.secret() };
  }

  async getAgentStatus(agentId: string) {
    const agent = await this.db.agents.findOneBy({ id: agentId });
    if (!agent) return { error: 'Agent not found' };

    const keypair = await this.tee.deriveAgentKeypair(agentId);
    const horizonUrl = this.config.get<string>('stellar.horizonUrl');

    // 1. Get balance
    let balance = '0';
    const assets: Array<{ asset: string; balance: string }> = [];
    try {
      const res = await fetch(`${horizonUrl}/accounts/${keypair.publicKey()}`);
      if (res.ok) {
        const data = await res.json();
        for (const b of data.balances || []) {
          if (b.asset_type === 'native') {
            balance = b.balance;
            assets.push({ asset: 'XLM', balance: b.balance });
          } else if (b.asset_code) {
            assets.push({ asset: b.asset_code, balance: b.balance });
          }
        }
      }
    } catch {}

    // 2. Counts
    const pendingInvoices = await this.db.invoices.count({
      where: { agentId, status: 'pending' },
    });
    const paidInvoices = await this.db.invoices.count({
      where: { agentId, status: 'paid' },
    });
    const activeSchedules = await this.db.schedules.count({
      where: { agentId, status: 'active' },
    });
    const unreadNotifications = await this.db.notifications.count({
      where: { agentId, read: false },
    });

    // Load pending actions
    const pendingActionsList = await this.db.pendingActions.find({
      where: { agentId, delivered: false },
      order: { createdAt: 'ASC' },
    });

    // Build status message
    const parts: string[] = [];
    parts.push(`**${agent.name}.wraith** is online.`);
    parts.push(`**Balance:** ${balance} XLM`);
    if (pendingInvoices > 0) parts.push(`**Pending invoices:** ${pendingInvoices}`);
    if (paidInvoices > 0) parts.push(`**Paid invoices:** ${paidInvoices}`);
    if (activeSchedules > 0) parts.push(`**Active schedules:** ${activeSchedules} recurring payment(s)`);
    if (unreadNotifications > 0) parts.push(`**Unread notifications:** ${unreadNotifications}`);

    if (pendingActionsList.length > 0) {
      parts.push('');
      parts.push('**While you were away:**');
      for (const action of pendingActionsList) {
        parts.push(`- ${action.message}`);
      }
      // Mark as delivered
      await this.db.pendingActions.update(
        pendingActionsList.map(a => a.id),
        { delivered: true },
      );
    }

    return {
      statusMessage: parts.join('\n'),
      balance,
      assets,
      pendingInvoices,
      activeSchedules,
      unreadNotifications,
      pendingActions: pendingActionsList.length,
    };
  }

  /**
   * Load agent memories for context injection.
   * Limits to 20 most recent/important. If over 20, summarizes older ones.
   */
  private async loadMemories(agentId: string): Promise<string[]> {
    const memories = await this.db.memory.find({
      where: { agentId },
      order: { importance: 'DESC', createdAt: 'DESC' },
      take: 20,
    });
    return memories.map(m => `[${m.type}] ${m.content}`);
  }

  /**
   * Load undelivered pending actions for this agent.
   */
  private async loadPendingActions(agentId: string): Promise<string[]> {
    const actions = await this.db.pendingActions.find({
      where: { agentId, delivered: false },
      order: { createdAt: 'ASC' },
    });
    // Mark as delivered
    if (actions.length > 0) {
      await this.db.pendingActions.update(
        actions.map(a => a.id),
        { delivered: true },
      );
    }
    return actions.map(a => `[${a.type}] ${a.message}`);
  }

  /**
   * Extract and save memories from the agent's response.
   * Uses heuristics to detect preferences and facts.
   */
  private async extractMemories(agentId: string, userMessage: string, agentResponse: string) {
    const lowerMsg = userMessage.toLowerCase();

    // Detect explicit preferences
    if (lowerMsg.includes('always ') || lowerMsg.includes('prefer') || lowerMsg.includes('my address') || lowerMsg.includes('default')) {
      await this.db.memory.save({
        agentId,
        type: 'preference',
        content: userMessage,
        importance: 4,
      });
    }

    // Detect withdrawal address mentions
    const addressMatch = userMessage.match(/G[A-Z2-7]{55}/);
    if (addressMatch && (lowerMsg.includes('withdraw') || lowerMsg.includes('send to') || lowerMsg.includes('destination'))) {
      await this.db.memory.save({
        agentId,
        type: 'preference',
        content: `Operator mentioned address ${addressMatch[0]} for withdrawals/transfers`,
        importance: 3,
      });
    }

    // Summarize if memories exceed 20
    const count = await this.db.memory.count({ where: { agentId } });
    if (count > 20) {
      const oldest = await this.db.memory.find({
        where: { agentId },
        order: { importance: 'ASC', createdAt: 'ASC' },
        take: 10,
      });
      if (oldest.length > 0) {
        const summary = oldest.map(m => m.content).join('; ');
        await this.db.memory.save({
          agentId,
          type: 'context_summary',
          content: `Summary of older context: ${summary.slice(0, 500)}`,
          importance: 2,
        });
        // Remove summarized entries
        await this.db.memory.remove(oldest);
      }
    }
  }

  async chat(
    agentId: string,
    message: string,
    history: Array<{ role: string; text: string }>,
    clientOrigin?: string,
  ) {
    const agent = await this.db.agents.findOneBy({ id: agentId });
    if (!agent) throw new NotFoundException('Agent not found');

    // Derive keys from TEE
    const keypair = await this.tee.deriveAgentKeypair(agentId);
    const stealthKeys = await this.tee.deriveAgentStealthKeys(agentId);

    // Load memories and pending actions
    const memories = await this.loadMemories(agentId);
    const pendingActions = await this.loadPendingActions(agentId);

    const apiKey = this.config.get<string>('gemini.apiKey');
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: buildSystemPrompt(
        agent.name,
        keypair.publicKey(),
        agent.metaAddress,
        memories,
        pendingActions,
      ),
      tools: agentTools as any,
    });

    // Build chat history — Gemini requires first entry to be 'user' role
    const chatHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
    for (const entry of history) {
      if (!entry.text || entry.text.trim() === '') continue;
      const role = entry.role === 'user' ? 'user' : 'model';
      // Skip if this would make the first entry a 'model' role
      if (chatHistory.length === 0 && role === 'model') continue;
      // Skip consecutive same-role entries (Gemini doesn't allow them)
      if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === role) continue;
      chatHistory.push({ role, parts: [{ text: entry.text }] });
    }
    // Ensure history ends with 'model' if it has entries (Gemini requirement)
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
      chatHistory.pop();
    }

    const chatSession = model.startChat({ history: chatHistory });
    let result = await chatSession.sendMessage(message);
    const toolCallResults: Array<{ name: string; status: string; detail?: string }> = [];

    // Tool call loop
    let maxIterations = 10;
    while (maxIterations > 0) {
      maxIterations--;
      const candidate = result.response.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts ?? [];
      const functionCalls = parts.filter((p: any) => p.functionCall);
      if (functionCalls.length === 0) break;

      const functionResponses: Array<{
        functionResponse: { name: string; response: Record<string, unknown> };
      }> = [];

      for (const part of functionCalls) {
        const fc = (part as any).functionCall;
        const toolResult = await this.tools.executeTool(
          fc.name,
          fc.args || {},
          agentId,
          agent,
          keypair,
          stealthKeys,
          clientOrigin,
        );

        toolCallResults.push({
          name: fc.name,
          status: toolResult.status || 'ok',
          detail: toolResult.detail,
        });

        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: toolResult.result,
          },
        });
      }

      result = await chatSession.sendMessage(functionResponses as any);
    }

    const responseText =
      result.response.candidates?.[0]?.content?.parts
        ?.filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join('\n') || 'I could not generate a response.';

    // Extract and save memories from this interaction
    try {
      await this.extractMemories(agentId, message, responseText);
    } catch {}

    return { response: responseText, toolCalls: toolCallResults };
  }
}
