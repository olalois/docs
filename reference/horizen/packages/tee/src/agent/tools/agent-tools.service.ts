import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  decodeStealthMetaAddress,
  generateStealthAddress,
  scanAnnouncements,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  signNameRegistration,
  metaAddressToBytes,
  SCHEME_ID,
} from '@wraith-horizen/sdk';
import type { StealthKeys, Announcement, MatchedAnnouncement, HexString } from '@wraith-horizen/sdk';
import { DatabaseService } from '../../storage/database.service';
import { NotificationService } from '../../notifications/notification.service';
import { AgentEntity } from '../../storage/entities/agent.entity';

const WRAITH_SENDER_ABI = [
  {
    name: 'sendETH',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthAddress', type: 'address' },
      { name: 'ephemeralPubKey', type: 'bytes' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'sendERC20',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthAddress', type: 'address' },
      { name: 'ephemeralPubKey', type: 'bytes' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

const WRAITH_NAMES_ABI = [
  {
    name: 'resolve',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
  {
    name: 'nameOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'stealthMetaAddress', type: 'bytes' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'stealthMetaAddress', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

interface TokenConfig {
  address: string;
  decimals: number;
}

@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);
  private readonly rpcUrl: string;
  private readonly explorerUrl: string;
  private readonly subgraphUrl: string;
  private readonly senderAddress: Hex;
  private readonly namesAddress: Hex;
  private readonly deployerKey: Hex;
  private readonly tokens: Record<string, TokenConfig>;
  private readonly chain: Chain;
  private readonly publicClient: PublicClient;

  constructor(
    private readonly db: DatabaseService,
    private readonly notifs: NotificationService,
    private readonly config: ConfigService,
  ) {
    this.rpcUrl = config.get('horizen.rpcUrl')!;
    this.explorerUrl = config.get('horizen.explorerUrl')!;
    this.subgraphUrl = config.get('horizen.subgraphUrl')!;
    this.senderAddress = config.get('horizen.senderAddress')! as Hex;
    this.namesAddress = config.get('horizen.namesAddress')! as Hex;
    this.deployerKey = config.get('horizen.deployerKey')! as Hex;
    this.tokens = config.get('horizen.tokens')!;
    this.chain = {
      id: config.get<number>('horizen.chainId')!,
      name: 'Horizen Testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [this.rpcUrl] } },
    } as Chain;
    this.publicClient = createPublicClient({ chain: this.chain, transport: http(this.rpcUrl) }) as PublicClient;
  }

  private createAgentWalletClient(privateKey: Hex): WalletClient {
    const account = privateKeyToAccount(privateKey);
    return createWalletClient({ account, chain: this.chain, transport: http(this.rpcUrl) });
  }

  async executeTool(
    toolName: string,
    args: Record<string, any>,
    agentId: string,
    agent: AgentEntity,
    account: { address: Hex },
    stealthKeys: StealthKeys,
    clientOrigin?: string,
  ): Promise<{ result: Record<string, unknown>; status?: string; detail?: string }> {
    let result: Record<string, unknown> = {};
    let detail = '';
    let status = 'ok';

    try {
      switch (toolName) {
        case 'send_payment': {
          const sendAsset = ((args.asset as string) || 'ETH').toUpperCase();
          result = await this.sendPayment(account.address, stealthKeys, agent.name, args.recipient, args.amount, sendAsset);
          detail = `Sent ${args.amount} ${sendAsset} to ${args.recipient}`;
          await this.notifs.create(agentId, 'payment_sent', 'Payment Sent', `Sent ${args.amount} ${sendAsset} to ${args.recipient}.`);
          break;
        }
        case 'scan_payments': {
          const payments = await this.scanPayments(stealthKeys);
          result = { payments, count: payments.length };
          detail = `Found ${payments.length} stealth payment(s)`;
          if (payments.length > 0) {
            await this.notifs.create(agentId, 'payment_received', 'Payments Detected', `Found ${payments.length} incoming stealth payment(s).`);
          }
          break;
        }
        case 'get_balance': {
          result = await this.getBalance(account.address);
          const assetList = (result.assets as any[]) || [];
          detail = assetList.map((a: any) => `${a.balance} ${a.asset}`).join(', ') || `${result.balance} ETH`;
          break;
        }
        case 'create_invoice': {
          const invoiceId = randomUUID();
          await this.db.invoices.save({
            id: invoiceId,
            agentId,
            amount: args.amount,
            memo: args.memo,
            status: 'pending',
          });
          const payUrl = `${clientOrigin || 'https://wraith-horizen.vercel.app'}/pay/invoice/${invoiceId}`;
          result = {
            invoiceId,
            payTo: `${agent.name}.wraith`,
            amount: args.amount,
            memo: args.memo,
            status: 'pending',
            paymentLink: payUrl,
            markdownLink: `[Pay ${args.amount} ETH →](${payUrl})`,
          };
          detail = `Invoice created for ${args.amount} ETH`;
          break;
        }
        case 'check_invoices': {
          const allInvoices = await this.db.invoices.find({ where: { agentId } });
          const pendingCount = allInvoices.filter(i => i.status === 'pending').length;
          const paidCount = allInvoices.filter(i => i.status === 'paid').length;
          result = {
            summary: { total: allInvoices.length, pending: pendingCount, paid: paidCount },
            invoices: allInvoices.map(i => ({
              id: i.id,
              amount: i.amount,
              memo: i.memo,
              status: i.status,
              txHash: i.txHash || null,
              txLink: i.txHash ? `${this.explorerUrl}/tx/${i.txHash}` : null,
            })),
          };
          detail = `Invoices: ${paidCount} paid, ${pendingCount} pending`;
          break;
        }
        case 'resolve_name': {
          const resolved = await this.resolveWraithName(args.name);
          result = resolved || { error: `Name "${args.name}" not found` };
          detail = resolved ? `Resolved to ${(resolved.metaAddress as string).slice(0, 20)}...` : `Name "${args.name}" not found`;
          if (!resolved) status = 'error';
          break;
        }
        case 'register_name': {
          result = await this.registerName(account.address, stealthKeys, args.name);
          detail = `Registered name "${args.name}.wraith"`;
          break;
        }
        case 'get_agent_info': {
          const balance = await this.getBalance(account.address);
          result = {
            name: `${agent.name}.wraith`,
            address: account.address,
            metaAddress: agent.metaAddress,
            network: 'Horizen Testnet (Chain ID 2651420)',
            runtime: 'Phala TEE (Intel TDX)',
            balance: balance.balance,
            assets: balance.assets,
          };
          detail = `Agent info for ${agent.name}.wraith`;
          break;
        }
        case 'fund_wallet': {
          try {
            const faucetRes = await fetch('https://horizen-testnet.hub.caldera.xyz/api/trpc/faucet.requestFaucetFunds?batch=1', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ '0': { json: { rollupSubdomain: 'horizen-testnet', recipientAddress: account.address, turnstileToken: '', tokenRollupAddress: null }, meta: { values: { tokenRollupAddress: ['undefined'] } } } }),
            });
            const faucetData = await faucetRes.json();
            const faucetResult = faucetData?.[0]?.result?.data?.json;
            if (faucetResult?.success) {
              const txHash = faucetResult.transactionHash;
              result = { success: true, message: 'Wallet funded via Horizen testnet faucet', txHash, txLink: `${this.explorerUrl}/tx/${txHash}` };
              detail = 'Wallet funded via faucet';
            } else {
              result = { success: false, error: 'Faucet request failed — may be rate-limited, try again later' };
              detail = 'Faucet request failed';
              status = 'error';
            }
          } catch (err: any) {
            result = { success: false, error: `Funding failed: ${err.message}` };
            detail = 'Funding failed';
            status = 'error';
          }
          break;
        }
        case 'pay_agent': {
          const recipientName = (args.agent_name as string).replace(/\.wraith$/, '');
          const payAsset = ((args.asset as string) || 'ETH').toUpperCase();
          result = await this.sendPayment(account.address, stealthKeys, agent.name, recipientName, args.amount, payAsset);
          detail = `Paid ${args.amount} ${payAsset} to ${recipientName}.wraith`;
          await this.notifs.create(agentId, 'payment_sent', 'Agent Payment Sent', `Paid ${args.amount} ${payAsset} to ${recipientName}.wraith.`);
          break;
        }
        case 'withdraw': {
          result = await this.withdraw(stealthKeys, args.from, args.to, args.amount as string | undefined);
          detail = result.error ? 'Withdrawal failed' : `Withdrew ${result.withdrawn} ETH`;
          if (result.error) status = 'error';
          else await this.notifs.create(agentId, 'withdrawal', 'Withdrawal Complete', `Withdrew ${result.withdrawn} ETH.`);
          break;
        }
        case 'withdraw_all': {
          result = await this.withdrawAll(stealthKeys, args.to);
          detail = `Withdrew from ${(result.results as any[])?.length || 0} address(es)`;
          break;
        }
        case 'privacy_check': {
          result = await this.privacyCheck(stealthKeys, agentId);
          detail = `Privacy score: ${result.privacyScore}/100`;
          break;
        }
        case 'schedule_payment': {
          result = await this.schedulePayment(agentId, args);
          detail = `Scheduled ${args.amount} ETH to ${args.recipient}`;
          if (result.scheduleId) {
            await this.notifs.create(agentId, 'schedule_created', 'Payment Scheduled', `${args.amount} ETH to ${args.recipient} — ${args.interval}.`);
          }
          break;
        }
        case 'list_schedules': {
          const schedules = await this.db.schedules.find({
            where: { agentId, status: 'active' },
            order: { createdAt: 'DESC' },
          });
          result = {
            count: schedules.length,
            schedules: schedules.map(s => ({
              id: s.id.slice(0, 8),
              recipient: s.recipient,
              amount: `${s.amount} ETH`,
              frequency: s.cron,
              status: s.status,
              nextPayment: s.status === 'active' ? new Date(s.nextRun * 1000).toLocaleString() : '—',
            })),
          };
          detail = `${schedules.length} scheduled payment(s)`;
          break;
        }
        case 'manage_schedule': {
          result = await this.manageSchedule(agentId, args.schedule_id, args.action);
          detail = `Schedule ${args.action}d`;
          break;
        }
        case 'save_memory': {
          await this.db.memory.save({
            agentId,
            type: args.type || 'fact',
            content: args.content,
            importance: args.importance || 3,
          });
          result = { saved: true, content: args.content };
          detail = `Memory saved: ${(args.content as string).slice(0, 50)}`;
          break;
        }
        default:
          result = { error: `Unknown tool: ${toolName}` };
          status = 'error';
      }
    } catch (err: any) {
      this.logger.error(`Tool ${toolName} failed: ${err.message}`);
      result = { error: err.message };
      status = 'error';
      detail = err.message;
    }

    return { result, status, detail };
  }

  // --- Core tool implementations ---

  async sendPayment(agentAddress: Hex, stealthKeys: StealthKeys, agentName: string, recipient: string, amount: string, asset = 'ETH') {
    let metaAddress: string;
    if (recipient.startsWith('st:eth:0x')) {
      metaAddress = recipient;
    } else {
      const cleanName = recipient.replace(/\.wraith$/, '');
      const resolved = await this.resolveWraithName(cleanName);
      if (!resolved) throw new Error(`Could not resolve name "${cleanName}.wraith"`);
      metaAddress = resolved.metaAddress as string;
    }

    const decoded = decodeStealthMetaAddress(metaAddress);
    const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
    const viewTagByte = `0x${stealth.viewTag.toString(16).padStart(2, '0')}` as Hex;

    const deployerAccount = privateKeyToAccount(this.deployerKey);
    const walletClient = createWalletClient({ account: deployerAccount, chain: this.chain, transport: http(this.rpcUrl) });

    let txHash: Hex;
    if (asset === 'ETH') {
      txHash = await walletClient.writeContract({
        address: this.senderAddress,
        abi: WRAITH_SENDER_ABI,
        functionName: 'sendETH',
        args: [SCHEME_ID, stealth.stealthAddress as Hex, stealth.ephemeralPubKey as Hex, viewTagByte],
        value: parseEther(amount),
      });
    } else {
      const tokenConfig = this.tokens[asset];
      if (!tokenConfig || tokenConfig.address === 'native') throw new Error(`Unsupported token: ${asset}`);
      const tokenAddress = tokenConfig.address as Hex;
      const parsedAmount = parseUnits(amount, tokenConfig.decimals);

      // Approve the sender contract
      const approveTx = await walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [this.senderAddress, parsedAmount],
      });
      await (this.publicClient as any).waitForTransactionReceipt({ hash: approveTx });

      txHash = await walletClient.writeContract({
        address: this.senderAddress,
        abi: WRAITH_SENDER_ABI,
        functionName: 'sendERC20',
        args: [tokenAddress, parsedAmount, SCHEME_ID, stealth.stealthAddress as Hex, stealth.ephemeralPubKey as Hex, viewTagByte],
      });
    }

    return {
      txHash,
      txLink: `${this.explorerUrl}/tx/${txHash}`,
      stealthAddress: stealth.stealthAddress,
      amount,
      asset,
      recipient,
    };
  }

  async scanPayments(stealthKeys: StealthKeys) {
    const announcements = await this.fetchAnnouncementEvents();
    const matched = scanAnnouncements(announcements, stealthKeys.viewingKey, stealthKeys.spendingPubKey, stealthKeys.spendingKey);
    const results: Record<string, unknown>[] = [];
    for (const match of matched) {
      let balance = '0';
      try {
        const bal = await this.publicClient.getBalance({ address: match.stealthAddress as Hex });
        balance = formatEther(bal);
      } catch {}
      results.push({ stealthAddress: match.stealthAddress, balance });
    }
    return results;
  }

  async getBalance(address: Hex) {
    let balance = '0';
    const assets: Array<{ asset: string; balance: string }> = [];
    try {
      const ethBalance = await this.publicClient.getBalance({ address });
      balance = formatEther(ethBalance);
      assets.push({ asset: 'ETH', balance });

      for (const [symbol, tokenConfig] of Object.entries(this.tokens)) {
        if (tokenConfig.address === 'native') continue;
        try {
          const tokenBalance = await this.publicClient.readContract({
            address: tokenConfig.address as Hex,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address],
          });
          const formatted = formatUnits(tokenBalance as bigint, tokenConfig.decimals);
          if (parseFloat(formatted) > 0) {
            assets.push({ asset: symbol, balance: formatted });
          }
        } catch {}
      }
    } catch {}
    return { address, balance, assets };
  }

  async resolveWraithName(name: string): Promise<{ metaAddress: string } | null> {
    try {
      const cleanName = name.replace(/\.wraith$/, '');
      const resultBytes = await this.publicClient.readContract({
        address: this.namesAddress,
        abi: WRAITH_NAMES_ABI,
        functionName: 'resolve',
        args: [cleanName],
      });

      const bytes = resultBytes as Hex;
      // 66 bytes = 132 hex chars + 0x prefix = 134 chars
      if (bytes && bytes.length === 134) {
        const spendHex = bytes.slice(2, 68);
        const viewHex = bytes.slice(68);
        return { metaAddress: `st:eth:0x${spendHex}${viewHex}` };
      }
      return null;
    } catch {
      return null;
    }
  }

  async registerName(agentAddress: Hex, stealthKeys: StealthKeys, name: string) {
    if (!this.deployerKey) {
      throw new Error('DEPLOYER_KEY not configured — cannot register name on-chain');
    }

    const cleanName = name.replace(/\.wraith$/, '');
    const metaAddress = encodeStealthMetaAddress(stealthKeys.spendingPubKey, stealthKeys.viewingPubKey);
    const metaBytes = metaAddressToBytes(metaAddress);

    const signature = signNameRegistration(cleanName, metaBytes, stealthKeys.spendingKey);

    const deployerAccount = privateKeyToAccount(this.deployerKey);
    const walletClient = createWalletClient({ account: deployerAccount, chain: this.chain, transport: http(this.rpcUrl) });

    const txHash = await walletClient.writeContract({
      address: this.namesAddress,
      abi: WRAITH_NAMES_ABI,
      functionName: 'register',
      args: [cleanName, metaBytes, signature],
    });

    return { name: cleanName, txHash, txLink: `${this.explorerUrl}/tx/${txHash}` };
  }

  async withdraw(stealthKeys: StealthKeys, from: Hex, to: Hex, amount?: string) {
    const announcements = await this.fetchAnnouncementEvents();
    const matched = scanAnnouncements(announcements, stealthKeys.viewingKey, stealthKeys.spendingPubKey, stealthKeys.spendingKey);
    const matchedEntry = matched.find(m => m.stealthAddress.toLowerCase() === from.toLowerCase());
    if (!matchedEntry) return { error: 'Stealth address not found in your payments' };

    try {
      const balance = await this.publicClient.getBalance({ address: from });
      if (balance === 0n) return { error: 'Stealth address has no funds' };

      const stealthPrivateKey = deriveStealthPrivateKey(
        stealthKeys.spendingKey,
        matchedEntry.ephemeralPubKey,
        stealthKeys.viewingKey,
      );

      const stealthAccount = privateKeyToAccount(stealthPrivateKey as Hex);
      const stealthWallet = createWalletClient({ account: stealthAccount, chain: this.chain, transport: http(this.rpcUrl) });

      const gasLimit = 21000n;
      const gasPrice = await this.publicClient.getGasPrice();
      const gasCost = gasPrice * gasLimit * 2n;

      let sendable: bigint;
      const isAll = !amount || amount.toLowerCase() === 'all';

      if (isAll) {
        sendable = balance - gasCost;
        if (sendable <= 0n) return { error: `Balance (${formatEther(balance)} ETH) is too low to cover gas (~${formatEther(gasCost)} ETH)` };
      } else {
        sendable = parseEther(amount);
        if (sendable + gasCost > balance) {
          const maxWithdrawable = balance - gasCost;
          if (maxWithdrawable <= 0n) return { error: `Balance (${formatEther(balance)} ETH) is too low to cover gas` };
          return { error: `Cannot withdraw ${amount} ETH — balance is ${formatEther(balance)} ETH and ~${formatEther(gasCost)} ETH is needed for gas. Max withdrawable: ${formatEther(maxWithdrawable)} ETH` };
        }
      }

      const txHash = await stealthWallet.sendTransaction({
        to,
        value: sendable,
      });

      const withdrawn = formatEther(sendable);
      return {
        txHash,
        txLink: `${this.explorerUrl}/tx/${txHash}`,
        withdrawn,
        from,
        to,
        remainingBalance: formatEther(balance - sendable - gasCost),
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async withdrawAll(stealthKeys: StealthKeys, to: Hex) {
    const payments = await this.scanPayments(stealthKeys);
    const results: any[] = [];
    for (const p of payments) {
      if (parseFloat(p.balance as string) > 0) {
        const r = await this.withdraw(stealthKeys, p.stealthAddress as Hex, to);
        results.push({ address: p.stealthAddress, ...r });
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    return { results, count: results.length };
  }

  async privacyCheck(stealthKeys: StealthKeys, agentId: string) {
    const payments = await this.scanPayments(stealthKeys);
    const issues: Array<{ severity: string; issue: string; recommendation: string }> = [];
    let privacyScore = 100;

    if (payments.length > 0) {
      const balances = payments.map(p => parseFloat(p.balance as string)).filter(b => b > 0);
      if (balances.length > 5) {
        issues.push({ severity: 'medium', issue: `${balances.length} unspent stealth addresses`, recommendation: 'Withdraw periodically with time delays.' });
        privacyScore -= 10;
      }
      const uniqueBalances = new Set(balances.map(b => b.toFixed(4)));
      if (balances.length > 2 && uniqueBalances.size < balances.length * 0.5) {
        issues.push({ severity: 'medium', issue: 'Similar balances across addresses', recommendation: 'Vary payment amounts to avoid correlation.' });
        privacyScore -= 15;
      }
    }

    const agent = await this.db.agents.findOneBy({ id: agentId });
    if (agent?.ownerWallet) {
      issues.push({ severity: 'info', issue: 'Connected wallet is public', recommendation: `Never withdraw stealth funds to ${agent.ownerWallet.slice(0, 8)}...` });
    }

    return {
      privacyScore: Math.max(0, privacyScore),
      rating: privacyScore >= 80 ? 'Good' : privacyScore >= 50 ? 'Fair' : 'Poor',
      addressCount: payments.length,
      issues,
      bestPractices: [
        'Use a fresh destination for each withdrawal',
        'Space withdrawals at least 1 hour apart',
        'Never withdraw to your connected wallet',
        'Vary payment amounts to avoid correlation',
      ],
    };
  }

  async schedulePayment(agentId: string, args: any) {
    const interval = (args.interval as string).toLowerCase();
    const intervalSecs: Record<string, number> = { hourly: 3600, daily: 86400, weekly: 604800, monthly: 2592000 };
    if (!intervalSecs[interval]) return { error: 'Invalid interval. Use: hourly, daily, weekly, monthly' };

    const id = randomUUID();
    const nextRun = Math.floor(Date.now() / 1000) + intervalSecs[interval];
    let endsAt: number | null = null;
    if (args.end_date) {
      const parsed = Date.parse(args.end_date);
      if (!isNaN(parsed)) endsAt = Math.floor(parsed / 1000);
    }

    await this.db.schedules.save({
      id,
      agentId,
      recipient: args.recipient,
      amount: args.amount,
      memo: args.memo || null,
      cron: interval,
      nextRun,
      endsAt,
    });

    return {
      scheduleId: id.slice(0, 8),
      recipient: args.recipient,
      amount: `${args.amount} ETH`,
      frequency: interval,
      nextPayment: new Date(nextRun * 1000).toLocaleString(),
      endsOn: endsAt ? new Date(endsAt * 1000).toLocaleString() : 'No end date',
      status: 'active',
    };
  }

  async manageSchedule(agentId: string, scheduleId: string, action: string) {
    const all = await this.db.schedules.find({ where: { agentId } });
    const sched = all.find(s => s.id.startsWith(scheduleId));
    if (!sched) return { error: 'Schedule not found' };

    if (action === 'pause') {
      await this.db.schedules.update(sched.id, { status: 'paused' });
      return { status: 'paused', id: sched.id.slice(0, 8), recipient: sched.recipient };
    } else if (action === 'resume') {
      const intervalSecs: Record<string, number> = { hourly: 3600, daily: 86400, weekly: 604800, monthly: 2592000 };
      const nextRun = Math.floor(Date.now() / 1000) + (intervalSecs[sched.cron] || 86400);
      await this.db.schedules.update(sched.id, { status: 'active', nextRun });
      return { status: 'active', id: sched.id.slice(0, 8), recipient: sched.recipient, nextPayment: new Date(nextRun * 1000).toLocaleString() };
    } else if (action === 'cancel') {
      await this.db.schedules.update(sched.id, { status: 'cancelled' });
      return { status: 'cancelled', id: sched.id.slice(0, 8), recipient: sched.recipient };
    }
    return { error: 'Invalid action. Use: pause, resume, cancel' };
  }

  // --- Subgraph announcement fetching ---

  async fetchAnnouncementEvents(): Promise<Announcement[]> {
    const all: Announcement[] = [];
    try {
      let skip = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const query = {
          query: `query($first: Int!, $skip: Int!) {
            announcements(first: $first, skip: $skip, where: { schemeId: "1" }, orderBy: block_number, orderDirection: asc) {
              schemeId, stealthAddress, caller, ephemeralPubKey, metadata
            }
          }`,
          variables: { first: batchSize, skip },
        };

        const res = await fetch(this.subgraphUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(query),
        });
        const data = await res.json();
        const announcements = data.data?.announcements ?? [];

        for (const ann of announcements) {
          all.push({
            schemeId: BigInt(ann.schemeId),
            stealthAddress: ann.stealthAddress as HexString,
            caller: ann.caller as HexString,
            ephemeralPubKey: ann.ephemeralPubKey as HexString,
            metadata: ann.metadata as HexString,
          });
        }

        if (announcements.length < batchSize) hasMore = false;
        else skip += batchSize;
      }
    } catch {}
    return all;
  }
}
