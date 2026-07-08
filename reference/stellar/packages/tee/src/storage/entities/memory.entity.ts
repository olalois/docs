import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('agent_memory')
export class MemoryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'agent_id' })
  agentId: string;

  @Column()
  type: string; // 'preference', 'fact', 'context_summary'

  @Column('text')
  content: string;

  @Column({ default: 1 })
  importance: number; // 1-5, higher = more important

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
