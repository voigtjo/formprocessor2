CREATE TABLE IF NOT EXISTS "fp_macros" (
  "ref" text PRIMARY KEY NOT NULL,
  "namespace" text NOT NULL,
  "name" text NOT NULL,
  "version" integer NOT NULL,
  "description" text,
  "is_enabled" boolean NOT NULL DEFAULT true,
  "params_schema_json" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_macros_enabled" ON "fp_macros" USING btree ("is_enabled");
