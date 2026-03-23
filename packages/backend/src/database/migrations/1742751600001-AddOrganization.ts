import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrganization1742751600001 implements MigrationInterface {
  name = 'AddOrganization1742751600001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create plan enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "org_plan_enum" AS ENUM ('free', 'starter', 'pro', 'enterprise');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create organization table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organization" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "slug" character varying NOT NULL UNIQUE,
        "description" character varying,
        "plan" "org_plan_enum" NOT NULL DEFAULT 'free',
        "stripeCustomerId" character varying,
        "stripeSubscriptionId" character varying,
        "limits" jsonb NOT NULL DEFAULT '{"maxUsers": 1, "maxSkills": 6, "maxMessages": 100}',
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organization" PRIMARY KEY ("id")
      );
    `);

    // Add organizationId to user table
    await queryRunner.query(`
      ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "organizationId" uuid;
    `);

    await queryRunner.query(`
      ALTER TABLE "user" ADD CONSTRAINT "FK_user_organization"
      FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
      ON DELETE SET NULL;
    `);

    // Create index
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_organizationId" ON "user" ("organizationId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "FK_user_organization"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "organizationId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organization"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "org_plan_enum"`);
  }
}
