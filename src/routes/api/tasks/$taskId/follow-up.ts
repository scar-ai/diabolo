import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { badRequest, getFormString, requireApiUser } from "@/lib/api-helpers";
import { Project } from "@/lib/project";
import { unwrap } from "@/lib/result";
import { uploadTaskAttachments } from "@/lib/task-attachments";

const optionalFormString = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() || null : null;
};

const followUpOptionsSchema = z.object({
  model: z.string().trim().min(1).nullable().optional(),
  reasoningEffort: z.string().trim().min(1).nullable().optional(),
});

export const Route = createFileRoute("/api/tasks/$taskId/follow-up")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const user = await requireApiUser(request);
        if (!user) {
          return badRequest("Unauthorized", 401);
        }

        try {
          const formData = await request.formData();
          const prompt = getFormString(formData, "prompt");

          if (prompt.length < 10) {
            return badRequest("Prompt must be at least 10 characters.");
          }

          const draft = await unwrap(
            Project.prepareTaskFollowUpForUser(
              params.taskId,
              prompt,
              followUpOptionsSchema.parse({
                model: optionalFormString(formData, "model"),
                reasoningEffort: optionalFormString(formData, "reasoningEffort"),
              }),
              user.id,
            ),
          );

          await uploadTaskAttachments(formData, draft.task.id, draft.messageId);

          await unwrap(Project.queueTaskMessageForTask(draft.task.id, draft.messageId, prompt));

          return Response.json(draft.task);
        } catch (error) {
          return badRequest(
            error instanceof Error ? error.message : "Failed to queue follow-up prompt.",
          );
        }
      },
    },
  },
});
