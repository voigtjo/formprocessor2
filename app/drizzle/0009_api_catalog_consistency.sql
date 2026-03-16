ALTER TABLE "fp_apis"
  ALTER COLUMN "base_url" DROP NOT NULL;

ALTER TABLE "fp_apis"
  ADD COLUMN IF NOT EXISTS "request_schema_json" jsonb;

ALTER TABLE "fp_apis"
  ADD COLUMN IF NOT EXISTS "response_schema_json" jsonb;

ALTER TABLE "fp_apis"
  ADD COLUMN IF NOT EXISTS "handler_code" text;
