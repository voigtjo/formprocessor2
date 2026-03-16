-- FormProcessor DB schema (formprocessor2)
-- P0

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS fp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  version int NOT NULL DEFAULT 1,
  published_at timestamptz,
  template_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fp_templates_key_version ON fp_templates(key, version);
ALTER TABLE fp_templates
  ADD CONSTRAINT fp_templates_state_check
  CHECK (state IN ('draft', 'published', 'archived'));

CREATE TABLE IF NOT EXISTS fp_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fp_users_username ON fp_users(username);

CREATE TABLE IF NOT EXISTS fp_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fp_groups_key ON fp_groups(key);

CREATE TABLE IF NOT EXISTS fp_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES fp_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES fp_users(id) ON DELETE CASCADE,
  rights text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fp_group_members_group_user ON fp_group_members(group_id, user_id);

CREATE TABLE IF NOT EXISTS fp_template_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES fp_templates(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES fp_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fp_template_assignments_template_group
  ON fp_template_assignments(template_id, group_id);

CREATE TABLE IF NOT EXISTS fp_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES fp_templates(id) ON DELETE RESTRICT,
  status text NOT NULL,
  group_id uuid REFERENCES fp_groups(id) ON DELETE SET NULL,
  assignee_user_id uuid REFERENCES fp_users(id) ON DELETE SET NULL,
  reviewer_user_id uuid REFERENCES fp_users(id) ON DELETE SET NULL,
  data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_refs_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshots_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fp_documents_template_status ON fp_documents(template_id, status);
CREATE INDEX IF NOT EXISTS idx_fp_documents_group ON fp_documents(group_id);
CREATE INDEX IF NOT EXISTS idx_fp_documents_assignee ON fp_documents(assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_fp_documents_reviewer ON fp_documents(reviewer_user_id);

CREATE TABLE IF NOT EXISTS fp_macros (
  ref text PRIMARY KEY,
  namespace text NOT NULL,
  name text NOT NULL,
  version int NOT NULL,
  kind text NOT NULL DEFAULT 'json',
  description text,
  is_enabled boolean NOT NULL DEFAULT true,
  params_schema_json jsonb,
  definition_json jsonb,
  code_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fp_macros_enabled ON fp_macros(is_enabled);

CREATE TABLE IF NOT EXISTS fp_template_macros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES fp_templates(id) ON DELETE CASCADE,
  macro_ref text NOT NULL REFERENCES fp_macros(ref) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fp_template_macros_template_macro
  ON fp_template_macros(template_id, macro_ref);

CREATE TABLE IF NOT EXISTS fp_apis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name text NOT NULL,
  description text,
  state text NOT NULL DEFAULT 'active',
  method text NOT NULL,
  base_url text,
  path text NOT NULL,
  request_schema_json jsonb,
  response_schema_json jsonb,
  handler_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fp_apis_key ON fp_apis(key);
CREATE INDEX IF NOT EXISTS idx_fp_apis_state ON fp_apis(state);
