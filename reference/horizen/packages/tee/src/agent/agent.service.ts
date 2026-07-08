import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  verifyMessage,
  type Hex,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeStealthMetaAddress } from '@wraith-horizen/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { DatabaseService } from '../storage/database.service';
import { TeeService } from '../tee/tee.service';
import { NotificationService } from '../notifications/notification.service';
import { AgentToolsService } from './tools/agent-tools.service';
import { agentTools, buildSystemPrompt } from './tools/tool-definitions';

export interface AgentInfo {
  id: string;
  name: string;
  address: string;
  metaAddress: string;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly chain: Chain;
  private readonly rpcUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly tee: TeeService,
    private readonly config: ConfigService,
    private readonly notifs: NotificationService,
    private readonly tools: AgentToolsService,
  ) {
    this.rpcUrl = config.get('horizen.rpcUrl')!;
    this.chain = {
      id: config.get<number>('horizen.chainId')!,
      name: 'Horizen Testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [this.rpcUrl] } },
    } as Chain;
  }

  /**
   * Verify an EVM wallet signature.
   * The user signs a message with their wallet (MetaMask, etc.), we verify using their address.
   */
  private async verifyWalletSignature(
    address: string,
    signature: string,
    message: string,
  ): Promise<boolean> {
    try {
      const isValid = await verifyMessage({
        address: address as Hex,
        message,
        signature: signature as Hex,
      });
      return isValid;
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
    const isValid = await this.verifyWalletSignature(ownerWallet, signature, message);
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
    const account = await this.tee.deriveAgentKeypair(id);
    const address = account.address;
    const stealthKeys = await this.tee.deriveAgentStealthKeys(id);
    const metaAddress = encodeStealthMetaAddress(
      stealthKeys.spendingPubKey,
      stealthKeys.viewingPubKey,
    );

    // Fund via Horizen testnet faucet
    try {
      const faucetRes = await fetch('https://horizen-testnet.hub.caldera.xyz/api/trpc/faucet.requestFaucetFunds?batch=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ '0': { json: { rollupSubdomain: 'horizen-testnet', recipientAddress: address, turnstileToken: '', tokenRollupAddress: null }, meta: { values: { tokenRollupAddress: ['undefined'] } } } }),
      });
      const faucetData = await faucetRes.json();
      const success = faucetData?.[0]?.result?.data?.json?.success;
      if (success) {
        this.logger.log(`Faucet funded agent ${address.slice(0, 8)}...`);
      } else {
        this.logger.warn(`Faucet response not successful for ${address.slice(0, 8)}...`);
      }
    } catch (err: any) {
      this.logger.warn(`Faucet funding failed: ${err.message}`);
    }

    // Store agent — NO private key
    await this.db.agents.save({
      id,
      name: cleanName,
      ownerWallet,
      address,
      metaAddress,
    });

    // Register .wraith name on-chain (best effort)
    try {
      await this.tools.registerName(address as Hex, stealthKeys, cleanName);
    } catch (err: any) {
      this.logger.warn(`Failed to register name "${cleanName}.wraith": ${err.message}`);
    }

    this.logger.log(`Agent created: ${cleanName}.wraith (${address.slice(0, 8)}...) — verified wallet ${ownerWallet.slice(0, 8)}...`);
    return { id, name: cleanName, address, metaAddress };
  }

  async getAgent(id: string): Promise<AgentInfo | null> {
    const agent = await this.db.agents.findOneBy({ id });
    return agent ? { id: agent.id, name: agent.name, address: agent.address, metaAddress: agent.metaAddress } : null;
  }

  async getAgentByName(name: string): Promise<AgentInfo | null> {
    const cleanName = name.replace(/\.wraith$/, '');
    const agent = await this.db.agents.findOneBy({ name: cleanName });
    return agent ? { id: agent.id, name: agent.name, address: agent.address, metaAddress: agent.metaAddress } : null;
  }

  async getAgentByWallet(wallet: string): Promise<AgentInfo | null> {
    const agent = await this.db.agents.findOneBy({ ownerWallet: wallet });
    return agent ? { id: agent.id, name: agent.name, address: agent.address, metaAddress: agent.metaAddress } : null;
  }

  async getAllAgents() {
    return this.db.agents.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Export the agent's private key. Derived from TEE on demand.
   * The user owns their agent — they can export if they want.
   */
  async exportAgentKey(agentId: string, signature: string, message: string) {
    if (!signature || !message) {
      throw new BadRequestException('Signature and message are required to export key.');
    }

    const agent = await this.db.agents.findOneBy({ id: agentId });
    if (!agent) throw new NotFoundException('Agent not found');

    if (!agent.ownerWallet) {
      throw new BadRequestException('Agent has no owner wallet. Cannot verify ownership.');
    }

    // Verify the EIP-191 personal_sign signature matches the owner wallet
    const isValid = await verifyMessage({
      address: agent.ownerWallet as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      throw new BadRequestException('Invalid signature. Must be signed by the agent owner wallet.');
    }

    // Derive the private key from TEE on demand
    const privateKey = await this.tee.deriveAgentPrivateKey(agentId);

    return { secret: privateKey };
  }

  async getAgentStatus(agentId: string) {
    const agent = await this.db.agents.findOneBy({ id: agentId });
    if (!agent) return { error: 'Agent not found' };

    const account = await this.tee.deriveAgentKeypair(agentId);

    // 1. Get balance
    const publicClient = createPublicClient({ chain: this.chain, transport: http(this.rpcUrl) });
    let balance = '0';
    const assets: Array<{ asset: string; balance: string }> = [];
    try {
      const ethBalance = await publicClient.getBalance({ address: account.address as Hex });
      balance = formatEther(ethBalance);
      assets.push({ asset: 'ETH', balance });
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
    parts.push(`**Balance:** ${balance} ETH`);
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

    // Detect withdrawal address mentions (EVM addresses)
    const addressMatch = userMessage.match(/0x[a-fA-F0-9]{40}/);
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
    const account = await this.tee.deriveAgentKeypair(agentId);
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
        account.address,
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
          account,
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
