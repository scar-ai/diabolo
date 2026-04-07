import { createFileRoute } from "@tanstack/react-router";

import { badRequest, requireApiUser } from "@/lib/api-helpers";
import { findTask, findUserTask } from "@/lib/project/data";
import { Sandbox } from "@/lib/sandbox";
import { findTaskArtifact } from "@/lib/sandbox/store";
import { isTaskScreenshotMetadata, TASK_SCREENSHOT_ARTIFACT_TYPE } from "@/lib/task-artifacts";

export const Route = createFileRoute("/api/tasks/$taskId/artifacts/$artifactId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const user = await requireApiUser(request);
        if (!user) {
          return badRequest("Unauthorized", 401);
        }

        const [taskAccess, artifact] = await Promise.all([
          findUserTask(params.taskId, user.id),
          findTaskArtifact(params.artifactId),
        ]);

        if (!taskAccess) {
          return badRequest("Task not found.", 404);
        }

        if (!artifact || artifact.taskId !== params.taskId) {
          return badRequest("Artifact not found.", 404);
        }

        if (artifact.type !== TASK_SCREENSHOT_ARTIFACT_TYPE) {
          return badRequest("Artifact is not a screenshot.", 400);
        }

        const metadata = artifact.metadata ? JSON.parse(artifact.metadata) : null;

        if (!isTaskScreenshotMetadata(metadata)) {
          return badRequest("Screenshot metadata is invalid.", 400);
        }

        const task = await findTask(params.taskId);

        if (!task) {
          return badRequest("Task not found.", 404);
        }

        if (!task.sandboxId) {
          return badRequest("Sandbox is no longer available for this screenshot.", 404);
        }

        try {
          const sandbox = await Sandbox.getProvider().getWorkspace(task.sandboxId);
          const content = await sandbox.downloadFile(metadata.sandboxPath, 180);

          return new Response(new Uint8Array(content), {
            headers: {
              "Content-Disposition": `inline; filename="${metadata.fileName.replaceAll('"', "")}"`,
              "Content-Length": String(content.byteLength),
              "Content-Type": metadata.mediaType || "application/octet-stream",
              "Cache-Control": "private, max-age=60",
            },
          });
        } catch {
          return badRequest("Screenshot file is missing from the sandbox.", 404);
        }
      },
    },
  },
});
