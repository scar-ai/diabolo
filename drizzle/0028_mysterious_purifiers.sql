ALTER TABLE "task_message" ADD COLUMN IF NOT EXISTS "model" text;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN IF NOT EXISTS "reasoning_effort" text;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN IF NOT EXISTS "queue_position" integer;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN IF NOT EXISTS "dispatched_at" timestamp;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN IF NOT EXISTS "execution_timeout_at" timestamp;
