CREATE TABLE "task_diff_file" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"message_id" text,
	"file_path" text NOT NULL,
	"previous_path" text,
	"change_type" text DEFAULT 'modified' NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"is_binary" integer DEFAULT 0 NOT NULL,
	"truncated" integer DEFAULT 0 NOT NULL,
	"patch" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN "diff_file_count" integer;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN "diff_additions" integer;--> statement-breakpoint
ALTER TABLE "task_message" ADD COLUMN "diff_deletions" integer;--> statement-breakpoint
ALTER TABLE "task_diff_file" ADD CONSTRAINT "task_diff_file_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_diff_file" ADD CONSTRAINT "task_diff_file_message_id_task_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."task_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_diff_file_taskId_idx" ON "task_diff_file" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_diff_file_messageId_idx" ON "task_diff_file" USING btree ("message_id");