ALTER TABLE "fp_macros"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'json';
--> statement-breakpoint
ALTER TABLE "fp_macros"
  ADD COLUMN IF NOT EXISTS "definition_json" jsonb;
--> statement-breakpoint
ALTER TABLE "fp_macros"
  ADD COLUMN IF NOT EXISTS "code_text" text;
--> statement-breakpoint
ALTER TABLE "fp_macros"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();
