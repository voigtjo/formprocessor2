ALTER TABLE "fp_documents" ADD COLUMN IF NOT EXISTS "template_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "fp_documents" ADD COLUMN IF NOT EXISTS "editor_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "fp_documents" ADD COLUMN IF NOT EXISTS "approver_user_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fp_documents_editor_user_id_fp_users_id_fk'
  ) THEN
    ALTER TABLE "fp_documents"
      ADD CONSTRAINT "fp_documents_editor_user_id_fp_users_id_fk"
      FOREIGN KEY ("editor_user_id") REFERENCES "public"."fp_users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fp_documents_approver_user_id_fp_users_id_fk'
  ) THEN
    ALTER TABLE "fp_documents"
      ADD CONSTRAINT "fp_documents_approver_user_id_fp_users_id_fk"
      FOREIGN KEY ("approver_user_id") REFERENCES "public"."fp_users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_documents_editor" ON "fp_documents" USING btree ("editor_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_documents_approver" ON "fp_documents" USING btree ("approver_user_id");
--> statement-breakpoint
UPDATE "fp_documents" d
SET "template_version" = COALESCE(t."version", d."template_version", 1)
FROM "fp_templates" t
WHERE d."template_id" = t."id";
--> statement-breakpoint
UPDATE "fp_documents"
SET "editor_user_id" = "assignee_user_id"
WHERE "editor_user_id" IS NULL AND "assignee_user_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "fp_documents"
SET "approver_user_id" = "reviewer_user_id"
WHERE "approver_user_id" IS NULL AND "reviewer_user_id" IS NOT NULL;
