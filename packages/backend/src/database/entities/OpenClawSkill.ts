import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './User';

@Entity('openclaw_skill')
export class OpenClawSkillEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column('text')
  description!: string;

  @Column({
    type: 'enum',
    enum: ['website-builder', 'content-creation', 'social-media', 'email-outreach', 'analytics', 'invoicing'],
    enumName: 'openclaw_skill_category_enum'
  })
  category!: 'website-builder' | 'content-creation' | 'social-media' | 'email-outreach' | 'analytics' | 'invoicing';

  @Column({ default: true })
  enabled!: boolean;

  @Column('text')
  instructions!: string;

  @Column('text', { array: true, default: '{}' })
  triggers!: string[];

  @Column('jsonb', { default: [] })
  actions!: Array<{
    id: string;
    name: string;
    description: string;
    endpoint?: string;
    method?: string;
    parameters: Record<string, string>;
  }>;

  @Column('jsonb', { default: {} })
  config!: Record<string, string>;

  @Column({ default: false })
  isCustom!: boolean;

  @Column({ nullable: true })
  userId!: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
