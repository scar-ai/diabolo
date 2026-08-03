import { createFileRoute } from "@tanstack/react-router";

import { parseRuntimeEventEnvelope } from "@/lib/opencode/protocol";
import { verifyRuntimeEventToken } from "@/lib/opencode/runtime-events";
import { ingestRuntimeEvent } from "@/lib/sandbox/run-support";

/**
 * Low-latency delivery path for sandbox runtime events.
 *
 * This is an optimisation, not a requirement: the same events also reach the app
 * on the sandbox's stdout, and ingestion is idempotent, so a sandbox that cannot
 * reach this endpoint loses only immediacy.
 */
export const Route = createFileRoute("/api/opencode/runtime-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") || "";
        const token = authorization.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length)
          : "";

        const envelope = parseRuntimeEventEnvelope(await request.json().catch(() => null));

        if (!envelope) {
          return Response.json({ error: "Malformed runtime event." }, { status: 400 });
        }

        if (!verifyRuntimeEventToken(envelope.taskId, token)) {
          return Response.json({ error: "Unauthorized runtime event." }, { status: 401 });
        }

        await ingestRuntimeEvent(envelope);

        return Response.json({ ok: true });
      },
    },
  },
});
