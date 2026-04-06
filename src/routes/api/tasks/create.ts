import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import { Project } from "@/lib/project";
import { unwrap } from "@/lib/result";
import { SandboxEvents } from "@/lib/sandbox/events";
import {
  collectTaskAttachmentFiles,
  createTaskAttachmentMetadata,
  TASK_ATTACHMENT_ARTIFACT_TYPE,
  validateTaskAttachmentFiles,
} from "@/lib/task-attachments";

const badRequest = (error: string, status = 400) => Response.json({ error }, { status });
const getFormString = (formData: FormData, field: string) => {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
};

export const Route = createFileRoute("/api/tasks/create")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        const user = session?.user;

        if (!user) {
          return badRequest("Unauthorized", 401);
        }

        try {
          const formData = await request.formData();
          const projectId = getFormString(formData, "projectId");
          const prompt = getFormString(formData, "prompt");
          const providerId = getFormString(formData, "providerId");
          const sourceBranch = getFormString(formData, "sourceBranch");
          const files = collectTaskAttachmentFiles(formData);

          validateTaskAttachmentFiles(files);

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
              sourceBranch,
              userId: user.id,
            }),
          );

          const usedNames = new Set<string>();

          for (const file of files) {
            const metadata = await createTaskAttachmentMetadata({
              file,
              messageId: draft.messageId,
              taskId: draft.task.id,
              usedNames,
            });

            await SandboxEvents.publishArtifact({
              messageId: draft.messageId,
              metadata,
              taskId: draft.task.id,
              type: TASK_ATTACHMENT_ARTIFACT_TYPE,
              url: `/api/tasks/${draft.task.id}/attachments?storageKey=${encodeURIComponent(metadata.storageKey)}`,
            });
          }

          void unwrap(Project.queueTaskMessageForTask(draft.task.id, draft.messageId, prompt));

          return Response.json(draft.task);
        } catch (error) {
          return badRequest(error instanceof Error ? error.message : "Failed to create task.");
        }
      },
    },
  },
});
