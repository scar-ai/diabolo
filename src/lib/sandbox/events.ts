import "@tanstack/react-start/server-only";
import type { JsonObject } from "@/lib/json";
import {
  createTaskArtifact,
  createTaskEvent,
  type ParsedTaskArtifactRecord,
  type ParsedTaskEventRecord,
} from "@/lib/sandbox/store";

type TaskStreamListener = (event: ParsedTaskEventRecord) => void;

const listeners = new Map<string, Set<TaskStreamListener>>();

const notify = (event: ParsedTaskEventRecord) => {
  const bucket = listeners.get(event.taskId);

  if (!bucket) {
    return;
  }

  for (const listener of bucket) {
    listener(event);
  }
};

export namespace SandboxEvents {
  export const subscribe = (taskId: string, listener: TaskStreamListener) => {
    const bucket = listeners.get(taskId) ?? new Set<TaskStreamListener>();
    bucket.add(listener);
    listeners.set(taskId, bucket);

    return () => {
      const current = listeners.get(taskId);

      if (!current) {
        return;
      }

      current.delete(listener);

      if (current.size === 0) {
        listeners.delete(taskId);
      }
    };
  };

  export const publish = async (input: {
    createdAt?: Date;
    messageId?: string | null;
    payload: JsonObject;
    taskId: string;
    type: string;
  }) => {
    const event = await createTaskEvent(input);
    notify(event);
    return event;
  };

  export const publishArtifact = async (input: {
    messageId?: string | null;
    metadata?: JsonObject | null;
    taskId: string;
    type: string;
    url: string;
  }): Promise<ParsedTaskArtifactRecord> => {
    const artifact = await createTaskArtifact(input);

    await SandboxEvents.publish({
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
