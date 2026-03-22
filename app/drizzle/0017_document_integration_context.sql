ALTER TABLE "fp_documents"
ADD COLUMN IF NOT EXISTS "integration_context_json" jsonb NOT NULL DEFAULT '{}'::jsonb;
