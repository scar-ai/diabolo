import { createFileRoute } from "@tanstack/react-router";

import { badRequest } from "@/lib/api-helpers";
import { handleCodexProxyChatCompletion, verifyCodexProxyToken } from "@/lib/opencode/codex";
import { findAnyLlmProviderById } from "@/lib/user/data";

export const Route = createFileRoute("/api/opencode/codex/$providerId/chat/completions" as never)({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const providerId = (params as { providerId: string }).providerId;
        const authorization = request.headers.get("authorization") || "";
        const token = authorization.replace(/^Bearer\s+/i, "").trim();

        if (!token || !verifyCodexProxyToken(providerId, token)) {
          return badRequest("Unauthorized", 401);
        }

        const provider = await findAnyLlmProviderById(providerId);

        if (!provider || provider.id !== providerId || provider.providerKind !== "codex") {
          return badRequest("Codex provider not found.", 404);
        }

        try {
          const payload = (await request.json()) as {
            messages?: Array<{
              content?: string | Array<{ text?: string; type?: string }>;
              role?: string;
            }>;
            model?: string;
            stream?: boolean;
            temperature?: number;
          };

          return await handleCodexProxyChatCompletion({
            payload,
            provider,
          });
        } catch (error) {
          return badRequest(
            error instanceof Error ? error.message : "Failed to proxy Codex request.",
            500,
          );
        }
      },
    },
  },
});
