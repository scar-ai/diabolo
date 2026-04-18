import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { verifySpawnTaskToken } from "@/lib/opencode/spawn-task";
import { Project } from "@/lib/project";

const requestSchema = z.object({
  model: z.string().trim().min(1).nullable().optional(),
  parentTaskId: z.string().min(1),
  prompt: z.string().min(10),
  reasoningEffort: z.string().trim().min(1).nullable().optional(),
  title: z.string().min(1),
});

export const Route = createFileRoute("/api/opencode/spawn-task")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") || "";
        const token = authorization.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length)
          : "";

        const input = requestSchema.parse(await request.json());

        if (!verifySpawnTaskToken(input.parentTaskId, token)) {
          return Response.json({ error: "Unauthorized spawn-task request." }, { status: 401 });
        }

        const result = await Project.createChildTaskForTask({
          model: input.model ?? null,
          parentTaskId: input.parentTaskId,
          prompt: input.prompt,
          reasoningEffort: input.reasoningEffort ?? null,
          title: input.title,
        });

        if (result.isErr()) {
          return Response.json({ error: result.error.message }, { status: 400 });
        }

        return Response.json({
          taskId: result.value.id,
          url: `/app/tasks/${result.value.id}`,
        });
      },
    },
  },
});
