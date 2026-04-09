# Backend Migration to Background-Agents Architecture

## Overview

This document describes the migration of the Diabolo backend to align with the background-agents architecture while preserving the existing user experience (projects, tasks, etc.).

## Changes Made

### 1. Database Schema Enhancements

**File:** `src/lib/project/project.sql.ts`

- Enhanced `task_event` table with structured event types matching background-agents:
  - Added `sandboxId` field for tracking sandbox instances
  - Added `timestamp` field for precise event timing
  - Added indexes on `type` and `timestamp` for better query performance
  - Event types now follow background-agents pattern: `heartbeat`, `token`, `tool_call`, `step_start`, `step_finish`, `tool_result`, `git_sync`, `error`, `execution_complete`, `artifact`, `push_complete`, `push_error`, `user_message`

**Migration:** Generated and applied migration `drizzle/0026_rainy_rogue.sql`

### 2. Session Management Layer

**New Files:**

- `src/lib/session/types.ts` - Shared type definitions matching background-agents
- `src/lib/session/manager.ts` - Session state management
- `src/lib/session/websocket.ts` - WebSocket server implementation
- `src/lib/session/server.ts` - WebSocket server lifecycle management
- `src/lib/session/events.ts` - Event creation and parsing utilities
- `src/lib/session/index.ts` - Module exports

**Purpose:** Provides session-based state management on top of existing task/project concepts, matching background-agents pattern without changing the UX.

### 3. WebSocket Server

**Implementation:** `src/lib/session/websocket.ts`

- Replaces SSE with WebSocket for real-time event streaming
- Follows background-agents WebSocket protocol
- Supports client messages: `ping`, `subscribe`, `prompt`, `stop`, `typing`, `presence`, `fetch_history`
- Supports server messages: `pong`, `subscribed`, `prompt_queued`, `sandbox_event`, `sandbox_warming`, `sandbox_spawning`, `sandbox_status`, `sandbox_ready`, `sandbox_error`, `artifact_created`, `processing_status`, `history_page`, `session_status`, `error`
- Broadcasts events to all clients connected to a task

### 4. Event Streaming Integration

**File:** `src/lib/sandbox/events.ts`

- Integrated WebSocket broadcasting with existing sandbox events system
- Events published via `SandboxEvents.publish()` are now automatically broadcast to WebSocket clients
- Added `sandboxId` parameter support to event publishing

**File:** `src/lib/sandbox/store.ts`

- Updated `createTaskEvent` to accept and store `sandboxId` parameter
- Events now include timestamp field for precise tracking

### 5. Frontend WebSocket Hook

**New File:** `src/lib/session/use-task-websocket.ts`

- React hook for WebSocket-based task streaming
- Replaces SSE with WebSocket when enabled
- Provides connection state and methods for sending prompts/stops

**Modified File:** `src/lib/project/use-task-stream.ts`

- Added feature flag `NEXT_PUBLIC_USE_WEBSOCKET` to enable/disable WebSocket
- Falls back to SSE when WebSocket is not enabled
- Maintains backward compatibility

## Architecture Changes

### Before

- SSE (Server-Sent Events) for streaming
- Direct task/event database access
- Simple event types
- No session abstraction

### After

- WebSocket for real-time streaming (optional via feature flag)
- Session-based state management layer
- Structured event types matching background-agents
- Event-driven architecture with broadcasting
- Preserves existing project/task concepts

## Deployment

### Environment Variables

Add to `.env`:

```bash
# Enable WebSocket streaming (set to "true" to enable)
NEXT_PUBLIC_USE_WEBSOCKET=false

# WebSocket server URL (default: ws://localhost:8787)
NEXT_PUBLIC_WS_URL=ws://localhost:8787
```

### Starting the WebSocket Server

The WebSocket server can be started separately or integrated with the main Nitro server:

```typescript
import { startWebSocketServer } from "@/lib/session/server";

// Start WebSocket server on port 8787
startWebSocketServer(8787);
```

### Database Migration

The migration has already been generated and applied:

```bash
pnpm db generate
pnpm db migrate
```

## Testing

### Enable WebSocket Streaming

Set the environment variable:

```bash
NEXT_PUBLIC_USE_WEBSOCKET=true
```

### Verify WebSocket Connection

1. Open a task in the UI
2. Check browser console for "WebSocket connected" message
3. Verify events are received in real-time

### Fallback to SSE

If WebSocket is not enabled, the system automatically falls back to the existing SSE implementation, ensuring no disruption to users.

## Future Enhancements

### Optional Infrastructure Changes

While not required for this migration, the following could be considered for closer alignment with background-agents:

1. **Cloudflare Workers + Durable Objects**: Replace Nitro with Cloudflare Workers for session state management
2. **D1 Database**: Migrate from PostgreSQL to Cloudflare D1 (SQLite)
3. **Modal Sandbox**: Replace Daytona with Modal for sandbox infrastructure
4. **GitHub App Integration**: Add GitHub App for git operations (if not already present)

These are **optional** and not required for the current migration. The existing infrastructure (PostgreSQL, Daytona, Nitro) continues to work with the new architecture.

## Preserved User Experience

The following aspects remain unchanged:

- Projects and tasks concepts
- UI/UX for task management
- Database schema for core entities (user, project, task, etc.)
- Authentication and authorization
- API routes for task creation and management

The migration only adds new capabilities (WebSocket streaming, structured events) without modifying existing functionality.

## Rollback Plan

If issues arise, the migration can be rolled back by:

1. Disable WebSocket: Set `NEXT_PUBLIC_USE_WEBSOCKET=false`
2. The system will automatically fall back to SSE
3. Database changes are additive (new fields, indexes) and don't break existing queries
4. No breaking changes to API contracts

## Notes

- The WebSocket server is currently a standalone process that needs to be started separately
- Integration with Nitro for automatic WebSocket server startup is a future enhancement
- Authentication for WebSocket connections uses a temporary token and should be updated to use the actual auth system
- The session management layer is currently in-memory; persistent session state could be added if needed
