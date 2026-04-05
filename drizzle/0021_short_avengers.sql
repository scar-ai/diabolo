ALTER TABLE "user_llm_provider" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "org_id" text;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD CONSTRAINT "user_llm_provider_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_llm_provider_org_id_idx" ON "user_llm_provider" USING btree ("org_id");