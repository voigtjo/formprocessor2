CREATE TABLE IF NOT EXISTS "fp_apis" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "state" text DEFAULT 'active' NOT NULL,
  "method" text NOT NULL,
  "base_url" text NOT NULL,
  "path" text NOT NULL,
  "headers_json" jsonb,
  "query_json" jsonb,
  "body_template_json" jsonb,
  "response_mapping_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ux_fp_apis_key" ON "fp_apis" USING btree ("key");
CREATE INDEX IF NOT EXISTS "idx_fp_apis_state" ON "fp_apis" USING btree ("state");
