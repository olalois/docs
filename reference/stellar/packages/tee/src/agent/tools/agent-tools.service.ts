import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  Keypair,
  TransactionBuilder,
  Account,
  Contract,
  xdr,
  nativeToScVal,
  Address,
  Operation,
  Asset,
  Networks,
  rpc,
} from '@stellar/stellar-sdk';
import {
  decodeStealthMetaAddress,
  generateStealthAddress,
  scanAnnouncements,
  signStellarTransaction,
  bytesToHex,
  hexToBytes,
  encodeStealthMetaAddress,
  SCHEME_ID,
} from '@wraith/sdk';
import type { StealthKeys, Announcement } from '@wraith/sdk';
import { DatabaseService } from '../../storage/database.service';
import { NotificationService } from '../../notifications/notification.service';
import { AgentEntity } from '../../storage/entities/agent.entity';

@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);
  private readonly horizonUrl: string;
  private readonly sorobanRpcUrl: string;
  private readonly friendbotUrl: string;
  private readonly namesContract: string;
  private readonly announcerContract: string;
  private readonly usdcIssuer: string;
  private readonly networkPassphrase = Networks.TESTNET;

  constructor(
    private readonly db: DatabaseService,
    private readonly notifs: NotificationService,
    private readonly config: ConfigService,
  ) {
    this.horizonUrl = config.get('stellar.horizonUrl')!;
    this.sorobanRpcUrl = config.get('stellar.sorobanRpcUrl')!;
    this.friendbotUrl = config.get('stellar.friendbotUrl')!;
    this.namesContract = config.get('stellar.namesContract')!;
    this.announcerContract = config.get('stellar.announcerContract')!;
    this.usdcIssuer = config.get('stellar.usdcIssuer')!;
  }

  async executeTool(
    toolName: string,
    args: Record<string, any>,
    agentId: string,
    agent: AgentEntity,
    keypair: Keypair,
    stealthKeys: StealthKeys,
    clientOrigin?: string,
  ): Promise<{ result: Record<string, unknown>; status?: string; detail?: string }> {
    let result: Record<string, unknown> = {};
    let detail = '';
    let status = 'ok';

    try {
      switch (toolName) {
        case 'send_payment': {
          const sendAsset = ((args.asset as string) || 'XLM').toUpperCase();
          result = await this.sendPayment(keypair, stealthKeys, agent.name, args.recipient, args.amount, sendAsset);
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
          result = await this.getBalance(keypair.publicKey());
          const assetList = (result.assets as any[]) || [];
          detail = assetList.map((a: any) => `${a.balance} ${a.asset}`).join(', ') || `${result.balance} XLM`;
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
          const payUrl = `${clientOrigin || 'https://wraith-stellar.vercel.app'}/pay/invoice/${invoiceId}`;
          result = {
            invoiceId,
            payTo: `${agent.name}.wraith`,
            amount: args.amount,
            memo: args.memo,
            status: 'pending',
            paymentLink: payUrl,
            markdownLink: `[Pay ${args.amount} XLM →](${payUrl})`,
          };
          detail = `Invoice created for ${args.amount} XLM`;
          break;
        }
        case 'check_invoices': {
          const pendingInvoices = await this.db.invoices.find({ where: { agentId, status: 'pending' } });
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
              txLink: i.txHash ? `https://stellar.expert/explorer/testnet/tx/${i.txHash}` : null,
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
          result = await this.registerName(keypair, stealthKeys, args.name);
          detail = `Registered name "${args.name}.wraith"`;
          break;
        }
        case 'get_agent_info': {
          const balance = await this.getBalance(keypair.publicKey());
          result = {
            name: `${agent.name}.wraith`,
            publicKey: keypair.publicKey(),
            metaAddress: agent.metaAddress,
            network: 'Stellar Testnet',
            runtime: 'Phala TEE (Intel TDX)',
            balance: balance.balance,
            assets: balance.assets,
          };
          detail = `Agent info for ${agent.name}.wraith`;
          break;
        }
        case 'fund_wallet': {
          const fundRes = await fetch(`${this.friendbotUrl}/?addr=${keypair.publicKey()}`);
          if (fundRes.ok) {
            result = { success: true, message: 'Wallet funded with testnet XLM via Friendbot' };
            detail = 'Wallet funded';
          } else {
            result = { success: false, error: 'Friendbot funding failed — account may already be funded' };
            detail = 'Funding failed';
            status = 'error';
          }
          break;
        }
        case 'pay_agent': {
          const recipientName = (args.agent_name as string).replace(/\.wraith$/, '');
          const payAsset = ((args.asset as string) || 'XLM').toUpperCase();
          result = await this.sendPayment(keypair, stealthKeys, agent.name, recipientName, args.amount, payAsset);
          detail = `Paid ${args.amount} ${payAsset} to ${recipientName}.wraith`;
          await this.notifs.create(agentId, 'payment_sent', 'Agent Payment Sent', `Paid ${args.amount} ${payAsset} to ${recipientName}.wraith.`);
          break;
        }
        case 'withdraw': {
          result = await this.withdraw(keypair, stealthKeys, args.from, args.to);
          detail = result.error ? 'Withdrawal failed' : `Withdrew ${result.withdrawn} XLM`;
          if (result.error) status = 'error';
          else await this.notifs.create(agentId, 'withdrawal', 'Withdrawal Complete', `Withdrew ${result.withdrawn} XLM.`);
          break;
        }
        case 'withdraw_all': {
          result = await this.withdrawAll(keypair, stealthKeys, args.to);
          detail = `Withdrew from ${(result.results as any[])?.length || 0} address(es)`;
          break;
        }
        case 'privacy_check': {
          result = await this.privacyCheck(keypair, stealthKeys, agentId);
          detail = `Privacy score: ${result.privacyScore}/100`;
          break;
        }
        case 'schedule_payment': {
          result = await this.schedulePayment(agentId, args);
          detail = `Scheduled ${args.amount} XLM to ${args.recipient}`;
          if (result.scheduleId) {
            await this.notifs.create(agentId, 'schedule_created', 'Payment Scheduled', `${args.amount} XLM to ${args.recipient} — ${args.interval}.`);
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
              amount: `${s.amount} XLM`,
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

  // --- Stellar helpers ---

  private async loadAccount(publicKey: string): Promise<Account> {
    const res = await fetch(`${this.horizonUrl}/accounts/${publicKey}`);
    if (!res.ok) throw new Error(`Failed to load account ${publicKey}`);
    const data = await res.json();
    return new Account(publicKey, data.sequence);
  }

  private async accountExists(publicKey: string): Promise<boolean> {
    const res = await fetch(`${this.horizonUrl}/accounts/${publicKey}`);
    return res.ok;
  }

  private async submitClassicTx(tx: any, keypair: Keypair): Promise<string> {
    tx.sign(keypair);
    const txXdr = tx.toEnvelope().toXDR('base64');
    const res = await fetch(`${this.horizonUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `tx=${encodeURIComponent(txXdr)}`,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.extras?.result_codes?.transaction || data.title || 'Transaction failed');
    }
    return data.hash as string;
  }

  private async simulateAndSubmitSoroban(tx: any, keypair: Keypair): Promise<string> {
    const server = new rpc.Server(this.sorobanRpcUrl);
    const simulated = await server.simulateTransaction(tx);
    if ('error' in simulated) throw new Error((simulated as any).error);
    const assembled = rpc.assembleTransaction(tx, simulated as rpc.Api.SimulateTransactionSuccessResponse).build();
    assembled.sign(keypair);
    const response = await server.sendTransaction(assembled);
    if (response.status === 'ERROR') throw new Error('Soroban transaction failed');
    let attempts = 0;
    while (attempts < 30) {
      const result = await server.getTransaction(response.hash);
      if (result.status === 'SUCCESS') return response.hash;
      if (result.status === 'FAILED') throw new Error('Soroban transaction failed on-chain');
      if (result.status !== 'NOT_FOUND') break;
      attempts++;
      await new Promise(r => setTimeout(r, 1000));
    }
    return response.hash;
  }

  // --- Core tool implementations ---

  async sendPayment(keypair: Keypair, stealthKeys: StealthKeys, agentName: string, recipient: string, amount: string, asset = 'XLM') {
    let metaAddress: string;
    if (recipient.startsWith('st:xlm:')) {
      metaAddress = recipient;
    } else {
      const cleanName = recipient.replace(/\.wraith$/, '');
      const resolved = await this.resolveWraithName(cleanName);
      if (!resolved) throw new Error(`Could not resolve name "${cleanName}.wraith"`);
      metaAddress = resolved.metaAddress as string;
    }

    const decoded = decodeStealthMetaAddress(metaAddress);
    const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
    const exists = await this.accountExists(stealth.stealthAddress);
    const stellarAsset = asset === 'USDC' ? new Asset('USDC', this.usdcIssuer) : Asset.native();
    const sourceAccount = await this.loadAccount(keypair.publicKey());

    let tx;
    if (exists) {
      tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase: this.networkPassphrase })
        .addOperation(Operation.payment({ destination: stealth.stealthAddress, asset: stellarAsset, amount }))
        .setTimeout(30).build();
    } else {
      tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase: this.networkPassphrase })
        .addOperation(Operation.createAccount({ destination: stealth.stealthAddress, startingBalance: amount }))
        .setTimeout(30).build();
    }

    const txHash = await this.submitClassicTx(tx, keypair);

    // Announce on-chain via Soroban
    try {
      const freshAccount = await this.loadAccount(keypair.publicKey());
      const contract = new Contract(this.announcerContract);
      const announceTx = new TransactionBuilder(freshAccount, { fee: '100', networkPassphrase: this.networkPassphrase })
        .addOperation(contract.call(
          'announce',
          nativeToScVal(SCHEME_ID, { type: 'u32' }),
          new Address(stealth.stealthAddress).toScVal(),
          xdr.ScVal.scvBytes(Buffer.from(stealth.ephemeralPubKey)),
          xdr.ScVal.scvBytes(Buffer.from([stealth.viewTag])),
        ))
        .setTimeout(30).build();
      const announceHash = await this.simulateAndSubmitSoroban(announceTx, keypair);
      this.logger.log(`Announcement submitted: ${announceHash}`);
    } catch (announceErr: any) {
      this.logger.error(`Announcement FAILED: ${announceErr.message}`);
    }

    return {
      txHash,
      txLink: `https://stellar.expert/explorer/testnet/tx/${txHash}`,
      stealthAddress: stealth.stealthAddress,
      amount,
      asset,
      recipient,
    };
  }

  async scanPayments(stealthKeys: StealthKeys) {
    const announcements = await this.fetchAnnouncementEvents();
    const matched = scanAnnouncements(announcements, stealthKeys.viewingKey, stealthKeys.spendingPubKey, stealthKeys.spendingScalar);
    const results: Record<string, unknown>[] = [];
    for (const match of matched) {
      let balance = '0';
      try {
        const res = await fetch(`${this.horizonUrl}/accounts/${match.stealthAddress}`);
        if (res.ok) {
          const data = await res.json();
          const native = data.balances?.find((b: any) => b.asset_type === 'native');
          if (native) balance = native.balance;
        }
      } catch {}
      results.push({ stealthAddress: match.stealthAddress, balance });
    }
    return results;
  }

  async getBalance(publicKey: string) {
    let balance = '0';
    const assets: Array<{ asset: string; balance: string }> = [];
    try {
      const res = await fetch(`${this.horizonUrl}/accounts/${publicKey}`);
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
    return { publicKey, balance, assets };
  }

  async resolveWraithName(name: string): Promise<{ metaAddress: string } | null> {
    try {
      const cleanName = name.replace(/\.wraith$/, '');
      const DUMMY_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      const contract = new Contract(this.namesContract);
      const tx = new TransactionBuilder(new Account(DUMMY_ACCOUNT, '0'), { fee: '100', networkPassphrase: this.networkPassphrase })
        .addOperation(contract.call('resolve', xdr.ScVal.scvString(cleanName)))
        .setTimeout(30).build();
      const server = new rpc.Server(this.sorobanRpcUrl);
      const simulated = await server.simulateTransaction(tx);
      if (!('error' in simulated) && 'result' in simulated && (simulated as any).result?.retval) {
        const retval = (simulated as any).result.retval;
        const resultXdr = xdr.ScVal.fromXDR(retval.toXDR());
        const bytes = resultXdr.bytes();
        if (bytes && bytes.length === 64) {
          const spendHex = bytesToHex(new Uint8Array(bytes.slice(0, 32)));
          const viewHex = bytesToHex(new Uint8Array(bytes.slice(32)));
          return { metaAddress: `st:xlm:${spendHex}${viewHex}` };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async registerName(keypair: Keypair, stealthKeys: StealthKeys, name: string) {
    const cleanName = name.replace(/\.wraith$/, '');
    const metaBytes = Buffer.concat([
      Buffer.from(stealthKeys.spendingPubKey),
      Buffer.from(stealthKeys.viewingPubKey),
    ]);
    const contract = new Contract(this.namesContract);
    const sourceAccount = await this.loadAccount(keypair.publicKey());
    const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase: this.networkPassphrase })
      .addOperation(contract.call(
        'register',
        new Address(keypair.publicKey()).toScVal(),
        xdr.ScVal.scvString(cleanName),
        xdr.ScVal.scvBytes(metaBytes),
      ))
      .setTimeout(30).build();
    const txHash = await this.simulateAndSubmitSoroban(tx, keypair);
    return { name: cleanName, txHash, txLink: `https://stellar.expert/explorer/testnet/tx/${txHash}` };
  }

  async withdraw(keypair: Keypair, stealthKeys: StealthKeys, from: string, to: string) {
    const announcements = await this.fetchAnnouncementEvents();
    const matched = scanAnnouncements(announcements, stealthKeys.viewingKey, stealthKeys.spendingPubKey, stealthKeys.spendingScalar);
    const matchedEntry = matched.find(m => m.stealthAddress === from);
    if (!matchedEntry) return { error: 'Stealth address not found in your payments' };

    try {
      const res = await fetch(`${this.horizonUrl}/accounts/${from}`);
      if (!res.ok) return { error: 'Stealth address has no funds' };
      const data = await res.json();
      const native = data.balances?.find((b: any) => b.asset_type === 'native');
      if (!native) return { error: 'No native balance found' };

      const sendable = (parseFloat(native.balance) - 1.5).toFixed(7);
      if (parseFloat(sendable) <= 0) return { error: 'Balance too low to withdraw' };

      const sourceAccount = new Account(from, data.sequence);
      const withdrawTx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase: this.networkPassphrase })
        .addOperation(Operation.payment({ destination: to, asset: Asset.native(), amount: sendable }))
        .addOperation(Operation.accountMerge({ destination: to }))
        .setTimeout(30).build();

      const txHash = withdrawTx.hash();
      const signature = signStellarTransaction(txHash, matchedEntry.stealthPrivateScalar, matchedEntry.stealthPubKeyBytes);
      withdrawTx.addSignature(from, Buffer.from(signature).toString('base64'));

      const submitRes = await fetch(`${this.horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(withdrawTx.toEnvelope().toXDR('base64'))}`,
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.extras?.result_codes?.transaction || 'Transaction failed');

      return {
        txHash: submitData.hash,
        txLink: `https://stellar.expert/explorer/testnet/tx/${submitData.hash}`,
        withdrawn: sendable,
        from,
        to,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async withdrawAll(keypair: Keypair, stealthKeys: StealthKeys, to: string) {
    const payments = await this.scanPayments(stealthKeys);
    const results: any[] = [];
    for (const p of payments) {
      if (parseFloat(p.balance as string) > 1.5) {
        const r = await this.withdraw(keypair, stealthKeys, p.stealthAddress as string, to);
        results.push({ address: p.stealthAddress, ...r });
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    return { results, count: results.length };
  }

  async privacyCheck(keypair: Keypair, stealthKeys: StealthKeys, agentId: string) {
    const payments = await this.scanPayments(stealthKeys);
    const issues: Array<{ severity: string; issue: string; recommendation: string }> = [];
    let privacyScore = 100;

    if (payments.length > 0) {
      const balances = payments.map(p => parseFloat(p.balance as string)).filter(b => b > 0.5);
      if (balances.length > 5) {
        issues.push({ severity: 'medium', issue: `${balances.length} unspent stealth addresses`, recommendation: 'Withdraw periodically with time delays.' });
        privacyScore -= 10;
      }
      const uniqueBalances = new Set(balances.map(b => b.toFixed(0)));
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
      amount: `${args.amount} XLM`,
      frequency: interval,
      nextPayment: new Date(nextRun * 1000).toLocaleString(),
      endsOn: endsAt ? new Date(endsAt * 1000).toLocaleString() : 'No end date',
      status: 'active',
    };
  }

  async manageSchedule(agentId: string, scheduleId: string, action: string) {
    const schedule = await this.db.schedules.findOne({
      where: { agentId },
    });
    // Find by partial ID
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

  // --- Soroban event fetching ---

  async fetchAnnouncementEvents(): Promise<Announcement[]> {
    const all: Announcement[] = [];
    try {
      let startLedger = 1;
      const probeRes = await fetch(this.sorobanRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 0, method: 'getEvents',
          params: { startLedger: 1, filters: [{ type: 'contract', contractIds: [this.announcerContract] }], pagination: { limit: 1 } },
        }),
      });
      const probeData = await probeRes.json();
      if (probeData.error?.message) {
        const match = probeData.error.message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
        if (match) {
          const oldest = parseInt(match[1], 10);
          const latest = parseInt(match[2], 10);
          startLedger = Math.max(oldest, latest - 5000);
        } else return all;
      }

      let cursor: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const params: any = {
          filters: [{ type: 'contract', contractIds: [this.announcerContract] }],
          pagination: { limit: 1000 },
        };
        if (cursor) params.pagination.cursor = cursor;
        else params.startLedger = startLedger;

        const res = await fetch(this.sorobanRpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getEvents', params }),
        });
        const data = await res.json();
        const events = data.result?.events ?? [];
        for (const event of events) {
          try {
            const ann = this.parseAnnouncementEvent(event);
            if (ann) all.push(ann);
          } catch {}
        }
        if (events.length < 1000) hasMore = false;
        else { cursor = data.result?.cursor; if (!cursor) hasMore = false; }
      }
    } catch {}
    return all;
  }

  private parseAnnouncementEvent(event: any): Announcement | null {
    const topics = event.topic;
    if (!topics || topics.length < 3) return null;
    const schemeIdScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
    const stealthScVal = xdr.ScVal.fromXDR(topics[2], 'base64');
    const stealthAddress = Address.fromScAddress(stealthScVal.address()).toString();
    const valueScVal = xdr.ScVal.fromXDR(event.value, 'base64');
    const valueVec = valueScVal.vec();
    if (!valueVec || valueVec.length < 3) return null;
    const caller = Address.fromScAddress(valueVec[0].address()).toString();
    const ephPubKeyBytes = valueVec[1].bytes();
    const viewTagBytes = valueVec[2].bytes();
    if (!ephPubKeyBytes || !viewTagBytes) return null;
    return {
      schemeId: schemeIdScVal.u32(),
      stealthAddress,
      caller,
      ephemeralPubKey: bytesToHex(new Uint8Array(ephPubKeyBytes)),
      metadata: bytesToHex(new Uint8Array(viewTagBytes)),
    };
  }
}
