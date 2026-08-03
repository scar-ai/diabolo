import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { userLlmProvider } from "@/lib/db/schema";
import {
  CODEX_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL,
  OPENAI_CODEX_RESPONSES_PROVIDER_ID,
  OPENCODE_VERSION,
} from "@/lib/opencode/constants";
import { Sandbox } from "@/lib/sandbox";

const CODEX_PROVIDER_KIND = "codex";
const CODEX_LOGIN_EXPIRY_MS = 15 * 60 * 1000;
const OPENCODE_AUTH_SERVER_PORT = 4096;
const OPENCODE_AUTH_DATA_DIRECTORY = ".diabolo/codex-login-data";
const OPENCODE_AUTH_RESULT_FILE = ".diabolo/codex-login-result.json";
export const CODEX_SHARED_AUTH_PROVIDER_PREFIX = "__codex-shared-auth__:";

type CodexProviderRecord = typeof userLlmProvider.$inferSelect;
type OpenCodeOAuthCredential = {
  access: string;
  accountId?: string;
  expires: number;
  refresh: string;
  type: "oauth";
};
type OpenCodeAuthFile = {
  openai: OpenCodeOAuthCredential;
};

const parseOpenCodeAuth = (raw: string): OpenCodeAuthFile => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OpenCode returned an invalid auth file.");
  }

  const credential = (parsed as { openai?: Partial<OpenCodeOAuthCredential> })?.openai;

  if (
    credential?.type !== "oauth" ||
    typeof credential.access !== "string" ||
    !credential.access ||
    typeof credential.refresh !== "string" ||
    !credential.refresh ||
    typeof credential.expires !== "number"
  ) {
    throw new Error("OpenCode did not return a complete OpenAI OAuth credential.");
  }

  return {
    openai: {
      access: credential.access,
      expires: credential.expires,
      refresh: credential.refresh,
      type: "oauth",
      ...(typeof credential.accountId === "string" && credential.accountId
        ? { accountId: credential.accountId }
        : {}),
    },
  };
};

const normalizeOpenCodeAuth = (raw: string) => JSON.stringify(parseOpenCodeAuth(raw));

export const isCodexProvider = (provider: { providerKind?: string | null }) =>
  provider.providerKind === CODEX_PROVIDER_KIND;

export const getCodexSharedAuthProviderId = (userId: string) =>
  `${CODEX_SHARED_AUTH_PROVIDER_PREFIX}${userId}`;

export const isCodexSharedAuthProviderId = (providerId: string) =>
  providerId.startsWith(CODEX_SHARED_AUTH_PROVIDER_PREFIX);

const listUserCodexProviders = (userId: string) =>
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
    providerModel: DEFAULT_CODEX_MODEL,
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

const pickSharedCodexAuthState = (providers: CodexProviderRecord[], preferredProviderId?: string) =>
  [...providers].sort((left, right) => {
    const leftScore =
      (left.opencodeAuth ? 8 : 0) +
      (left.opencodeAuthSandboxId ? 4 : 0) +
      (left.id === preferredProviderId ? 2 : 0);
    const rightScore =
      (right.opencodeAuth ? 8 : 0) +
      (right.opencodeAuthSandboxId ? 4 : 0) +
      (right.id === preferredProviderId ? 2 : 0);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return right.updatedAt.getTime() - left.updatedAt.getTime();
  })[0] ?? null;

export const getUserSharedCodexAuthState = async (userId: string, preferredProviderId?: string) =>
  pickSharedCodexAuthState(await listUserCodexProviders(userId), preferredProviderId);

const updateSharedCodexAuthState = async (userId: string, values: Partial<CodexProviderRecord>) =>
  db
    .update(userLlmProvider)
    .set(values)
    .where(
      and(
        eq(userLlmProvider.userId, userId),
        eq(userLlmProvider.providerKind, CODEX_PROVIDER_KIND),
      ),
    );

const destroyLoginSandbox = async (sandboxId?: string | null) => {
  if (!sandboxId) {
    return;
  }

  await Sandbox.destroySandbox(sandboxId).match(
    () => undefined,
    () => undefined,
  );
};

const authorizeCommand = String.raw`node -e '
fetch("http://127.0.0.1:4096/provider/openai/oauth/authorize", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ method: 1 }),
}).then(async (response) => {
  const text = await response.text();
  if (!response.ok) throw new Error(text || "OpenCode authorization failed.");
  process.stdout.write(text);
}).catch((error) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exit(1);
});
'`;

const callbackCommand = String.raw`node -e '
const fs = require("node:fs/promises");
const path = require("node:path");
const resultPath = process.env.DIABOLO_CODEX_LOGIN_RESULT;
fetch("http://127.0.0.1:4096/provider/openai/oauth/callback", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ method: 1 }),
}).then(async (response) => {
  const text = await response.text();
  if (!response.ok) throw new Error(text || "OpenCode authorization callback failed.");
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, JSON.stringify({ success: true }), "utf8");
}).catch(async (error) => {
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    success: false,
  }), "utf8");
  process.exit(1);
});
'`;

export const startCodexLogin = async (provider: CodexProviderRecord) => {
  if (!provider.userId) {
    throw new Error("Codex login requires a personal provider.");
  }

  const previousState = await getUserSharedCodexAuthState(provider.userId, provider.id);
  await destroyLoginSandbox(previousState?.opencodeAuthSandboxId);
  await updateSharedCodexAuthState(provider.userId, {
    oauthDeviceCodeExpiresAt: null,
    oauthError: null,
    oauthPollingIntervalSeconds: null,
    oauthUserCode: null,
    oauthVerificationUri: null,
    oauthVerificationUriComplete: null,
    opencodeAuthSandboxId: null,
  });

  const sandbox = await Sandbox.getProvider().createWorkspace("codex-login", {
    autoDeleteInterval: 30,
    autoStopInterval: 30,
  });

  try {
    const workspaceRoot = await sandbox.getWorkspaceRoot();
    const dataDirectory = `${workspaceRoot}/${OPENCODE_AUTH_DATA_DIRECTORY}`;
    const resultPath = `${workspaceRoot}/${OPENCODE_AUTH_RESULT_FILE}`;
    const installedVersion = await sandbox.executeCommand("opencode --version", {
      cwd: workspaceRoot,
      timeoutSeconds: 15,
    });

    if (installedVersion.exitCode !== 0 || installedVersion.output.trim() !== OPENCODE_VERSION) {
      throw new Error(
        `OpenCode ${OPENCODE_VERSION} is required. Rebuild the Daytona browser snapshot with pnpm daytona:snapshot.`,
      );
    }

    await sandbox.startBackgroundCommand(
      `opencode serve --pure --hostname 127.0.0.1 --port ${OPENCODE_AUTH_SERVER_PORT}`,
      {
        cwd: workspaceRoot,
        envVars: { XDG_DATA_HOME: dataDirectory },
      },
    );

    const ready = await sandbox.executeCommand(
      `for attempt in $(seq 1 50); do if curl -fsS http://127.0.0.1:${OPENCODE_AUTH_SERVER_PORT}/global/health >/dev/null; then exit 0; fi; sleep 0.2; done; exit 1`,
      { cwd: workspaceRoot, timeoutSeconds: 15 },
    );

    if (ready.exitCode !== 0) {
      throw new Error("OpenCode login server failed to start.");
    }

    const authorization = await sandbox.executeCommand(authorizeCommand, {
      cwd: workspaceRoot,
      timeoutSeconds: 30,
    });

    if (authorization.exitCode !== 0) {
      throw new Error(authorization.output.trim() || "OpenCode failed to start Codex login.");
    }

    const payload = JSON.parse(authorization.output) as {
      instructions?: string;
      url?: string;
    };
    const userCode = payload.instructions?.match(/Enter code:\s*(.+)$/i)?.[1]?.trim();

    if (!payload.url || !userCode) {
      throw new Error("OpenCode returned an incomplete Codex login request.");
    }

    await sandbox.startBackgroundCommand(callbackCommand, {
      cwd: workspaceRoot,
      envVars: { DIABOLO_CODEX_LOGIN_RESULT: resultPath },
    });

    const expiresAt = new Date(Date.now() + CODEX_LOGIN_EXPIRY_MS);
    await updateSharedCodexAuthState(provider.userId, {
      oauthAuthenticatedAt: null,
      oauthDeviceCodeExpiresAt: expiresAt,
      oauthError: null,
      oauthPollingIntervalSeconds: "3",
      oauthUserCode: userCode,
      oauthVerificationUri: payload.url,
      oauthVerificationUriComplete: payload.url,
      opencodeAuth: null,
      opencodeAuthSandboxId: sandbox.id,
    });

    return {
      expiresAt: expiresAt.toISOString(),
      intervalSeconds: 3,
      userCode,
      verificationUrl: payload.url,
    };
  } catch (error) {
    await destroyLoginSandbox(sandbox.id);
    await updateSharedCodexAuthState(provider.userId, {
      oauthError: error instanceof Error ? error.message : "OpenCode failed to start Codex login.",
      opencodeAuthSandboxId: null,
    });
    throw error;
  }
};

export const pollCodexLogin = async (provider: CodexProviderRecord) => {
  if (!provider.userId) {
    throw new Error("Codex login requires a personal provider.");
  }

  const state = (await getUserSharedCodexAuthState(provider.userId, provider.id)) ?? provider;
  const sandboxId = state.opencodeAuthSandboxId;

  if (!sandboxId || !state.oauthDeviceCodeExpiresAt) {
    throw new Error("Start Codex login before completing it.");
  }

  if (state.oauthDeviceCodeExpiresAt.getTime() <= Date.now()) {
    await destroyLoginSandbox(sandboxId);
    await updateSharedCodexAuthState(provider.userId, {
      oauthDeviceCodeExpiresAt: null,
      oauthPollingIntervalSeconds: null,
      oauthUserCode: null,
      oauthVerificationUri: null,
      oauthVerificationUriComplete: null,
      opencodeAuthSandboxId: null,
    });
    return { status: "expired" as const };
  }

  let sandbox: Sandbox.Session;

  try {
    sandbox = await Sandbox.getProvider().getWorkspace(sandboxId);
  } catch {
    const message = "The OpenCode login session expired. Start sign-in again.";
    await updateSharedCodexAuthState(provider.userId, {
      oauthError: message,
      opencodeAuthSandboxId: null,
    });
    throw new Error(message);
  }

  const workspaceRoot = await sandbox.getWorkspaceRoot();
  const resultPath = `${workspaceRoot}/${OPENCODE_AUTH_RESULT_FILE}`;
  const result = await sandbox.executeCommand(
    `if [ -f '${resultPath}' ]; then cat '${resultPath}'; fi`,
    { cwd: workspaceRoot, timeoutSeconds: 15 },
  );

  if (!result.output.trim()) {
    return { status: "pending" as const };
  }

  const callbackResult = JSON.parse(result.output) as { error?: string; success?: boolean };

  if (!callbackResult.success) {
    const message = callbackResult.error?.trim() || "OpenCode failed to complete Codex login.";
    await destroyLoginSandbox(sandboxId);
    await updateSharedCodexAuthState(provider.userId, {
      oauthError: message,
      opencodeAuthSandboxId: null,
    });
    throw new Error(message);
  }

  const authPath = `${workspaceRoot}/${OPENCODE_AUTH_DATA_DIRECTORY}/opencode/auth.json`;
  const auth = normalizeOpenCodeAuth((await sandbox.downloadFile(authPath)).toString("utf8"));
  const authenticatedAt = new Date();

  await updateSharedCodexAuthState(provider.userId, {
    oauthAuthenticatedAt: authenticatedAt,
    oauthDeviceCodeExpiresAt: null,
    oauthError: null,
    oauthPollingIntervalSeconds: null,
    oauthUserCode: null,
    oauthVerificationUri: null,
    oauthVerificationUriComplete: null,
    opencodeAuth: auth,
    opencodeAuthSandboxId: null,
  });
  await destroyLoginSandbox(sandboxId);

  return {
    authenticatedAt: authenticatedAt.toISOString(),
    status: "approved" as const,
  };
};

export const disconnectCodexProvider = async (providerId: string) => {
  const provider = await db.query.userLlmProvider.findFirst({
    where: eq(userLlmProvider.id, providerId),
  });

  if (!provider?.userId || !isCodexProvider(provider)) {
    return;
  }

  const state = await getUserSharedCodexAuthState(provider.userId, providerId);
  await destroyLoginSandbox(state?.opencodeAuthSandboxId);
  await updateSharedCodexAuthState(provider.userId, {
    oauthAuthenticatedAt: null,
    oauthDeviceCodeExpiresAt: null,
    oauthError: null,
    oauthPollingIntervalSeconds: null,
    oauthUserCode: null,
    oauthVerificationUri: null,
    oauthVerificationUriComplete: null,
    opencodeAuth: null,
    opencodeAuthSandboxId: null,
  });
};

export const getCodexOpenCodeAuth = async (
  provider: Pick<CodexProviderRecord, "id" | "providerKind">,
) => {
  if (!isCodexProvider(provider)) {
    throw new Error("Codex provider not found.");
  }

  const fullProvider = await db.query.userLlmProvider.findFirst({
    where: eq(userLlmProvider.id, provider.id),
  });

  if (!fullProvider?.userId || !isCodexProvider(fullProvider)) {
    throw new Error("Codex provider not found.");
  }

  const state =
    (await getUserSharedCodexAuthState(fullProvider.userId, provider.id)) ?? fullProvider;

  if (!state.opencodeAuth) {
    throw new Error("Connect your Codex provider before starting a task.");
  }

  return normalizeOpenCodeAuth(state.opencodeAuth);
};

export const saveCodexOpenCodeAuth = async (providerId: string, raw: string) => {
  const provider = await db.query.userLlmProvider.findFirst({
    where: eq(userLlmProvider.id, providerId),
  });

  if (!provider?.userId || !isCodexProvider(provider)) {
    return;
  }

  await updateSharedCodexAuthState(provider.userId, {
    oauthAuthenticatedAt: new Date(),
    oauthError: null,
    opencodeAuth: normalizeOpenCodeAuth(raw),
  });
};

export const listAvailableCodexModels = async (_provider: CodexProviderRecord) => [
  ...CODEX_MODEL_OPTIONS,
];
