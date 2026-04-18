import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import type { JsonObject } from "@/lib/json";
import { verifyRuntimeEventToken } from "@/lib/opencode/runtime-events";
import { recordRuntimeAgentEvent } from "@/lib/sandbox/run-support";

const runtimeEventSchema = z.object({
  messageId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  taskId: z.string().min(1),
  type: z.string().min(1),
});

export const Route = createFileRoute("/api/opencode/runtime-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") || "";
        const token = authorization.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length)
          : "";
        const input = runtimeEventSchema.parse(await request.json());

        if (!verifyRuntimeEventToken(input.taskId, token)) {
          return Response.json({ error: "Unauthorized runtime event request." }, { status: 401 });
        }

        await recordRuntimeAgentEvent({
          messageId: input.messageId,
          payload: input.payload as JsonObject,
          taskId: input.taskId,
          type: input.type,
        });

        return Response.json({ ok: true });
      },
    },
  },
});
