export type EventType =
  /**
   * The agent's text, as ordered blocks. Broadcast only — its durable home is
   * the message record, so it never appears in event history.
   */
  | "agent_text"
  /**
   * The model's thinking, as ordered blocks. Broadcast only, and unlike
   * `agent_text` it has no durable home at all — it exists to show live
   * progress and is gone on reload by design.
   */
  | "agent_reasoning"
  | "artifact"
  | "child_task_update"
  | "error"
  | "execution_complete"
  | "heartbeat"
  | "log"
  | "prompt_dispatched"
  | "prompt_queued"
  | "sandbox_status"
  | "task_stage"
  /** Running token totals. Broadcast only — billed usage is reconciled separately. */
  | "token_usage"
  | "tool_call"
  | "tool_result"
  | "user_message";

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
