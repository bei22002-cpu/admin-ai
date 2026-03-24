import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOpenClawTables1742751600000 implements MigrationInterface {
  name = 'AddOpenClawTables1742751600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "openclaw_skill_category_enum" AS ENUM (
          'website-builder', 'content-creation', 'social-media',
          'email-outreach', 'analytics', 'invoicing'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "openclaw_message_role_enum" AS ENUM ('user', 'assistant', 'system');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create openclaw_skill table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "openclaw_skill" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "description" text NOT NULL,
        "category" "openclaw_skill_category_enum" NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "instructions" text NOT NULL,
        "triggers" text[] NOT NULL DEFAULT '{}',
        "actions" jsonb NOT NULL DEFAULT '[]',
        "config" jsonb NOT NULL DEFAULT '{}',
        "isCustom" boolean NOT NULL DEFAULT false,
        "userId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_openclaw_skill" PRIMARY KEY ("id"),
        CONSTRAINT "FK_openclaw_skill_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL
      );
    `);

    // Create openclaw_conversation table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "openclaw_conversation" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "role" "openclaw_message_role_enum" NOT NULL,
        "content" text NOT NULL,
        "skillId" character varying,
        "skillName" character varying,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_openclaw_conversation" PRIMARY KEY ("id"),
        CONSTRAINT "FK_openclaw_conversation_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
      );
    `);

    // Create index on conversation for user lookup
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_openclaw_conversation_userId" ON "openclaw_conversation" ("userId");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_openclaw_conversation_createdAt" ON "openclaw_conversation" ("createdAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "openclaw_conversation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "openclaw_skill"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "openclaw_message_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "openclaw_skill_category_enum"`);
  }
}
