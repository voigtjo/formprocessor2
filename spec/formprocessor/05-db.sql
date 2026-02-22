-- FormProcessor DB schema (formprocessor2)
-- P0

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS fp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name text NOT NULL,
  version int NOT NULL DEFAULT 1,
  template_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fp_templates_key_version ON fp_templates(key, version);

CREATE TABLE IF NOT EXISTS fp_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES fp_templates(id) ON DELETE RESTRICT,
  status text NOT NULL,
  data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_refs_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshots_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fp_documents_template_status ON fp_documents(template_id, status);
