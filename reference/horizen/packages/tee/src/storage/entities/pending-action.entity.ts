import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('pending_actions')
export class PendingActionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'agent_id' })
  agentId: string;

  @Column()
  type: string; // 'payment_received', 'privacy_alert', 'schedule_result', 'recommendation'

  @Column('text')
  message: string;

  @Column({ default: false })
  delivered: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
