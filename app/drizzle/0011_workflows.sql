ALTER TABLE "fp_templates" ADD COLUMN IF NOT EXISTS "workflow_ref" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fp_workflows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "state" text DEFAULT 'draft' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "workflow_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_fp_workflows_key_version" ON "fp_workflows" USING btree ("key","version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_workflows_state" ON "fp_workflows" USING btree ("state");
