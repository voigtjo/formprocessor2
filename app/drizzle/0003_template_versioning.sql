ALTER TABLE "fp_templates" ADD COLUMN IF NOT EXISTS "published_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "fp_templates" SET "state" = 'published' WHERE "state" = 'active';
--> statement-breakpoint
UPDATE "fp_templates"
SET "published_at" = COALESCE("published_at", "created_at")
WHERE "state" = 'published';
--> statement-breakpoint
ALTER TABLE "fp_templates" ALTER COLUMN "state" SET DEFAULT 'draft';
--> statement-breakpoint
ALTER TABLE "fp_templates" DROP CONSTRAINT IF EXISTS "fp_templates_state_check";
--> statement-breakpoint
ALTER TABLE "fp_templates"
ADD CONSTRAINT "fp_templates_state_check"
CHECK ("state" IN ('draft', 'published', 'archived'));
--> statement-breakpoint
DROP INDEX IF EXISTS "ux_fp_templates_key_version";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_fp_templates_key_version" ON "fp_templates" USING btree ("key","version");
