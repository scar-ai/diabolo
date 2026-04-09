ALTER TABLE "task_event" ADD COLUMN "sandbox_id" text;--> statement-breakpoint
ALTER TABLE "task_event" ADD COLUMN "timestamp" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "task_event_type_idx" ON "task_event" USING btree ("type");--> statement-breakpoint
CREATE INDEX "task_event_timestamp_idx" ON "task_event" USING btree ("timestamp");