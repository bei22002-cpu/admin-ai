import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './User';

@Entity('openclaw_conversation')
export class OpenClawConversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({
    type: 'enum',
    enum: ['user', 'assistant', 'system'],
    enumName: 'openclaw_message_role_enum'
  })
  role!: 'user' | 'assistant' | 'system';

  @Column('text')
  content!: string;

  @Column({ nullable: true })
  skillId!: string;

  @Column({ nullable: true })
  skillName!: string;

  @Column('jsonb', { nullable: true })
  metadata!: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;
}
