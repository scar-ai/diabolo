import { defineWebSocketHandler } from "nitro";

import { auth } from "@/lib/auth/auth";
import { findUserTask } from "@/lib/project/data";
import { listTaskEventsAfter } from "@/lib/sandbox/store";
import { registerTaskPeer } from "@/lib/session/server";
import type {
  ClientMessage,
  ServerMessage,
  TaskEventStreamEnvelope,
  WebSocketPeerContext,
} from "@/lib/session/types";

const sendMessage = (peer: { send(data: unknown): void }, message: ServerMessage) => {
  peer.send(JSON.stringify(message));
};

const parseTaskId = (request: Request) =>
  new URL(request.url).searchParams.get("taskId")?.trim() ?? "";

const buildReplayEnvelope = (event: Awaited<ReturnType<typeof listTaskEventsAfter>>[number]) =>
  ({
    createdAt: event.createdAt,
    event: {
      data: event.parsedPayload,
      messageId: event.messageId,
      sandboxId: event.sandboxId,
      timestamp: new Date(event.timestamp).getTime(),
      type: event.type as TaskEventStreamEnvelope["event"]["type"],
    },
    sequence: event.sequence,
    taskId: event.taskId,
    type: event.type,
  }) satisfies TaskEventStreamEnvelope;

export default defineWebSocketHandler({
  async upgrade(request) {
    const taskId = parseTaskId(request);

    if (!taskId) {
      return new Response("Task ID required.", { status: 400 });
    }

    const session = await auth.api.getSession({ headers: request.headers });
    const user = session?.user ?? null;

    if (!user) {
      return new Response("Unauthorized.", { status: 401 });
    }

    const task = await findUserTask(taskId, user.id);

    if (!task) {
      return new Response("Task not found.", { status: 404 });
    }

    return {
      context: {
        taskId,
        userId: user.id,
      } satisfies WebSocketPeerContext,
    };
  },

  open(peer) {
    const context = peer.context as WebSocketPeerContext;

    if (!context.taskId || !context.userId) {
      peer.close(1008, "Unauthorized");
      return;
    }

    registerTaskPeer(context.taskId, peer);
  },

  async message(peer, incoming) {
    const context = peer.context as WebSocketPeerContext;

    if (!context.taskId || !context.userId) {
      peer.close(1008, "Unauthorized");
      return;
    }

    let message: ClientMessage;

    try {
      message = incoming.json<ClientMessage>();
    } catch {
      sendMessage(peer, {
        error: "Invalid websocket message payload.",
        type: "error",
      });
      return;
    }

    switch (message.type) {
      case "ping":
        sendMessage(peer, {
          timestamp: Date.now(),
          type: "pong",
        });
        return;

      case "fetch_history":
      case "subscribe": {
        const cursor = typeof message.cursor === "number" ? message.cursor : -1;
        const replay = await listTaskEventsAfter(context.taskId, cursor);

        sendMessage(peer, {
          cursor: replay.at(-1)?.sequence ?? null,
          hasMore: false,
          items: replay.map(buildReplayEnvelope),
          type: "history_page",
        });

        if (message.type === "subscribe") {
          sendMessage(peer, {
            taskId: context.taskId,
            type: "subscribed",
            userId: context.userId,
          });
        }

        return;
      }

      default:
        sendMessage(peer, {
          error: "Unsupported websocket message type.",
          type: "error",
        });
    }
  },

  close(peer) {
    const cleanup = peer.context?.cleanup;
    if (typeof cleanup === "function") {
      cleanup();
    }
  },
});
