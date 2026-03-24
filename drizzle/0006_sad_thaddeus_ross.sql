ALTER TABLE "task" ADD COLUMN "parent_task_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "spawn_source" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "opencode_model" text;--> statement-breakpoint
CREATE INDEX "task_parentTaskId_idx" ON "task" USING btree ("parent_task_id");