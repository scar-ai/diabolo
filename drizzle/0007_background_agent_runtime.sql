ALTER TABLE "task" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "spawn_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "sandbox_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "next_message_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "spawn_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "last_spawn_failure_at" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "last_spawn_error" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "last_heartbeat_at" timestamp;--> statement-breakpoint
CREATE TABLE "task_event" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"message_id" text,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "task_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"message_id" text,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "task_event_sequence" (
	"task_id" text PRIMARY KEY NOT NULL,
	"next_sequence" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_message_id_task_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."task_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifact" ADD CONSTRAINT "task_artifact_message_id_task_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."task_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_event_sequence" ADD CONSTRAINT "task_event_sequence_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_status_idx" ON "task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "task_sandboxStatus_idx" ON "task" USING btree ("sandbox_status");--> statement-breakpoint
CREATE INDEX "task_event_taskId_idx" ON "task_event" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_event_taskId_sequence_idx" ON "task_event" USING btree ("task_id","sequence");--> statement-breakpoint
CREATE INDEX "task_event_messageId_idx" ON "task_event" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "task_artifact_taskId_idx" ON "task_artifact" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_artifact_messageId_idx" ON "task_artifact" USING btree ("message_id");--> statement-breakpoint
UPDATE "task"
SET
  "title" = CASE
    WHEN "parent_task_id" IS NULL THEN NULL
    ELSE left(split_part(coalesce("prompt", ''), E'\n', 1), 120)
  END,
  "spawn_depth" = CASE
    WHEN "parent_task_id" IS NULL THEN 0
    ELSE 1
  END,
  "sandbox_status" = CASE
    WHEN "status" = 'queued' THEN 'pending'
    WHEN "status" = 'running' THEN 'running'
    WHEN "sandbox_id" IS NOT NULL THEN 'ready'
    WHEN "status" = 'failed' THEN 'failed'
    ELSE 'stopped'
  END,
  "next_message_sequence" = coalesce((
    SELECT max("sequence") + 1
    FROM "task_message"
    WHERE "task_message"."task_id" = "task"."id"
  ), 0),
  "last_heartbeat_at" = CASE
    WHEN "status" IN ('queued', 'running') THEN now()
    ELSE "updated_at"
  END;--> statement-breakpoint
INSERT INTO "task_event_sequence" ("task_id", "next_sequence")
SELECT
  "id",
  0
FROM "task"
ON CONFLICT ("task_id") DO NOTHING;
