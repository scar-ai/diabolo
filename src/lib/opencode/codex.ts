import "@tanstack/react-start/server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";

import { env } from "@/env/server";
import { db } from "@/lib/db";
import { userLlmProvider } from "@/lib/db/schema";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_SCOPE = "openid profile email offline_access";
const CODEX_AUTH_BASE_URL = "https://auth.openai.com";
const CODEX_TOKEN_ENDPOINT = `${CODEX_AUTH_BASE_URL}/oauth/token`;
const CODEX_RESPONSES_ENDPOINT = "https://chatgpt.com/backend-api/responses";
const CODEX_PROVIDER_KIND = "codex";
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;
const CODEX_LOGIN_REDIRECT_URI = "http://localhost:1455/auth/callback";
const CODEX_LOGIN_EXPIRY_MS = 15 * 60 * 1000;

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

type OpenAiChatCompletionRequest = {
  messages?: Array<{
    content?: string | Array<{ text?: string; type?: string }>;
    role?: string;
  }>;
  model?: string;
  stream?: boolean;
  temperature?: number;
};

type CodexResponsesRequestBody = {
  input: Array<{
    content: string | Array<{ text: string; type: "input_text" }>;
    role: "assistant" | "developer" | "user";
    type: "message";
  }>;
  model: string;
  store: false;
  stream: false;
  temperature?: number;
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

const buildCodexResponsesRequestBody = (
  payload: OpenAiChatCompletionRequest & { model: string },
) => {
  const input = (payload.messages ?? [])
    .map((message) => {
      const text = extractMessageText(message);

      if (!text) {
        return null;
      }

      return {
        content: message.role === "system" ? text : [{ text, type: "input_text" as const }],
        role: normalizeCodexMessageRole(message.role),
        type: "message" as const,
      };
    })
    .filter((message): message is NonNullable<typeof message> => Boolean(message));

  return {
    input,
    model: payload.model,
    store: false as const,
    stream: false as const,
    temperature: payload.temperature,
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

const getCodexBackendModel = (model: string, providerId: string) => {
  const prefix = `${providerId}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
};

const toOpenAiChatCompletion = (payload: {
  content: string;
  id?: string | null;
  model: string;
}) => ({
  id: payload.id || `chatcmpl-${crypto.randomUUID()}`,
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model: payload.model,
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: payload.content,
      },
    },
  ],
});

const encodeSse = (data: string) => `data: ${data}\n\n`;

const toOpenAiStreamResponse = (payload: {
  content: string;
  id?: string | null;
  model: string;
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
                    content: payload.content,
                  },
                  finish_reason: "stop",
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

  await db
    .update(userLlmProvider)
    .set({
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
    })
    .where(eq(userLlmProvider.id, provider.id));

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
    await db
      .update(userLlmProvider)
      .set({
        oauthError: message,
      })
      .where(eq(userLlmProvider.id, provider.id));
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

  await db
    .update(userLlmProvider)
    .set({
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
    })
    .where(eq(userLlmProvider.id, provider.id));

  return {
    accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    authenticatedAt: authenticatedAt.toISOString(),
    status: "authorized" as const,
  };
};

export const disconnectCodexProvider = async (providerId: string) => {
  await db
    .update(userLlmProvider)
    .set({
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
    })
    .where(eq(userLlmProvider.id, providerId));
};

export const ensureCodexAccessToken = async (provider: CodexProviderAccessRecord) => {
  if (!isCodexProvider(provider)) {
    throw new Error("Provider is not a Codex provider.");
  }

  const accessTokenStillValid =
    provider.oauthAccessToken &&
    provider.oauthAccessTokenExpiresAt &&
    provider.oauthAccessTokenExpiresAt.getTime() > Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS;

  if (accessTokenStillValid && provider.oauthAccessToken) {
    return provider.oauthAccessToken;
  }

  if (!provider.oauthRefreshToken) {
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
      refresh_token: provider.oauthRefreshToken,
    }),
  });

  if (!response.ok) {
    const message = await getResponseErrorMessage(response);

    await db
      .update(userLlmProvider)
      .set({
        oauthAccessToken: null,
        oauthAccessTokenExpiresAt: null,
        oauthAuthenticatedAt: null,
        oauthError: message,
      })
      .where(eq(userLlmProvider.id, provider.id));

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
      : provider.oauthRefreshTokenExpiresAt;

  await db
    .update(userLlmProvider)
    .set({
      oauthAccessToken: payload.access_token,
      oauthAccessTokenExpiresAt: accessTokenExpiresAt,
      oauthAuthenticatedAt: new Date(),
      oauthError: null,
      oauthRefreshToken: payload.refresh_token ?? provider.oauthRefreshToken,
      oauthRefreshTokenExpiresAt: refreshTokenExpiresAt,
      oauthScope: payload.scope ?? provider.oauthScope,
    })
    .where(eq(userLlmProvider.id, provider.id));

  return payload.access_token;
};

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
      }),
    ),
  });

  if (!response.ok) {
    throw new Error(await getResponseErrorMessage(response));
  }

  return (await response.json()) as Record<string, unknown>;
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

  if (!content) {
    throw new Error("Codex returned an empty response.");
  }

  return toOpenAiChatCompletion({
    content,
    id: typeof payload.id === "string" ? payload.id : null,
    model: input.model,
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

  if (!content) {
    throw new Error("Codex returned an empty response.");
  }

  if (input.payload.stream) {
    return toOpenAiStreamResponse({
      content,
      id: typeof responsePayload.id === "string" ? responsePayload.id : null,
      model,
    });
  }

  return Response.json(
    toOpenAiChatCompletion({
      content,
      id: typeof responsePayload.id === "string" ? responsePayload.id : null,
      model,
    }),
  );
};
