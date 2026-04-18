ALTER TABLE "task" ADD COLUMN "opencode_session_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "opencode_runtime_fingerprint" text;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN "opencode_user_message_id" text;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN "opencode_assistant_message_id" text;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN "replay_strategy" text;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN "replayed_at" timestamp;