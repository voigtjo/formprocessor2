CREATE TABLE IF NOT EXISTS "fp_template_macros" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL REFERENCES "fp_templates"("id") ON DELETE cascade,
  "macro_ref" text NOT NULL REFERENCES "fp_macros"("ref") ON DELETE cascade,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_fp_template_macros_template_macro"
  ON "fp_template_macros"("template_id", "macro_ref");
