CREATE TABLE "scheduled_task" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"schedule_cron" text NOT NULL,
	"schedule_timezone" text NOT NULL,
	"instructions" text NOT NULL,
	"branch_name" text,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD CONSTRAINT "scheduled_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD CONSTRAINT "scheduled_task_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_task_projectId_idx" ON "scheduled_task" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scheduled_task_createdByUserId_idx" ON "scheduled_task" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "scheduled_task_enabled_idx" ON "scheduled_task" USING btree ("enabled");