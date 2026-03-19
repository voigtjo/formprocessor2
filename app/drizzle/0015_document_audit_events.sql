CREATE TABLE IF NOT EXISTS "fp_document_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "actor_user_id" uuid,
  "actor_display" text,
  "summary" text NOT NULL,
  "detail_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fp_document_audit_events" ADD CONSTRAINT "fp_document_audit_events_document_id_fp_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fp_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fp_document_audit_events" ADD CONSTRAINT "fp_document_audit_events_actor_user_id_fp_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."fp_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_audit_events_document" ON "fp_document_audit_events" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_audit_events_event_type" ON "fp_document_audit_events" USING btree ("event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_audit_events_actor" ON "fp_document_audit_events" USING btree ("actor_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fp_document_audit_events_created_at" ON "fp_document_audit_events" USING btree ("created_at");
