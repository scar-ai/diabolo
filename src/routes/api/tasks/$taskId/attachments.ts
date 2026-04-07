import { readFile } from "node:fs/promises";

import { createFileRoute } from "@tanstack/react-router";

import { badRequest, requireApiUser } from "@/lib/api-helpers";
import { findUserTask } from "@/lib/project/data";
import { listTaskArtifacts } from "@/lib/sandbox/store";
import {
  isTaskAttachmentMetadata,
  resolveTaskAttachmentPath,
  TASK_ATTACHMENT_ARTIFACT_TYPE,
} from "@/lib/task-attachments";

export const Route = createFileRoute("/api/tasks/$taskId/attachments")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const user = await requireApiUser(request);
        if (!user) {
          return badRequest("Unauthorized", 401);
        }

        const storageKey = new URL(request.url).searchParams.get("storageKey")?.trim();

        if (!storageKey) {
          return badRequest("Missing attachment key.");
        }

        const task = await findUserTask(params.taskId, user.id);

        if (!task) {
          return badRequest("Task not found.", 404);
        }

        const artifacts = await listTaskArtifacts(params.taskId);
        const attachment = artifacts.find(
          (artifact) =>
            artifact.type === TASK_ATTACHMENT_ARTIFACT_TYPE &&
            isTaskAttachmentMetadata(artifact.parsedMetadata) &&
            artifact.parsedMetadata.storageKey === storageKey,
        );

        if (!attachment || !isTaskAttachmentMetadata(attachment.parsedMetadata)) {
          return badRequest("Attachment not found.", 404);
        }

        const metadata = attachment.parsedMetadata;
        let content: Buffer;

        try {
          content = await readFile(resolveTaskAttachmentPath(metadata.storageKey));
        } catch {
          return badRequest("Attachment file is missing.", 404);
        }

        const dispositionType = metadata.mediaType.startsWith("image/") ? "inline" : "attachment";

        return new Response(new Uint8Array(content), {
          headers: {
            "Content-Disposition": `${dispositionType}; filename="${metadata.fileName.replaceAll('"', "")}"`,
            "Content-Length": String(content.byteLength),
            "Content-Type": metadata.mediaType || "application/octet-stream",
          },
        });
      },
    },
  },
});
