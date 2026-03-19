CREATE TABLE IF NOT EXISTS "fp_document_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "kind" text DEFAULT 'file' NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size" integer DEFAULT 0 NOT NULL,
  "storage_key" text NOT NULL,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fp_document_attachments" ADD CONSTRAINT "fp_document_attachments_document_id_fp_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fp_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fp_document_attachments" ADD CONSTRAINT "fp_document_attachments_uploaded_by_fp_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."fp_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_attachments_document" ON "fp_document_attachments" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_attachments_uploaded_by" ON "fp_document_attachments" USING btree ("uploaded_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_attachments_kind" ON "fp_document_attachments" USING btree ("kind");
