import "@tanstack/react-start/server-only";
import type { SandboxEvent, ServerMessage, WebSocketPeerContext } from "./types";

type SessionPeer = {
  context: Record<string, unknown>;
  send(data: unknown): void;
};

const peersByTaskId = new Map<string, Set<SessionPeer>>();

const sendMessage = (peer: SessionPeer, message: ServerMessage) => {
  peer.send(JSON.stringify(message));
};

export const registerTaskPeer = (taskId: string, peer: SessionPeer) => {
  const peers = peersByTaskId.get(taskId) ?? new Set<SessionPeer>();
  peers.add(peer);
  peersByTaskId.set(taskId, peers);

  const cleanup = () => {
    const current = peersByTaskId.get(taskId);

    if (!current) {
      return;
    }

    current.delete(peer);

    if (current.size === 0) {
      peersByTaskId.delete(taskId);
    }
  };

  const context = peer.context as WebSocketPeerContext;
  context.cleanup = cleanup;

  return cleanup;
};

export const broadcastTaskEvent = (
  taskId: string,
  payload: {
    event: SandboxEvent;
    sequence: number;
  },
) => {
  const peers = peersByTaskId.get(taskId);

  if (!peers?.size) {
    return;
  }

  const message: ServerMessage = {
    event: payload.event,
    sequence: payload.sequence,
    taskId,
    type: "sandbox_event",
  };

  for (const peer of peers) {
    sendMessage(peer, message);
  }
};
