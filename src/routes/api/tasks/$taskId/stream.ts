import { createFileRoute } from "@tanstack/react-router";

import { _getUser } from "@/lib/auth/functions.server";
import { Project } from "@/lib/project";
import { SandboxEvents } from "@/lib/sandbox/events";
import { listTaskEventsAfter } from "@/lib/sandbox/store";

const encoder = new TextEncoder();

const writeSseEvent = (
  controller: ReadableStreamDefaultController<Uint8Array>,
  input: {
    data: string;
    event?: string;
    id: string;
  },
) => {
  const chunks = [
    `id: ${input.id}`,
    input.event ? `event: ${input.event}` : null,
    ...input.data.split("\n").map((line) => `data: ${line}`),
    "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  controller.enqueue(encoder.encode(chunks));
};

export const Route = createFileRoute("/api/tasks/$taskId/stream")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const user = await _getUser();

        if (!user) {
          return new Response("Unauthorized", { status: 401 });
        }

        const authorized = await Project.getTaskForUser(params.taskId, user.id);

        if (authorized.isErr()) {
          return new Response("Not found", { status: 404 });
        }

        const url = new URL(request.url);
        const lastEventId = request.headers.get("last-event-id") ?? url.searchParams.get("cursor");
        const cursor = Number(lastEventId ?? "-1");
        const replay = await listTaskEventsAfter(
          params.taskId,
          Number.isFinite(cursor) ? cursor : -1,
        );

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const event of replay) {
              writeSseEvent(controller, {
                data: JSON.stringify({
                  createdAt: event.createdAt,
                  messageId: event.messageId,
                  payload: event.parsedPayload,
                  sequence: event.sequence,
                  taskId: event.taskId,
                  type: event.type,
                }),
                event: event.type,
                id: String(event.sequence),
              });
            }

            const unsubscribe = SandboxEvents.subscribe(params.taskId, (event) => {
              writeSseEvent(controller, {
                data: JSON.stringify({
                  createdAt: event.createdAt,
                  messageId: event.messageId,
                  payload: event.parsedPayload,
                  sequence: event.sequence,
                  taskId: event.taskId,
                  type: event.type,
                }),
                event: event.type,
                id: String(event.sequence),
              });
            });

            const keepAlive = setInterval(() => {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            }, 15_000);

            request.signal.addEventListener("abort", () => {
              clearInterval(keepAlive);
              unsubscribe();
              controller.close();
            });
          },
        });

        return new Response(stream, {
          headers: {
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "Content-Type": "text/event-stream",
          },
        });
      },
    },
  },
});
