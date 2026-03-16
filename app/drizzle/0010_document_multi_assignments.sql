CREATE TABLE IF NOT EXISTS "fp_document_editors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fp_document_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fp_document_editors" ADD CONSTRAINT "fp_document_editors_document_id_fp_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fp_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fp_document_editors" ADD CONSTRAINT "fp_document_editors_user_id_fp_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fp_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fp_document_approvals" ADD CONSTRAINT "fp_document_approvals_document_id_fp_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fp_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fp_document_approvals" ADD CONSTRAINT "fp_document_approvals_user_id_fp_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fp_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_fp_document_editors_document_user" ON "fp_document_editors" USING btree ("document_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_editors_document" ON "fp_document_editors" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_editors_user" ON "fp_document_editors" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ux_fp_document_approvals_document_user" ON "fp_document_approvals" USING btree ("document_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_approvals_document" ON "fp_document_approvals" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_approvals_user" ON "fp_document_approvals" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_approvals_status" ON "fp_document_approvals" USING btree ("status");
