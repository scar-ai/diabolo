# Codex Tool-Call Hang Note

## Symptom

Codex-backed tasks could appear to run forever inside OpenCode even though the model was actually emitting tool calls.

## Root Cause

The Codex Responses backend can emit tool calls in streamed `response.output_item.added` and `response.output_item.done` events while the final `response.completed` payload still contains `output: []`.

Our Codex proxy code only looked at the terminal completed payload, so it dropped the tool call and translated the turn into an empty response. That broke the OpenCode tool loop and caused tasks to hang.

## Fix

Both Codex SSE parsers now accumulate streamed output items and merge them back into the completed response before translating to OpenAI chat-completions format.

Touched files:

- `src/lib/opencode/codex.ts`
- `src/lib/sandbox/opencode.ts`

## Verified Behavior

Live probe against the configured Codex provider (`gpt-5.4`) now works:

1. First turn returns `finish_reason: "tool_calls"` with a real tool call.
2. Continuation with `tool_call_id` and tool output returns `finish_reason: "stop"` with final assistant text.

## Important Operational Detail

Already-running tasks keep the old injected sandbox proxy script. Start a fresh Codex task after this change.

## If It Regresses

Check for these conditions first:

- streamed `response.output_item.*` events are being ignored
- `response.completed` has `output: []`
- translated chat-completions response is missing `tool_calls`
- continuation turn is missing the correct `tool_call_id`
