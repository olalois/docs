import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('agents')
export class AgentEntity {
  @PrimaryColumn()
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ name: 'owner_wallet', type: 'varchar', nullable: true })
  ownerWallet: string | null;

  @Column({ name: 'address' })
  address: string;

  @Column({ name: 'meta_address' })
  metaAddress: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
