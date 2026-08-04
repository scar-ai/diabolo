import { createFileRoute } from "@tanstack/react-router";

import { badRequest, getFormString, requireApiUser } from "@/lib/api-helpers";
import { Project } from "@/lib/project";
import { unwrap } from "@/lib/result";
import { uploadTaskAttachments } from "@/lib/task-attachments";

const optionalFormString = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() || null : null;
};

export const Route = createFileRoute("/api/tasks/create")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireApiUser(request);
        if (!user) {
          return badRequest("Unauthorized", 401);
        }

        try {
          const formData = await request.formData();
          const projectId = getFormString(formData, "projectId");
          const prompt = getFormString(formData, "prompt");
          const providerId = getFormString(formData, "providerId");
          const reasoningEffort = optionalFormString(formData, "reasoningEffort");
          const sandboxTier = optionalFormString(formData, "sandboxTier");
          const sourceBranch = getFormString(formData, "sourceBranch");

          if (projectId.length < 1) {
            return badRequest("Project is required.");
          }

          if (sourceBranch.length < 1) {
            return badRequest("Source branch is required.");
          }

          if (prompt.length < 10) {
            return badRequest("Prompt must be at least 10 characters.");
          }

          const draft = await unwrap(
            Project.createTaskDraftForUser({
              providerId: providerId || null,
              projectId,
              prompt,
              reasoningEffort,
              sandboxTier,
              sourceBranch,
              userId: user.id,
            }),
          );

          await uploadTaskAttachments(formData, draft.task.id, draft.messageId);

          await unwrap(Project.queueTaskMessageForTask(draft.task.id, draft.messageId, prompt));

          return Response.json(draft.task);
        } catch (error) {
          return badRequest(error instanceof Error ? error.message : "Failed to create task.");
        }
      },
    },
  },
});
