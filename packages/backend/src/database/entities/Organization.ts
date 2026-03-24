import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('organization')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  slug!: string;

  @Column({ nullable: true })
  description!: string;

  @Column({
    type: 'enum',
    enum: ['free', 'starter', 'pro', 'enterprise'],
    default: 'free',
    enumName: 'org_plan_enum'
  })
  plan!: 'free' | 'starter' | 'pro' | 'enterprise';

  @Column({ nullable: true })
  stripeCustomerId!: string;

  @Column({ nullable: true })
  stripeSubscriptionId!: string;

  @Column('jsonb', { default: { maxUsers: 1, maxSkills: 6, maxMessages: 100 } })
  limits!: {
    maxUsers: number;
    maxSkills: number;
    maxMessages: number;
  };

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
