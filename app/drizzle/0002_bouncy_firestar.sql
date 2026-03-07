ALTER TABLE "fp_documents" ADD COLUMN "assignee_user_id" uuid;
ALTER TABLE "fp_documents" ADD COLUMN "reviewer_user_id" uuid;
ALTER TABLE "fp_documents" ADD CONSTRAINT "fp_documents_assignee_user_id_fp_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."fp_users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "fp_documents" ADD CONSTRAINT "fp_documents_reviewer_user_id_fp_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."fp_users"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "idx_fp_documents_assignee" ON "fp_documents" USING btree ("assignee_user_id");
CREATE INDEX "idx_fp_documents_reviewer" ON "fp_documents" USING btree ("reviewer_user_id");
