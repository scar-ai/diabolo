/**
 * Event utilities
 * Helper functions for creating and managing structured events
 */

import type { SandboxEvent, EventType } from "./types";

export type { SandboxEvent };

/**
 * Create a structured sandbox event matching background-agents pattern
 */
export function createSandboxEvent(
  type: EventType,
  data: Record<string, unknown>,
  messageId: string | null = null,
  sandboxId: string | null = null,
): SandboxEvent {
  return {
    type,
    data,
    messageId,
    sandboxId,
    timestamp: Date.now(),
  };
}
