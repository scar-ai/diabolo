ALTER TABLE "task_message" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN "reasoning_effort" text;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN "queue_position" integer;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN "dispatched_at" timestamp;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN "execution_timeout_at" timestamp;--> statement-breakpoint
UPDATE "task_message"
SET "queue_position" = pending.position
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "task_id" ORDER BY "sequence", "created_at") AS position
  FROM "task_message"
  WHERE "status" = 'pending'
) AS pending
WHERE "task_message"."id" = pending."id";--> statement-breakpoint
