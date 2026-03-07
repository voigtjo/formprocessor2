CREATE TABLE "fp_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"status" text NOT NULL,
	"group_id" uuid,
	"data_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_refs_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshots_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fp_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rights" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fp_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fp_template_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"state" text DEFAULT 'active' NOT NULL,
	"template_json" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fp_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fp_documents" ADD CONSTRAINT "fp_documents_template_id_fp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."fp_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fp_group_members" ADD CONSTRAINT "fp_group_members_group_id_fp_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."fp_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fp_group_members" ADD CONSTRAINT "fp_group_members_user_id_fp_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."fp_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fp_template_assignments" ADD CONSTRAINT "fp_template_assignments_template_id_fp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."fp_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fp_template_assignments" ADD CONSTRAINT "fp_template_assignments_group_id_fp_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."fp_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fp_documents_template_status" ON "fp_documents" USING btree ("template_id","status");--> statement-breakpoint
CREATE INDEX "idx_fp_documents_group" ON "fp_documents" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_fp_group_members_group_user" ON "fp_group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_fp_groups_key" ON "fp_groups" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_fp_template_assignments_template_group" ON "fp_template_assignments" USING btree ("template_id","group_id");--> statement-breakpoint
CREATE INDEX "ux_fp_templates_key_version" ON "fp_templates" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_fp_users_username" ON "fp_users" USING btree ("username");