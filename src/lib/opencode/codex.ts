import "@tanstack/react-start/server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import * as http from "node:http";

import { and, eq } from "drizzle-orm";

import { env } from "@/env/server";
import { db } from "@/lib/db";
import { userLlmProvider } from "@/lib/db/schema";
import { OPENAI_CODEX_RESPONSES_PROVIDER_ID } from "@/lib/opencode/config";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_SCOPE = "openid profile email offline_access";
const CODEX_AUTH_BASE_URL = "https://auth.openai.com";
const CODEX_TOKEN_ENDPOINT = `${CODEX_AUTH_BASE_URL}/oauth/token`;
const CODEX_RESPONSES_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_PROVIDER_KIND = "codex";
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;
const CODEX_LOGIN_REDIRECT_URI = "http://localhost:1455/auth/callback";
const CODEX_LOGIN_EXPIRY_MS = 15 * 60 * 1000;
export const CODEX_SHARED_AUTH_PROVIDER_PREFIX = "__codex-shared-auth__:";

type CodexProviderRecord = typeof userLlmProvider.$inferSelect;
type CodexProviderAccessRecord = Pick<
  CodexProviderRecord,
  | "id"
  | "oauthAccessToken"
  | "oauthAccessTokenExpiresAt"
  | "oauthRefreshToken"
  | "oauthRefreshTokenExpiresAt"
  | "oauthScope"
  | "providerKind"
>;
type CodexSharedAuthState = Pick<
  CodexProviderRecord,
  | "oauthAccessToken"
  | "oauthAccessTokenExpiresAt"
  | "oauthAuthenticatedAt"
  | "oauthDeviceCode"
  | "oauthDeviceCodeExpiresAt"
  | "oauthError"
  | "oauthPollingIntervalSeconds"
  | "oauthRefreshToken"
  | "oauthRefreshTokenExpiresAt"
  | "oauthScope"
  | "oauthUserCode"
  | "oauthVerificationUri"
  | "oauthVerificationUriComplete"
>;

type OpenAiChatCompletionRequest = {
  messages?: Array<{
    content?: string | Array<{ text?: string; type?: string }>;
    name?: string;
    role?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id?: string;
      function?: {
        arguments?: string;
        name?: string;
      };
      type?: string;
    }>;
  }>;
  model?: string;
  parallel_tool_calls?: boolean;
  stream?: boolean;
  temperature?: number;
  tool_choice?: string | { function?: { name?: string }; type?: string };
  tools?: Array<{
    function?: {
      description?: string;
      name?: string;
      parameters?: Record<string, unknown>;
      strict?: boolean;
    };
    type?: string;
  }>;
};

type CodexResponsesRequestBody = {
  instructions: string;
  input: Array<
    | {
        content: string | Array<{ text: string; type: "input_text" }>;
        role: "assistant" | "developer" | "user";
        type: "message";
      }
    | {
        arguments: string;
        call_id: string;
        name: string;
        type: "function_call";
      }
    | {
        call_id: string;
        output: string;
        type: "function_call_output";
      }
  >;
  model: string;
  parallel_tool_calls?: boolean;
  store: false;
  stream: boolean;
  temperature?: number;
  tool_choice?: "auto" | "none" | "required" | { name: string; type: "function" };
  tools?: Array<{
    description?: string;
    name: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
    type: "function";
  }>;
};

const readJson = async (response: Response) => {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getResponseErrorMessage = async (response: Response) => {
  const contentType = response.headers.get("content-type") || "";

  const payload = await readJson(response);

  if (typeof payload?.error === "string" && payload.error) {
    return payload.error;
  }

  if (typeof payload?.error_description === "string" && payload.error_description) {
    return payload.error_description;
  }

  if (typeof payload?.message === "string" && payload.message) {
    return payload.message;
  }

  if (typeof payload?.detail === "string" && payload.detail) {
    return payload.detail;
  }

  if (
    payload?.error &&
    typeof payload.error === "object" &&
    typeof (payload.error as { message?: unknown }).message === "string" &&
    (payload.error as { message: string }).message
  ) {
    return (payload.error as { message: string }).message;
  }

  const text = (await response.text().catch(() => "")).trim();

  if (
    contentType.includes("text/html") ||
    /challenge-platform|cf[-_ ]?challenge|cloudflare/i.test(text)
  ) {
    return "Codex login failed because auth.openai.com returned an HTML challenge page instead of the expected OAuth response.";
  }

  if (!text) {
    return `Request failed with status ${response.status}.`;
  }

  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
};

const extractMessageText = (message?: {
  content?: string | Array<{ text?: string; type?: string }>;
  role?: string;
}) => {
  if (!message) {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content.trim();
  }

  if (!Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .map((part) => {
      if (part?.type === "text" && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("\n")
    .trim();
};

const normalizeCodexMessageRole = (role?: string): "assistant" | "developer" | "user" => {
  if (role === "assistant" || role === "developer") {
    return role;
  }

  if (role === "system") {
    return "developer";
  }

  return "user";
};

const normalizeToolCallId = (value: string) => {
  const trimmed = value.trim();
  return trimmed || `call_${crypto.randomUUID()}`;
};

const normalizeToolChoice = (toolChoice: OpenAiChatCompletionRequest["tool_choice"]) => {
  if (toolChoice === "auto" || toolChoice === "none" || toolChoice === "required") {
    return toolChoice;
  }

  if (!toolChoice || typeof toolChoice !== "object") {
    return undefined;
  }

  const functionName =
    toolChoice.type === "function" && typeof toolChoice.function?.name === "string"
      ? toolChoice.function.name.trim()
      : "";

  return functionName ? { name: functionName, type: "function" as const } : undefined;
};

const mapCodexTools = (tools: OpenAiChatCompletionRequest["tools"]) =>
  (tools ?? [])
    .flatMap((tool) => {
      const name = tool?.function?.name?.trim();

      if (tool?.type !== "function" || !name) {
        return [];
      }

      return [
        {
          description: tool.function?.description?.trim() || undefined,
          name,
          parameters:
            tool.function?.parameters && typeof tool.function.parameters === "object"
              ? tool.function.parameters
              : undefined,
          strict: typeof tool.function?.strict === "boolean" ? tool.function.strict : undefined,
          type: "function" as const,
        },
      ];
    })
    .filter(Boolean);

const buildCodexResponsesRequestBody = (
  payload: OpenAiChatCompletionRequest & { model: string },
) => {
  const instructions =
    (payload.messages ?? [])
      .filter((message) => message?.role === "system")
      .map((message) => extractMessageText(message))
      .filter(Boolean)
      .join("\n\n") || "You are a helpful assistant.";

  const input = (payload.messages ?? []).flatMap((message) => {
    const text = extractMessageText(message);

    if (message.role === "tool") {
      const callId =
        typeof message.tool_call_id === "string" ? normalizeToolCallId(message.tool_call_id) : "";

      return callId
        ? [
            {
              call_id: callId,
              output: text || "",
              type: "function_call_output" as const,
            },
          ]
        : [];
    }

    const output: CodexResponsesRequestBody["input"] = [];

    if (text) {
      output.push({
        content: message.role === "system" ? text : [{ text, type: "input_text" as const }],
        role: normalizeCodexMessageRole(message.role),
        type: "message" as const,
      });
    }

    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        const name = toolCall?.function?.name?.trim();
        const callId =
          typeof toolCall?.id === "string" ? normalizeToolCallId(toolCall.id) : undefined;

        if (!name || !callId || toolCall?.type !== "function") {
          continue;
        }

        output.push({
          arguments: toolCall.function?.arguments?.trim() || "{}",
          call_id: callId,
          name,
          type: "function_call" as const,
        });
      }
    }

    return output;
  });

  const tools = mapCodexTools(payload.tools);

  return {
    instructions,
    input,
    model: payload.model,
    parallel_tool_calls:
      typeof payload.parallel_tool_calls === "boolean" ? payload.parallel_tool_calls : undefined,
    store: false as const,
    stream: payload.stream === true,
    temperature: payload.temperature,
    tool_choice: normalizeToolChoice(payload.tool_choice),
    tools: tools.length > 0 ? tools : undefined,
  } satisfies CodexResponsesRequestBody;
};

const extractCodexOutputText = (payload: Record<string, unknown> | null) => {
  if (!payload) {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = payload.output;

  if (Array.isArray(output)) {
    const text = output
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }

        const content = (entry as { content?: unknown }).content;

        if (!Array.isArray(content)) {
          return [];
        }

        return content.flatMap((part) => {
          if (
            part &&
            typeof part === "object" &&
            (part as { type?: unknown }).type === "output_text" &&
            typeof (part as { text?: unknown }).text === "string"
          ) {
            return [(part as { text: string }).text];
          }

          return [];
        });
      })
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
};

const parseCodexSseResponse = async (response: Response) => {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let dataBuffer = "";
  let lineBuffer = "";
  let completedResponse: Record<string, unknown> | null = null;
  const outputItems = new Map<string, Record<string, unknown>>();
  const outputTextParts: string[] = [];
  let responseId: string | null = null;
  let sawDone = false;

  const flushEvent = () => {
    const trimmed = dataBuffer.trim();
    dataBuffer = "";

    if (!trimmed || trimmed === "[DONE]") {
      return;
    }

    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      const type = typeof event.type === "string" ? event.type : "";

      if (!responseId && typeof event.response_id === "string") {
        responseId = event.response_id;
      }

      if (type === "response.output_text.delta" && typeof event.delta === "string") {
        outputTextParts.push(event.delta);
      }

      if (type === "response.output_text.done" && typeof event.text === "string") {
        outputTextParts.push(event.text);
      }

      if (
        type === "response.content_part.done" &&
        event.part &&
        typeof event.part === "object" &&
        !Array.isArray(event.part)
      ) {
        const part = event.part as Record<string, unknown>;

        if (part.type === "output_text" && typeof part.text === "string") {
          outputTextParts.push(part.text);
        }
      }

      if (
        type === "response.output_item.added" &&
        event.item &&
        typeof event.item === "object" &&
        !Array.isArray(event.item)
      ) {
        const item = event.item as Record<string, unknown>;
        const itemId = typeof item.id === "string" ? item.id : null;

        if (itemId) {
          outputItems.set(itemId, { ...item });
        }
      }

      if (
        type === "response.output_item.done" &&
        event.item &&
        typeof event.item === "object" &&
        !Array.isArray(event.item)
      ) {
        const item = event.item as Record<string, unknown>;
        const itemId = typeof item.id === "string" ? item.id : null;

        if (itemId) {
          outputItems.set(itemId, { ...(outputItems.get(itemId) ?? {}), ...item });
        }
      }

      if (
        type === "response.completed" &&
        event.response &&
        typeof event.response === "object" &&
        !Array.isArray(event.response)
      ) {
        completedResponse = event.response as Record<string, unknown>;
        if (
          outputItems.size > 0 &&
          (!Array.isArray(completedResponse.output) || completedResponse.output.length === 0)
        ) {
          completedResponse.output = Array.from(outputItems.values());
        }
        if (typeof completedResponse.id === "string") {
          responseId = completedResponse.id;
        }
        sawDone = true;
      }
    } catch {}
  };

  const processTextChunk = (text: string) => {
    lineBuffer += text;

    while (true) {
      const newlineIndex = lineBuffer.indexOf("\n");

      if (newlineIndex === -1) {
        break;
      }

      const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      lineBuffer = lineBuffer.slice(newlineIndex + 1);

      if (line.startsWith("data:")) {
        dataBuffer += `${line.slice(5).trim()}\n`;
        continue;
      }

      if (!line.trim()) {
        flushEvent();
      }
    }
  };

  if (reader) {
    while (!sawDone) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      processTextChunk(decoder.decode(value, { stream: true }));
    }

    processTextChunk(decoder.decode());
    flushEvent();
    await reader.cancel().catch(() => {});
  } else {
    processTextChunk(await response.text());
    flushEvent();
  }

  if (completedResponse) {
    return completedResponse;
  }

  return outputTextParts.length > 0
    ? ({
        id: responseId,
        output_text: outputTextParts.join(""),
      } as Record<string, unknown>)
    : null;
};

const getCodexBackendModel = (model: string, providerId: string) => {
  const trimmed = model.trim();

  for (const prefix of [`${providerId}/`, "openai-codex-responses/", "openai-codex/", "openai/"]) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }

  return trimmed;
};

const extractCodexToolCalls = (payload: Record<string, unknown> | null) => {
  if (!payload || !Array.isArray(payload.output)) {
    return [];
  }

  return payload.output.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const toolCall = item as {
      arguments?: unknown;
      call_id?: unknown;
      name?: unknown;
      type?: unknown;
    };

    if (
      toolCall.type !== "function_call" ||
      typeof toolCall.name !== "string" ||
      typeof toolCall.call_id !== "string"
    ) {
      return [];
    }

    return [
      {
        function: {
          arguments:
            typeof toolCall.arguments === "string" && toolCall.arguments.trim()
              ? toolCall.arguments
              : "{}",
          name: toolCall.name,
        },
        id: toolCall.call_id,
        type: "function" as const,
      },
    ];
  });
};

const getOpenAiFinishReason = (payload: {
  content: string;
  toolCalls: Array<{
    function: {
      arguments: string;
      name: string;
    };
    id: string;
    type: "function";
  }>;
}) => {
  if (payload.toolCalls.length > 0) {
    return "tool_calls" as const;
  }

  return payload.content ? ("stop" as const) : ("length" as const);
};

const toOpenAiChatCompletion = (payload: {
  content: string;
  id?: string | null;
  model: string;
  toolCalls?: Array<{
    function: {
      arguments: string;
      name: string;
    };
    id: string;
    type: "function";
  }>;
}) => ({
  id: payload.id || `chatcmpl-${crypto.randomUUID()}`,
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model: payload.model,
  choices: [
    {
      index: 0,
      finish_reason: getOpenAiFinishReason({
        content: payload.content,
        toolCalls: payload.toolCalls ?? [],
      }),
      message: {
        content: payload.content || null,
        role: "assistant",
        ...(payload.toolCalls?.length ? { tool_calls: payload.toolCalls } : {}),
      },
    },
  ],
});

const encodeSse = (data: string) => `data: ${data}\n\n`;

const toOpenAiStreamResponse = (payload: {
  content: string;
  id?: string | null;
  model: string;
  toolCalls?: Array<{
    function: {
      arguments: string;
      name: string;
    };
    id: string;
    type: "function";
  }>;
}) => {
  const id = payload.id || `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          encodeSse(
            JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: payload.model,
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                  },
                },
              ],
            }),
          ),
        ),
      );
      if (payload.content) {
        controller.enqueue(
          encoder.encode(
            encodeSse(
              JSON.stringify({
                id,
                object: "chat.completion.chunk",
                created,
                model: payload.model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: payload.content,
                    },
                  },
                ],
              }),
            ),
          ),
        );
      }
      for (const [index, toolCall] of (payload.toolCalls ?? []).entries()) {
        controller.enqueue(
          encoder.encode(
            encodeSse(
              JSON.stringify({
                id,
                object: "chat.completion.chunk",
                created,
                model: payload.model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index,
                          id: toolCall.id,
                          type: "function",
                          function: toolCall.function,
                        },
                      ],
                    },
                  },
                ],
              }),
            ),
          ),
        );
      }
      controller.enqueue(
        encoder.encode(
          encodeSse(
            JSON.stringify({
              id,
              object: "chat.completion.chunk",
              created,
              model: payload.model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: getOpenAiFinishReason({
                    content: payload.content,
                    toolCalls: payload.toolCalls ?? [],
                  }),
                },
              ],
            }),
          ),
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
};

const createCodexProxyTokenHash = (providerId: string) =>
  createHmac("sha256", env.BETTER_AUTH_SECRET).update(`codex-proxy:${providerId}`).digest("hex");

export const createCodexProxyToken = (providerId: string) => createCodexProxyTokenHash(providerId);

export const verifyCodexProxyToken = (providerId: string, token: string) => {
  const expected = Buffer.from(createCodexProxyTokenHash(providerId));
  const actual = Buffer.from(token);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
};

export const isCodexProvider = (provider: { providerKind?: string | null }) =>
  provider.providerKind === CODEX_PROVIDER_KIND;

export const getCodexProviderRuntimeBaseUrl = (providerId: string) =>
  new URL(`/api/opencode/codex/${providerId}`, env.VITE_BASE_URL).toString();

const toBase64Url = (value: Buffer) =>
  value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const makePkceVerifier = () => toBase64Url(randomBytes(48));

const makePkceChallenge = (verifier: string) =>
  toBase64Url(createHash("sha256").update(verifier).digest());

const makeLoginState = () => toBase64Url(randomBytes(24));

const createTokenRequestBody = (values: Record<string, string>) => {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    body.set(key, value);
  }

  return body;
};

const hasSharedCodexAuthState = (provider: Partial<CodexSharedAuthState>) =>
  Boolean(
    provider.oauthAccessToken ||
    provider.oauthRefreshToken ||
    provider.oauthDeviceCode ||
    provider.oauthUserCode ||
    provider.oauthVerificationUri ||
    provider.oauthVerificationUriComplete ||
    provider.oauthAuthenticatedAt ||
    provider.oauthError,
  );

export const getCodexSharedAuthProviderId = (userId: string) =>
  `${CODEX_SHARED_AUTH_PROVIDER_PREFIX}${userId}`;

export const isCodexSharedAuthProviderId = (providerId: string) =>
  providerId.startsWith(CODEX_SHARED_AUTH_PROVIDER_PREFIX);

const listUserCodexProviders = async (userId: string) =>
  db.query.userLlmProvider.findMany({
    where: and(
      eq(userLlmProvider.userId, userId),
      eq(userLlmProvider.providerKind, CODEX_PROVIDER_KIND),
    ),
  });

export const ensureCodexSharedAuthProvider = async (userId: string) => {
  const providerId = getCodexSharedAuthProviderId(userId);
  const existing = await db.query.userLlmProvider.findFirst({
    where: eq(userLlmProvider.id, providerId),
  });

  if (existing) {
    return existing;
  }

  await db.insert(userLlmProvider).values({
    id: providerId,
    isDefault: false,
    name: "Codex Shared Login",
    orgId: null,
    providerApiKey: null,
    providerBaseUrl: null,
    providerId: OPENAI_CODEX_RESPONSES_PROVIDER_ID,
    providerKind: CODEX_PROVIDER_KIND,
    providerModel: "gpt-5-codex",
    userId,
  });

  const created = await db.query.userLlmProvider.findFirst({
    where: eq(userLlmProvider.id, providerId),
  });

  if (!created) {
    throw new Error("Failed to create shared Codex auth provider.");
  }

  return created;
};

const pickSharedCodexAuthState = (
  providers: CodexProviderRecord[],
  preferredProviderId?: string,
): CodexSharedAuthState | null => {
  const sortedProviders = [...providers].sort((left, right) => {
    const leftScore =
      (left.id === preferredProviderId ? 8 : 0) +
      (left.oauthRefreshToken ? 4 : 0) +
      (left.oauthAccessToken ? 2 : 0) +
      (left.oauthDeviceCode ? 1 : 0);
    const rightScore =
      (right.id === preferredProviderId ? 8 : 0) +
      (right.oauthRefreshToken ? 4 : 0) +
      (right.oauthAccessToken ? 2 : 0) +
      (right.oauthDeviceCode ? 1 : 0);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    const leftAuthenticatedAt = left.oauthAuthenticatedAt?.getTime() ?? 0;
    const rightAuthenticatedAt = right.oauthAuthenticatedAt?.getTime() ?? 0;

    if (leftAuthenticatedAt !== rightAuthenticatedAt) {
      return rightAuthenticatedAt - leftAuthenticatedAt;
    }

    const leftUpdatedAt = left.updatedAt.getTime();
    const rightUpdatedAt = right.updatedAt.getTime();
    return rightUpdatedAt - leftUpdatedAt;
  });

  const provider = sortedProviders.find(hasSharedCodexAuthState);

  if (!provider) {
    return null;
  }

  return {
    oauthAccessToken: provider.oauthAccessToken,
    oauthAccessTokenExpiresAt: provider.oauthAccessTokenExpiresAt,
    oauthAuthenticatedAt: provider.oauthAuthenticatedAt,
    oauthDeviceCode: provider.oauthDeviceCode,
    oauthDeviceCodeExpiresAt: provider.oauthDeviceCodeExpiresAt,
    oauthError: provider.oauthError,
    oauthPollingIntervalSeconds: provider.oauthPollingIntervalSeconds,
    oauthRefreshToken: provider.oauthRefreshToken,
    oauthRefreshTokenExpiresAt: provider.oauthRefreshTokenExpiresAt,
    oauthScope: provider.oauthScope,
    oauthUserCode: provider.oauthUserCode,
    oauthVerificationUri: provider.oauthVerificationUri,
    oauthVerificationUriComplete: provider.oauthVerificationUriComplete,
  };
};

const updateSharedCodexAuthState = async (
  userId: string,
  values: Partial<CodexSharedAuthState>,
) => {
  await db
    .update(userLlmProvider)
    .set(values)
    .where(
      and(
        eq(userLlmProvider.userId, userId),
        eq(userLlmProvider.providerKind, CODEX_PROVIDER_KIND),
      ),
    );
};

export const getUserSharedCodexAuthState = async (
  userId: string,
  preferredProviderId?: string,
): Promise<CodexSharedAuthState | null> => {
  const providers = await listUserCodexProviders(userId);
  return pickSharedCodexAuthState(providers, preferredProviderId);
};

export const startCodexLogin = async (provider: CodexProviderRecord) => {
  const codeVerifier = makePkceVerifier();
  const codeChallenge = makePkceChallenge(codeVerifier);
  const state = makeLoginState();
  const expiresAt = new Date(Date.now() + CODEX_LOGIN_EXPIRY_MS);
  const authorizeUrl = new URL(`${CODEX_AUTH_BASE_URL}/oauth/authorize`);

  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", CODEX_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", CODEX_LOGIN_REDIRECT_URI);
  authorizeUrl.searchParams.set("scope", CODEX_SCOPE);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("id_token_add_organizations", "true");
  authorizeUrl.searchParams.set("codex_cli_simplified_flow", "true");

  if (!provider.userId) {
    throw new Error("Codex login requires a personal provider.");
  }

  await updateSharedCodexAuthState(provider.userId, {
    oauthAccessToken: null,
    oauthAccessTokenExpiresAt: null,
    oauthAuthenticatedAt: null,
    oauthDeviceCode: state,
    oauthDeviceCodeExpiresAt: expiresAt,
    oauthError: null,
    oauthPollingIntervalSeconds: null,
    oauthRefreshToken: null,
    oauthRefreshTokenExpiresAt: null,
    oauthScope: CODEX_SCOPE,
    oauthUserCode: codeVerifier,
    oauthVerificationUri: CODEX_LOGIN_REDIRECT_URI,
    oauthVerificationUriComplete: authorizeUrl.toString(),
  });

  return {
    expiresAt: expiresAt.toISOString(),
    authorizeUrl: authorizeUrl.toString(),
    redirectUri: CODEX_LOGIN_REDIRECT_URI,
  };
};

const parseCallbackInput = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("Paste the full callback URL from the browser address bar.");
  }

  const normalizedText = trimmed
    .replace(/[«»]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  const embeddedCallbackMatch = normalizedText.match(
    /(?:https?:\/\/)?localhost:1455\/auth\/callback\?[^"'`\s<>]+/i,
  );

  if (embeddedCallbackMatch) {
    const candidate = embeddedCallbackMatch[0].startsWith("http")
      ? embeddedCallbackMatch[0]
      : `http://${embeddedCallbackMatch[0]}`;

    try {
      const url = new URL(candidate);
      return {
        code: url.searchParams.get("code"),
        error: url.searchParams.get("error"),
        errorDescription: url.searchParams.get("error_description"),
        state: url.searchParams.get("state"),
      };
    } catch {}
  }

  if (trimmed.startsWith("?")) {
    const params = new URLSearchParams(trimmed);
    return {
      code: params.get("code"),
      error: params.get("error"),
      errorDescription: params.get("error_description"),
      state: params.get("state"),
    };
  }

  try {
    const url = new URL(trimmed);
    return {
      code: url.searchParams.get("code"),
      error: url.searchParams.get("error"),
      errorDescription: url.searchParams.get("error_description"),
      state: url.searchParams.get("state"),
    };
  } catch {
    throw new Error(
      "Paste a valid callback URL such as http://localhost:1455/auth/callback?code=...",
    );
  }
};

export const completeCodexLogin = async (provider: CodexProviderRecord, callbackUrl: string) => {
  if (!provider.userId) {
    throw new Error("Codex login requires a personal provider.");
  }

  if (!provider.oauthDeviceCode || !provider.oauthUserCode || !provider.oauthDeviceCodeExpiresAt) {
    throw new Error("Start Codex login before completing it.");
  }

  if (provider.oauthDeviceCodeExpiresAt.getTime() <= Date.now()) {
    throw new Error("The login session expired. Start Codex login again.");
  }

  const parsed = parseCallbackInput(callbackUrl);

  if (parsed.error) {
    throw new Error(parsed.errorDescription || parsed.error);
  }

  if (!parsed.code || !parsed.state) {
    throw new Error("The callback URL is missing the OAuth code or state.");
  }

  if (parsed.state !== provider.oauthDeviceCode) {
    throw new Error("The callback state does not match the active Codex login session.");
  }

  const response = await fetch(CODEX_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: createTokenRequestBody({
      client_id: CODEX_CLIENT_ID,
      code: parsed.code,
      code_verifier: provider.oauthUserCode,
      grant_type: "authorization_code",
      redirect_uri: CODEX_LOGIN_REDIRECT_URI,
    }),
  });

  const payload = (await readJson(response)) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    expires_in?: number;
    id_token?: string;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
  } | null;

  if (!response.ok) {
    const message = await getResponseErrorMessage(response);
    await updateSharedCodexAuthState(provider.userId, {
      oauthError: message,
    });
    throw new Error(message);
  }

  if (typeof payload?.access_token !== "string" || typeof payload.refresh_token !== "string") {
    throw new Error("Codex token exchange did not return both access and refresh tokens.");
  }

  const accessTokenExpiresAt = new Date(Date.now() + (payload.expires_in ?? 3600) * 1000);
  const refreshTokenExpiresAt =
    typeof payload.refresh_token_expires_in === "number"
      ? new Date(Date.now() + payload.refresh_token_expires_in * 1000)
      : null;
  const authenticatedAt = new Date();

  await updateSharedCodexAuthState(provider.userId, {
    oauthAccessToken: payload.access_token,
    oauthAccessTokenExpiresAt: accessTokenExpiresAt,
    oauthAuthenticatedAt: authenticatedAt,
    oauthDeviceCode: null,
    oauthDeviceCodeExpiresAt: null,
    oauthError: null,
    oauthRefreshToken: payload.refresh_token,
    oauthRefreshTokenExpiresAt: refreshTokenExpiresAt,
    oauthScope: typeof payload.scope === "string" ? payload.scope : CODEX_SCOPE,
    oauthUserCode: null,
    oauthVerificationUri: null,
    oauthVerificationUriComplete: null,
  });

  return {
    accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    authenticatedAt: authenticatedAt.toISOString(),
    status: "authorized" as const,
  };
};

export const disconnectCodexProvider = async (providerId: string) => {
  const provider = await db.query.userLlmProvider.findFirst({
    where: eq(userLlmProvider.id, providerId),
  });

  if (!provider?.userId || provider.providerKind !== CODEX_PROVIDER_KIND) {
    return;
  }

  await updateSharedCodexAuthState(provider.userId, {
    oauthAccessToken: null,
    oauthAccessTokenExpiresAt: null,
    oauthAuthenticatedAt: null,
    oauthDeviceCode: null,
    oauthDeviceCodeExpiresAt: null,
    oauthError: null,
    oauthRefreshToken: null,
    oauthRefreshTokenExpiresAt: null,
    oauthScope: null,
    oauthUserCode: null,
    oauthVerificationUri: null,
    oauthVerificationUriComplete: null,
  });
};

const callbackPageShell = (head: string, body: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  ${head}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { height: 100%; }
    body {
      min-height: 100%;
      background: #151515;
      color: rgba(255,255,255,0.936);
      font-family: "DM Sans", system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: #1c1c1c;
      border: 1px solid #282828;
      border-radius: 16px;
      padding: 40px 36px;
      text-align: center;
    }
    .icon-wrap {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 10px; }
    p { font-size: 14px; color: rgba(255,255,255,0.62); line-height: 1.6; }
    .divider { height: 1px; background: #282828; margin: 24px 0; }
    a {
      color: #9dbefe;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
    }
    a:hover { text-decoration: underline; }
    .wordmark {
      font-size: 13px;
      color: rgba(255,255,255,0.3);
      margin-top: 28px;
      letter-spacing: 0.02em;
    }
  </style>
</head>
<body>
  <div class="card">
    ${body}
  </div>
  <p class="wordmark">diabolo</p>
</body>
</html>`;

const callbackSuccessHtml = (appUrl: string) =>
  callbackPageShell(
    `<title>Codex Connected</title>`,
    `<div class="icon-wrap" style="background:rgba(18,201,5,0.12)">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#12c905" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    </div>
    <h1>Connected!</h1>
    <p>Your Codex provider is now connected.<br>Redirecting you back to the app&hellip;</p>
    <div class="divider"></div>
    <a href="${appUrl}/app/settings" id="link">Go to Settings</a>
    <script>
      var t = 3;
      var link = document.getElementById('link');
      var timer = setInterval(function() {
        t--;
        if (t <= 0) { clearInterval(timer); location.href = '${appUrl}/app/settings'; }
        else { link.textContent = 'Go to Settings (' + t + ')'; }
      }, 1000);
      link.textContent = 'Go to Settings (' + t + ')';
    </script>`,
  );

const callbackErrorHtml = (message: string, appUrl: string) =>
  callbackPageShell(
    `<title>Codex Login Failed</title>`,
    `<div class="icon-wrap" style="background:rgba(252,83,58,0.12)">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fc533a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6 6 18M6 6l12 12"/>
      </svg>
    </div>
    <h1>Login failed</h1>
    <p>${message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
    <div class="divider"></div>
    <a href="${appUrl}/app/settings">Return to Settings</a>`,
  );

const activeCallbackServers = new Map<string, http.Server>();

export const startCodexCallbackServer = (providerId: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const existing = activeCallbackServers.get(providerId);

    if (existing) {
      existing.close();
      activeCallbackServers.delete(providerId);
    }

    const appUrl = env.VITE_BASE_URL.replace(/\/$/, "");

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost:1455");

        if (url.pathname !== "/auth/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const callbackUrl = `http://localhost:1455${req.url}`;

        server.close();
        activeCallbackServers.delete(providerId);

        const provider = await db.query.userLlmProvider.findFirst({
          where: eq(userLlmProvider.id, providerId),
        });

        if (!provider) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(callbackErrorHtml("Provider not found.", appUrl));
          return;
        }

        await completeCodexLogin(provider, callbackUrl);

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(callbackSuccessHtml(appUrl));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(callbackErrorHtml(message, appUrl));
      }
    });

    server.listen(1455, "127.0.0.1", () => {
      activeCallbackServers.set(providerId, server);
      setTimeout(() => {
        if (activeCallbackServers.get(providerId) === server) {
          server.close();
          activeCallbackServers.delete(providerId);
        }
      }, CODEX_LOGIN_EXPIRY_MS + 5_000);
      resolve(true);
    });

    server.on("error", () => {
      resolve(false);
    });
  });
};

export const ensureCodexAccessToken = async (provider: CodexProviderAccessRecord) => {
  if (!isCodexProvider(provider)) {
    throw new Error("Provider is not a Codex provider.");
  }

  const fullProvider = await db.query.userLlmProvider.findFirst({
    where: eq(userLlmProvider.id, provider.id),
  });

  if (!fullProvider?.userId || fullProvider.providerKind !== CODEX_PROVIDER_KIND) {
    throw new Error("Codex provider not found.");
  }

  const sharedState =
    (await getUserSharedCodexAuthState(fullProvider.userId, provider.id)) ?? fullProvider;

  const accessTokenStillValid =
    sharedState.oauthAccessToken &&
    sharedState.oauthAccessTokenExpiresAt &&
    sharedState.oauthAccessTokenExpiresAt.getTime() > Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS;

  if (accessTokenStillValid && sharedState.oauthAccessToken) {
    return sharedState.oauthAccessToken;
  }

  if (!sharedState.oauthRefreshToken) {
    throw new Error("Connect your Codex provider before starting a task.");
  }

  const response = await fetch(CODEX_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: createTokenRequestBody({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: sharedState.oauthRefreshToken,
    }),
  });

  if (!response.ok) {
    const message = await getResponseErrorMessage(response);

    await updateSharedCodexAuthState(fullProvider.userId, {
      oauthAccessToken: null,
      oauthAccessTokenExpiresAt: null,
      oauthAuthenticatedAt: null,
      oauthError: message,
    });

    throw new Error("Codex login expired. Reconnect this provider in Settings.");
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
  };

  if (typeof payload.access_token !== "string") {
    throw new Error("Codex token refresh did not return an access token.");
  }

  const accessTokenExpiresAt = new Date(Date.now() + (payload.expires_in ?? 3600) * 1000);
  const refreshTokenExpiresAt =
    typeof payload.refresh_token_expires_in === "number"
      ? new Date(Date.now() + payload.refresh_token_expires_in * 1000)
      : sharedState.oauthRefreshTokenExpiresAt;

  await updateSharedCodexAuthState(fullProvider.userId, {
    oauthAccessToken: payload.access_token,
    oauthAccessTokenExpiresAt: accessTokenExpiresAt,
    oauthAuthenticatedAt: new Date(),
    oauthError: null,
    oauthRefreshToken: payload.refresh_token ?? sharedState.oauthRefreshToken,
    oauthRefreshTokenExpiresAt: refreshTokenExpiresAt,
    oauthScope: payload.scope ?? sharedState.oauthScope,
  });

  return payload.access_token;
};

export const CODEX_MODEL_OPTIONS = [
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
] as const;
export const listAvailableCodexModels = async (_provider: CodexProviderAccessRecord) => [
  ...CODEX_MODEL_OPTIONS,
];

const requestCodexResponse = async (input: {
  accessToken: string;
  payload: OpenAiChatCompletionRequest;
  model: string;
}) => {
  const response = await fetch(CODEX_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      Origin: "https://chatgpt.com",
      Referer: "https://chatgpt.com/",
      "User-Agent": "OpenAI/Codex",
    },
    body: JSON.stringify(
      buildCodexResponsesRequestBody({
        ...input.payload,
        model: input.model,
        stream: true,
      }),
    ),
  });

  if (!response.ok) {
    throw new Error(await getResponseErrorMessage(response));
  }

  return (await parseCodexSseResponse(response)) ?? {};
};

export const runCodexChatCompletion = async (input: {
  accessToken: string;
  payload: OpenAiChatCompletionRequest;
  model: string;
}) => {
  const payload = await requestCodexResponse({
    accessToken: input.accessToken,
    model: getCodexBackendModel(input.model, "codex"),
    payload: input.payload,
  });
  const content = extractCodexOutputText(payload);
  const toolCalls = extractCodexToolCalls(payload);

  if (!content && toolCalls.length === 0) {
    throw new Error("Codex returned an empty response.");
  }

  return toOpenAiChatCompletion({
    content,
    id: typeof payload.id === "string" ? payload.id : null,
    model: input.model,
    toolCalls,
  });
};

export const handleCodexProxyChatCompletion = async (input: {
  payload: OpenAiChatCompletionRequest;
  provider: CodexProviderRecord;
}) => {
  const accessToken = await ensureCodexAccessToken(input.provider);
  const model = getCodexBackendModel(
    input.payload.model?.trim() || input.provider.providerModel,
    input.provider.providerId,
  );
  const responsePayload = await requestCodexResponse({
    accessToken,
    model,
    payload: input.payload,
  });
  const content = extractCodexOutputText(responsePayload);
  const toolCalls = extractCodexToolCalls(responsePayload);

  if (!content && toolCalls.length === 0) {
    throw new Error("Codex returned an empty response.");
  }

  if (input.payload.stream) {
    return toOpenAiStreamResponse({
      content,
      id: typeof responsePayload.id === "string" ? responsePayload.id : null,
      model,
      toolCalls,
    });
  }

  return Response.json(
    toOpenAiChatCompletion({
      content,
      id: typeof responsePayload.id === "string" ? responsePayload.id : null,
      model,
      toolCalls,
    }),
  );
};
