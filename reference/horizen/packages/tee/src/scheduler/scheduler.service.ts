import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThanOrEqual } from 'typeorm';
import {
  createPublicClient,
  http,
  formatEther,
  type Hex,
  type Chain,
} from 'viem';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../storage/database.service';
import { TeeService } from '../tee/tee.service';
import { AgentToolsService } from '../agent/tools/agent-tools.service';
import { NotificationService } from '../notifications/notification.service';
import { scanAnnouncements } from '@wraith-horizen/sdk';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly chain: Chain;
  private readonly rpcUrl: string;
  private readonly explorerUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly tee: TeeService,
    private readonly tools: AgentToolsService,
    private readonly notifs: NotificationService,
    private readonly config: ConfigService,
  ) {
    this.rpcUrl = config.get('horizen.rpcUrl')!;
    this.explorerUrl = config.get('horizen.explorerUrl')!;
    this.chain = {
      id: config.get<number>('horizen.chainId')!,
      name: 'Horizen Testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [this.rpcUrl] } },
    } as Chain;
  }

  /**
   * Execute scheduled payments — runs every 60 seconds.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async executeScheduledPayments() {
    const now = Math.floor(Date.now() / 1000);

    // Auto-expire schedules past their end date
    await this.db.schedules
      .createQueryBuilder()
      .update()
      .set({ status: 'ended' })
      .where('status = :status AND ends_at IS NOT NULL AND ends_at <= :now', {
        status: 'active',
        now,
      })
      .execute();

    const due = await this.db.schedules.find({
      where: { status: 'active', nextRun: LessThanOrEqual(now) },
    });

    for (const sched of due) {
      try {
        const agent = await this.db.agents.findOneBy({ id: sched.agentId });
        if (!agent) continue;

        const account = await this.tee.deriveAgentKeypair(sched.agentId);
        const stealthKeys = await this.tee.deriveAgentStealthKeys(sched.agentId);

        await this.tools.sendPayment(
          account.address as Hex, stealthKeys, agent.name, sched.recipient,
          sched.amount, sched.asset || 'ETH',
        );

        const intervalSecs: Record<string, number> = {
          hourly: 3600, daily: 86400, weekly: 604800, monthly: 2592000,
        };
        const nextRun = now + (intervalSecs[sched.cron] || 86400);
        await this.db.schedules.update(sched.id, { lastRun: now, nextRun });

        // Create pending action so agent can report it
        await this.db.pendingActions.save({
          agentId: sched.agentId,
          type: 'schedule_result',
          message: `Scheduled payment executed: sent ${sched.amount} ${sched.asset || 'ETH'} to ${sched.recipient}. Next payment at ${new Date(nextRun * 1000).toLocaleString()}.`,
        });

        await this.notifs.create(
          sched.agentId, 'scheduled_payment', 'Scheduled Payment Sent',
          `Auto-paid ${sched.amount} ${sched.asset || 'ETH'} to ${sched.recipient}.`,
        );

        this.logger.log(`Scheduled: ${sched.amount} ETH to ${sched.recipient} for ${agent.name}`);
      } catch (err: any) {
        this.logger.error(`Schedule ${sched.id} failed: ${err.message}`);

        await this.db.pendingActions.save({
          agentId: sched.agentId,
          type: 'schedule_result',
          message: `Scheduled payment FAILED: could not send ${sched.amount} ${sched.asset || 'ETH'} to ${sched.recipient}. Error: ${err.message}`,
        });

        await this.notifs.create(
          sched.agentId, 'schedule_error', 'Scheduled Payment Failed',
          `Failed: ${err.message}`,
        );
      }
    }
  }

  /**
   * Background payment scanner — runs every 5 minutes.
   * Scans for new stealth payments, creates pending actions for the agent to deliver.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async backgroundScan() {
    const agents = await this.db.agents.find();
    if (agents.length === 0) return;

    let announcements: any[];
    try {
      announcements = await this.tools.fetchAnnouncementEvents();
    } catch {
      return;
    }

    const publicClient = createPublicClient({ chain: this.chain, transport: http(this.rpcUrl) });

    for (const agent of agents) {
      try {
        const stealthKeys = await this.tee.deriveAgentStealthKeys(agent.id);
        const matched = scanAnnouncements(
          announcements,
          stealthKeys.viewingKey,
          stealthKeys.spendingPubKey,
          stealthKeys.spendingKey,
        );

        const seen = await this.db.seenStealth.find({ where: { agentId: agent.id } });
        const seenSet = new Set(seen.map(s => s.address));

        for (const m of matched) {
          if (!seenSet.has(m.stealthAddress)) {
            let bal = '0';
            try {
              const balance = await publicClient.getBalance({ address: m.stealthAddress as Hex });
              bal = formatEther(balance);
            } catch {}

            if (parseFloat(bal) > 0) {
              await this.db.seenStealth.save({
                address: m.stealthAddress,
                agentId: agent.id,
                balance: bal,
              });

              // Create pending action — agent will deliver this contextually
              await this.db.pendingActions.save({
                agentId: agent.id,
                type: 'payment_received',
                message: `Received ${bal} ETH at stealth address ${m.stealthAddress.slice(0, 8)}...${m.stealthAddress.slice(-4)}. This payment is private and unlinkable.`,
              });

              await this.notifs.create(
                agent.id, 'payment_received', 'Payment Received',
                `Received ${bal} ETH at stealth address ${m.stealthAddress.slice(0, 8)}...${m.stealthAddress.slice(-4)}.`,
              );

              this.logger.log(`New payment for ${agent.name}.wraith: ${bal} ETH`);
            }
          }
        }

        // Privacy auto-pilot check
        await this.privacyAutoPilot(agent.id, seen.length + matched.length);
      } catch (err: any) {
        this.logger.error(`Scan error for ${agent.name}: ${err.message}`);
      }
    }
  }

  /**
   * Privacy auto-pilot — autonomously manages stealth address accumulation.
   * When too many stealth addresses accumulate, creates a pending action
   * recommending withdrawal with privacy-safe timing.
   */
  private async privacyAutoPilot(agentId: string, stealthCount: number) {
    const settings = await this.db.settings.findOneBy({ agentId });
    const threshold = settings?.maxStealthAccumulation || 5;

    if (stealthCount <= threshold) return;

    // Check if we already warned recently (avoid spam)
    const recentAlert = await this.db.pendingActions.findOne({
      where: { agentId, type: 'privacy_alert', delivered: false },
    });
    if (recentAlert) return;

    await this.db.pendingActions.save({
      agentId,
      type: 'privacy_alert',
      message: `Privacy alert: you have ${stealthCount} stealth addresses with funds (threshold: ${threshold}). I recommend withdrawing some using different destination addresses with time delays between each withdrawal. This reduces the risk of on-chain correlation. Would you like me to help?`,
    });

    // If auto-withdraw is enabled and we have a preferred address, do it
    if (settings?.autoWithdraw && settings?.preferredWithdrawAddress) {
      try {
        const stealthKeys = await this.tee.deriveAgentStealthKeys(agentId);

        // Only withdraw the oldest stealth address to avoid pattern
        const oldest = await this.db.seenStealth.findOne({
          where: { agentId },
          order: { firstSeen: 'ASC' },
        });

        if (oldest && parseFloat(oldest.balance) > 0) {
          const result = await this.tools.withdraw(
            stealthKeys, oldest.address as Hex, settings.preferredWithdrawAddress as Hex,
          );

          if (!result.error) {
            await this.db.pendingActions.save({
              agentId,
              type: 'recommendation',
              message: `I autonomously withdrew ${result.withdrawn} ETH from your oldest stealth address to ${settings.preferredWithdrawAddress.slice(0, 8)}... for privacy maintenance. [tx](${result.txLink})`,
            });
            await this.db.seenStealth.delete({ address: oldest.address });
            this.logger.log(`Auto-withdrew from ${oldest.address.slice(0, 12)} for ${agentId.slice(0, 8)}`);
          }
        }
      } catch (err: any) {
        this.logger.error(`Auto-withdraw failed for ${agentId.slice(0, 8)}: ${err.message}`);
      }
    }
  }
}
