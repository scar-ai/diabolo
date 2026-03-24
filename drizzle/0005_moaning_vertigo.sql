CREATE TABLE "task_message" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text DEFAULT 'follow_up' NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stage" text DEFAULT 'Queued' NOT NULL,
	"logs" text,
	"response_messages" text,
	"error" text,
	"processing_started_at" timestamp,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "cancel_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "task_message" ADD CONSTRAINT "task_message_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_message_taskId_idx" ON "task_message" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_message_taskId_sequence_idx" ON "task_message" USING btree ("task_id","sequence");--> statement-breakpoint
CREATE INDEX "task_message_taskId_status_idx" ON "task_message" USING btree ("task_id","status");
