export type EventType =
  | "heartbeat"
  | "token"
  | "tool_call"
  | "step_start"
  | "step_finish"
  | "tool_result"
  | "git_sync"
  | "error"
  | "execution_complete"
  | "artifact"
  | "push_complete"
  | "push_error"
  | "user_message"
  | "prompt_queued"
  | "prompt_dispatched";

export type SandboxStatus =
  | "pending"
  | "spawning"
  | "connecting"
  | "warming"
  | "syncing"
  | "ready"
  | "running"
  | "stale"
  | "snapshotting"
  | "stopped"
  | "failed";

export type SessionStatus =
  | "created"
  | "active"
  | "completed"
  | "failed"
  | "archived"
  | "cancelled";

export type MessageStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export type ArtifactType = "pr" | "screenshot" | "preview" | "branch";

export interface SandboxEvent {
  type: EventType;
  data: Record<string, unknown>;
  messageId: string | null;
  sandboxId: string | null;
  timestamp: number;
}

export interface SessionState {
  taskId: string;
  projectId: string;
  status: SessionStatus;
  sandboxStatus: SandboxStatus;
  messageCount: number;
  createdAt: number;
  isProcessing?: boolean;
}

export type ClientMessage =
  | {
      type: "ping";
    }
  | {
      cursor?: number;
      type: "fetch_history";
    }
  | {
      cursor?: number;
      type: "subscribe";
    };

export type TaskEventStreamEnvelope = {
  createdAt: Date;
  event: SandboxEvent;
  sequence: number;
  taskId: string;
  type: string;
};

export type ServerMessage =
  | {
      error: string;
      type: "error";
    }
  | {
      timestamp: number;
      type: "pong";
    }
  | {
      cursor: number | null;
      hasMore: boolean;
      items: TaskEventStreamEnvelope[];
      type: "history_page";
    }
  | {
      event: SandboxEvent;
      sequence: number;
      taskId: string;
      type: "sandbox_event";
    }
  | {
      taskId: string;
      type: "subscribed";
      userId: string;
    };

export interface WebSocketPeerContext {
  cleanup?: () => void;
  taskId?: string;
  userId?: string;
}
