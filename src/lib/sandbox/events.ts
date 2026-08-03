import "@tanstack/react-start/server-only";
import type { JsonObject } from "@/lib/json";
import {
  createTaskArtifact,
  createTaskEvent,
  type ParsedTaskArtifactRecord,
} from "@/lib/sandbox/store";
import { createSandboxEvent } from "@/lib/session/events";
import { broadcastTaskEvent } from "@/lib/session/server";
import type { EventType } from "@/lib/session/types";

/** Sequence used for events that live only on the wire and never in the database. */
const TRANSIENT_SEQUENCE = -1;

type PublishInput = {
  createdAt?: Date;
  messageId?: string | null;
  payload: JsonObject;
  sandboxId?: string;
  taskId: string;
  type: EventType;
};

export namespace SandboxEvents {
  /**
   * Records an event and pushes it to connected clients. Use this for anything a
   * client must still see after a reload.
   */
  export const publish = async (input: PublishInput) => {
    const event = await createTaskEvent(input);

    if (!event) {
      return null;
    }

    broadcastTaskEvent(event.taskId, {
      event: createSandboxEvent(
        event.type as EventType,
        event.parsedPayload,
        event.messageId,
        event.sandboxId,
      ),
      sequence: event.sequence,
    });

    return event;
  };

  /**
   * Pushes an event to connected clients without recording it. Use this for
   * high-frequency updates whose durable state lives elsewhere — streamed agent
   * text, for instance, is persisted on the message record itself, so writing an
   * event row per update would be thousands of rows describing one string.
   */
  export const broadcast = (input: Omit<PublishInput, "createdAt">) => {
    broadcastTaskEvent(input.taskId, {
      event: createSandboxEvent(
        input.type,
        input.payload,
        input.messageId ?? null,
        input.sandboxId ?? null,
      ),
      sequence: TRANSIENT_SEQUENCE,
    });
  };

  export const publishArtifact = async (input: {
    id?: string;
    messageId?: string | null;
    metadata?: JsonObject | null;
    taskId: string;
    type: string;
    url: string;
  }): Promise<ParsedTaskArtifactRecord> => {
    const artifact = await createTaskArtifact(input);

    await publish({
      messageId: input.messageId ?? null,
      payload: {
        artifactId: artifact.id,
        metadata: artifact.parsedMetadata,
        type: artifact.type,
        url: artifact.url,
      },
      taskId: input.taskId,
      type: "artifact",
    });

    return artifact;
  };
}
