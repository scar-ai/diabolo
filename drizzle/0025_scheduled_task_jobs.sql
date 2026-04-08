CREATE TABLE "scheduled_task_job" (
	"id" text PRIMARY KEY NOT NULL,
	"scheduled_task_id" text NOT NULL,
	"project_id" text NOT NULL,
	"due_at" timestamp NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"locked_at" timestamp,
	"locked_by" text,
	"last_error" text,
	"created_task_id" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD COLUMN "last_enqueued_at" timestamp;--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD COLUMN "last_run_at" timestamp;--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD COLUMN "last_failure_at" timestamp;--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD COLUMN "last_alerted_at" timestamp;--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "scheduled_task" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_task_job" ADD CONSTRAINT "scheduled_task_job_scheduled_task_id_scheduled_task_id_fk" FOREIGN KEY ("scheduled_task_id") REFERENCES "public"."scheduled_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_task_job" ADD CONSTRAINT "scheduled_task_job_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_task_job" ADD CONSTRAINT "scheduled_task_job_created_task_id_task_id_fk" FOREIGN KEY ("created_task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_task_job_scheduledTaskId_idx" ON "scheduled_task_job" USING btree ("scheduled_task_id");--> statement-breakpoint
CREATE INDEX "scheduled_task_job_projectId_idx" ON "scheduled_task_job" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scheduled_task_job_status_availableAt_idx" ON "scheduled_task_job" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "scheduled_task_job_lockedAt_idx" ON "scheduled_task_job" USING btree ("locked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_task_job_scheduledTaskId_dueAt_idx" ON "scheduled_task_job" USING btree ("scheduled_task_id","due_at");