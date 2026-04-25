import { Buffer } from "node:buffer";

export const OPENCODE_SERVER_PORT = 4096;

export const OPENCODE_RUNTIME_SCRIPT = String.raw`import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

const repoPath = process.cwd();
const stateDir = path.join(repoPath, ".diabolo", "opencode");
const artifactsDir = path.join(repoPath, ".opencode", "artifacts");
const configPath = path.join(repoPath, ".opencode.generated.json");
const proxyScriptPath = path.join(repoPath, ".diabolo", "codex-openai-proxy.mjs");
const sessionPath = path.join(stateDir, "session.json");
const runtimeStatePath = path.join(stateDir, "runtime-state.json");
const serverPidPath = path.join(stateDir, "server.pid");
const proxyPidPath = path.join(stateDir, "proxy.pid");
const serverLogPath = path.join(artifactsDir, "opencode-serve.log");
const proxyLogPath = path.join(artifactsDir, "codex-proxy.log");
const usageLogPath = path.join(artifactsDir, "opencode-usage.jsonl");
const serverPort = Number(process.env.OPENCODE_SERVER_PORT || "4096");
const serverBaseUrl = "http://127.0.0.1:" + serverPort;
const proxyBaseUrl = (process.env.OPENCODE_CODEX_PROXY_BASE_URL || "http://127.0.0.1:4312").replace(/\/+$/, "");
const serverHealthUrl = serverBaseUrl + "/global/health";
const proxyHealthUrl = process.env.OPENCODE_CODEX_PROXY_HEALTH_URL || proxyBaseUrl + "/health";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeEnvBase64 = (name) => {
  const raw = process.env[name] || "";
  const normalized = raw.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");

  if (!normalized) {
    return "";
  }

  return Buffer.from(normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4), "base64").toString(
    "utf8",
  );
};

const readJson = async (targetPath) => {
  try {
    return JSON.parse(await fsp.readFile(targetPath, "utf8"));
  } catch {
    return null;
  }
};

const writeJson = async (targetPath, value) => {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.writeFile(targetPath, JSON.stringify(value, null, 2) + "\n", "utf8");
};

const pidIsRunning = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const killPidFile = async (pidPath) => {
  const raw = await fsp.readFile(pidPath, "utf8").catch(() => "");
  const pid = Number(raw.trim());

  if (pidIsRunning(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}

    for (let i = 0; i < 25; i += 1) {
      if (!pidIsRunning(pid)) {
        break;
      }

      await delay(200);
    }

    if (pidIsRunning(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }

  await fsp.rm(pidPath, { force: true }).catch(() => {});
};

const writeTextFile = async (targetPath, content) => {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.writeFile(targetPath, content, "utf8");
};

const ensureRuntimeFiles = async () => {
  await fsp.mkdir(stateDir, { recursive: true });
  await fsp.mkdir(artifactsDir, { recursive: true });
  await writeTextFile(configPath, decodeEnvBase64("OPENCODE_CONFIG_CONTENT_B64"));

  const proxyScript = decodeEnvBase64("OPENCODE_CODEX_PROXY_SCRIPT_B64");
  if (proxyScript) {
    await writeTextFile(proxyScriptPath, proxyScript);
  }
};

const httpJson = async (url, init = {}) => {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {}

  if (!response.ok) {
    const message =
      (payload && typeof payload.error === "string" && payload.error) ||
      (payload && typeof payload.message === "string" && payload.message) ||
      text ||
      ("HTTP " + response.status);
    throw new Error(message);
  }

  return payload;
};

const waitForHealth = async (url, timeoutMs = 10000) => {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {}

    await delay(200);
  }

  return false;
};

const spawnDetached = async ({ args, command, env, logPath, pidPath }) => {
  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, "a");
  const child = spawn(command, args, {
    cwd: repoPath,
    detached: true,
    env: { ...process.env, ...env },
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
  await writeTextFile(pidPath, String(child.pid) + "\n");
};

const fingerprintConfig = () =>
  JSON.stringify({
    apiKey: process.env.OPENCODE_PROVIDER_API_KEY || "",
    config: decodeEnvBase64("OPENCODE_CONFIG_CONTENT_B64"),
    proxyMode: process.env.OPENCODE_PROXY_MODE || "",
    proxyScript: decodeEnvBase64("OPENCODE_CODEX_PROXY_SCRIPT_B64"),
  });

const readRuntimeState = async () => (await readJson(runtimeStatePath)) || {};

const restartRuntimeIfNeeded = async () => {
  const state = await readRuntimeState();
  const nextFingerprint = fingerprintConfig();

  if (state.configFingerprint && state.configFingerprint !== nextFingerprint) {
    await killPidFile(serverPidPath);
    await killPidFile(proxyPidPath);
    await fsp.rm(sessionPath, { force: true }).catch(() => {});
  }

  await writeJson(runtimeStatePath, {
    configFingerprint: nextFingerprint,
    updatedAt: Date.now(),
  });
};

const ensureProxy = async () => {
  if (process.env.OPENCODE_CODEX_USE_LOCAL_PROXY !== "1") {
    return;
  }

  if (await waitForHealth(proxyHealthUrl, 300)) {
    return;
  }

  await killPidFile(proxyPidPath);
  await spawnDetached({
    args: [proxyScriptPath],
    command: "node",
    env: {},
    logPath: proxyLogPath,
    pidPath: proxyPidPath,
  });

  if (!(await waitForHealth(proxyHealthUrl, 10000))) {
    throw new Error("Codex proxy failed to become healthy.");
  }
};

const ensureServer = async () => {
  await ensureRuntimeFiles();
  await restartRuntimeIfNeeded();
  await ensureProxy();

  if (await waitForHealth(serverHealthUrl, 300)) {
    return;
  }

  await killPidFile(serverPidPath);
  await spawnDetached({
    args: ["serve", "--port", String(serverPort), "--hostname", "127.0.0.1"],
    command: "opencode",
    env: {
      OPENCODE_CLIENT: "serve",
      OPENCODE_CONFIG: configPath,
    },
    logPath: serverLogPath,
    pidPath: serverPidPath,
  });

  if (!(await waitForHealth(serverHealthUrl, 10000))) {
    throw new Error("OpenCode server failed to become healthy.");
  }
};

let lastAscendingTimestamp = 0;
let lastAscendingCounter = 0;

const makeAscendingMessageId = () => {
  const now = Date.now();

  if (now === lastAscendingTimestamp) {
    lastAscendingCounter += 1;
  } else {
    lastAscendingTimestamp = now;
    lastAscendingCounter = 0;
  }

  return (
    "msg_" +
    now.toString(36) +
    "_" +
    lastAscendingCounter.toString(36).padStart(2, "0")
  );
};

const readSessionId = async () => {
  const session = await readJson(sessionPath);
  return typeof session?.id === "string" && session.id ? session.id : null;
};

const resolveExistingSessionId = async () => {
  const candidates = [
    typeof process.env.OPENCODE_SESSION_ID === "string" ? process.env.OPENCODE_SESSION_ID : "",
    (await readSessionId()) ?? "",
  ];

  for (const candidate of candidates) {
    const sessionId = candidate.trim();

    if (!sessionId) {
      continue;
    }

    const existingSession = await httpJson(serverBaseUrl + "/session/" + sessionId, {
      method: "GET",
    }).catch(() => null);

    if (existingSession) {
      return {
        payload: existingSession,
        sessionId,
      };
    }
  }

  return null;
};

const ensureSessionId = async (preferredSessionId, allowCreateIfPreferredMissing = false) => {
  const preferred =
    typeof preferredSessionId === "string" && preferredSessionId.trim()
      ? preferredSessionId.trim()
      : null;

  if (preferred) {
    const existingPreferred = await httpJson(serverBaseUrl + "/session/" + preferred, {
      method: "GET",
    }).catch(() => null);

    if (existingPreferred) {
      await writeJson(sessionPath, { createdAt: Date.now(), id: preferred });
      return preferred;
    }

    if (!allowCreateIfPreferredMissing) {
      throw new Error("Persisted OpenCode session was not found on the server.");
    }
  }

  const existing = preferred ? null : await readSessionId();
  if (existing) {
    const existingSession = await httpJson(serverBaseUrl + "/session/" + existing, {
      method: "GET",
    }).catch(() => null);

    if (existingSession) {
      return existing;
    }
  }

  const created = await httpJson(serverBaseUrl + "/session", {
    body: JSON.stringify({}),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const id = typeof created?.id === "string" && created.id ? created.id : null;

  if (!id) {
    throw new Error("Failed to create OpenCode session.");
  }

  await writeJson(sessionPath, { createdAt: Date.now(), id });
  return id;
};

const readReplayMessages = () => {
  const decoded = decodeEnvBase64("OPENCODE_SESSION_REPLAY_B64");

  if (!decoded) {
    return [];
  }

  try {
    const parsed = JSON.parse(decoded);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            typeof entry.messageId === "string" &&
            typeof entry.text === "string" &&
            entry.messageId.trim() &&
            entry.text.trim(),
        )
      : [];
  } catch {
    return [];
  }
};

const extractSessionTitle = (payload) => {
  const candidates = [
    payload?.title,
    payload?.name,
    payload?.summary,
    payload?.session?.title,
    payload?.session?.name,
    payload?.session?.summary,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
};

const DEFAULT_SESSION_TITLE_PATTERNS = [
  /^new session(?:\s*[-:]\s*[\dTZ:.\-+]+)?$/i,
  /^untitled session$/i,
];

const isDefaultSessionTitle = (value) =>
  DEFAULT_SESSION_TITLE_PATTERNS.some((pattern) => pattern.test(value.trim()));

const waitForGeneratedSessionTitle = async (sessionId) => {
  let latestTitle = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const session = await httpJson(serverBaseUrl + "/session/" + sessionId, {
      method: "GET",
    }).catch(() => null);
    const title = extractSessionTitle(session);

    if (title) {
      latestTitle = title;

      if (!isDefaultSessionTitle(title)) {
        return {
          session,
          title,
        };
      }
    }

    await delay(500);
  }

  return {
    session: latestTitle ? { title: latestTitle } : null,
    title: latestTitle && !isDefaultSessionTitle(latestTitle) ? latestTitle : null,
  };
};

const buildModelSpec = (model, reasoningEffort) => {
  const trimmed = typeof model === "string" ? model.trim() : "";
  if (!trimmed) {
    return undefined;
  }

  const slash = trimmed.indexOf("/");
  const providerID = slash === -1 ? "anthropic" : trimmed.slice(0, slash);
  const modelID = slash === -1 ? trimmed : trimmed.slice(slash + 1);
  const spec = { modelID, providerID };
  const effort = typeof reasoningEffort === "string" ? reasoningEffort.trim() : "";

  if (!effort) {
    return spec;
  }

  if (providerID === "openai") {
    spec.options = {
      reasoningEffort: effort,
      reasoningSummary: "auto",
    };
  } else if (providerID === "anthropic") {
    const adaptiveModels = new Set(["claude-opus-4-6", "claude-sonnet-4-6"]);
    if (adaptiveModels.has(modelID)) {
      spec.options = {
        outputConfig: { effort },
        thinking: { type: "adaptive" },
      };
    } else {
      const budgets = {
        high: 16000,
        max: 31999,
      };
      if (budgets[effort]) {
        spec.options = {
          thinking: { budgetTokens: budgets[effort], type: "enabled" },
        };
      }
    }
  }

  return spec;
};

const postRuntimeEvent = async (event) => {
  const endpoint = process.env.OPENCODE_RUNTIME_EVENT_ENDPOINT || "";
  const token = process.env.OPENCODE_RUNTIME_EVENT_TOKEN || "";
  const taskId = process.env.OPENCODE_RUNTIME_TASK_ID || "";

  if (!endpoint || !token || !taskId) {
    return;
  }

  await fetch(endpoint, {
    body: JSON.stringify({
      messageId: event.messageId,
      payload: event.payload,
      taskId,
      type: event.type,
    }),
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    method: "POST",
  }).catch(() => {});
};

const transformPartToEvent = (part, messageId, cumulativeText, delta) => {
  const partType = part?.type;

  if (partType === "text") {
    const text =
      (typeof delta === "string" && delta) ||
      (typeof part?.delta === "string" && part.delta) ||
      (typeof part?.text === "string" ? part.text : "");
    let next = cumulativeText;

    if (typeof part?.text === "string" && part.text) {
      next = part.text;
    } else if (text) {
      next = cumulativeText + text;
    }

    if (!next) {
      return { cumulativeText, event: null };
    }

    return {
      cumulativeText: next,
      event: {
        messageId,
        payload: {
          text: next,
          timestamp: Date.now(),
        },
        type: "token",
      },
    };
  }

  if (partType === "tool" || partType === "tool-invocation" || partType === "tool-result") {
    const state = part?.state && typeof part.state === "object" ? part.state : {};
    const completed =
      partType === "tool-result" ||
      state?.status === "completed" ||
      state?.status === "error";
    return {
      cumulativeText,
      event: {
        messageId,
        payload: {
          args: state?.input ?? {},
          callId: typeof part?.callID === "string" ? part.callID : "",
          output:
            typeof state?.output === "string" || typeof state?.output === "number"
              ? String(state.output)
              : state?.output && typeof state.output === "object"
                ? JSON.stringify(state.output)
                : "",
          status: typeof state?.status === "string" ? state.status : "",
          tool: typeof part?.tool === "string" ? part.tool : "",
        },
        type: completed ? "tool_result" : "tool_call",
      },
    };
  }

  if (partType === "step-start") {
    return {
      cumulativeText,
      event: {
        messageId,
        payload: {
          timestamp: Date.now(),
        },
        type: "step_start",
      },
    };
  }

  if (partType === "step-finish") {
    return {
      cumulativeText,
      event: {
        messageId,
        payload: {
          cost: part?.cost ?? null,
          reason: part?.reason ?? null,
          timestamp: Date.now(),
          tokens: part?.tokens ?? null,
        },
        type: "step_finish",
      },
    };
  }

  return { cumulativeText, event: null };
};

const mergeTextPart = (state, part, delta) => {
  const partId = typeof part?.id === "string" && part.id ? part.id : "";
  if (!partId) {
    return state.combinedText || "";
  }

  const nextText =
    typeof delta === "string" && delta
      ? (state.partText.get(partId) || "") + delta
      : typeof part?.text === "string"
        ? part.text
        : state.partText.get(partId) || "";

  state.partText.set(partId, nextText);
  if (!state.partOrder.includes(partId)) {
    state.partOrder.push(partId);
  }

  state.combinedText = state.partOrder.map((id) => state.partText.get(id) || "").join("").trim();
  return state.combinedText;
};

const flushPendingParts = async (messageId, pendingParts, handlePart) => {
  const pending = pendingParts.get(messageId) || [];
  pendingParts.delete(messageId);

  for (const item of pending) {
    await handlePart(item.part, item.delta);
  }
};

const getMessageCreatedAt = (info) => {
  const created = info?.time?.created;

  if (typeof created === "number" && Number.isFinite(created)) {
    return created;
  }

  if (typeof created === "string") {
    const parsed = Date.parse(created);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const getMessageText = (msg) =>
  (Array.isArray(msg?.parts) ? msg.parts : [])
    .filter((part) => part && typeof part === "object" && part.type === "text")
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

const fetchFinalMessageState = async (input) => {
  const response = await httpJson(serverBaseUrl + "/session/" + input.sessionId + "/message", {
    method: "GET",
  }).catch(() => null);

  const messages = Array.isArray(response) ? response : [];
  let finalText = input.currentText || "";
  let finalAssistantMessageId = input.assistantMessageId;
  let fallbackText = input.currentText || "";
  let fallbackAssistantMessageId = input.assistantMessageId;
  let fallbackCreatedAt = 0;

  for (const msg of messages) {
    const info = msg?.info && typeof msg.info === "object" ? msg.info : {};
    if (info?.role !== "assistant" || info?.sessionID !== input.sessionId) {
      continue;
    }

    const text = getMessageText(msg);
    const createdAt = getMessageCreatedAt(info);
    const isCurrentRunAssistant =
      (typeof info?.id === "string" && input.allowedAssistantIds.has(info.id)) ||
      info?.parentID === input.opencodeMessageId;

    if (isCurrentRunAssistant) {
      if (!finalAssistantMessageId && typeof info?.id === "string" && info.id) {
        finalAssistantMessageId = info.id;
      }

      if (text && text.length >= finalText.length) {
        finalText = text;
      }

      continue;
    }

    if (
      createdAt >= input.promptStartedAt &&
      text &&
      (!fallbackText || createdAt >= fallbackCreatedAt)
    ) {
      fallbackText = text;
      fallbackCreatedAt = createdAt;
      fallbackAssistantMessageId =
        typeof info?.id === "string" && info.id ? info.id : fallbackAssistantMessageId;
    }
  }

  return {
    assistantMessageId: finalAssistantMessageId || fallbackAssistantMessageId,
    text: finalText || fallbackText,
  };
};

const waitForFinalMessageState = async (input) => {
  let bestState = {
    assistantMessageId: input.assistantMessageId || null,
    text: input.currentText || "",
  };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const nextState = await fetchFinalMessageState(input);

    if ((nextState.text || "").length >= (bestState.text || "").length) {
      bestState = nextState;
    }

    if (bestState.text.trim()) {
      return bestState;
    }

    await delay(500);
  }

  return bestState;
};

const summarizeMessageParts = (parts) =>
  (Array.isArray(parts) ? parts : []).map((part) => {
    if (!part || typeof part !== "object") {
      return { type: "unknown" };
    }

    const summary = {
      id: typeof part.id === "string" ? part.id : undefined,
      text:
        typeof part.text === "string"
          ? part.text.slice(0, 200)
          : typeof part.delta === "string"
            ? part.delta.slice(0, 200)
            : undefined,
      tool: typeof part.tool === "string" ? part.tool : undefined,
      type: typeof part.type === "string" ? part.type : "unknown",
    };

    return summary;
  });

const prompt = async () => {
  await ensureServer();
  await fsp.rm(usageLogPath, { force: true }).catch(() => {});
  const replayMessages = readReplayMessages();
  const sessionId = await ensureSessionId(
    process.env.OPENCODE_SESSION_ID || "",
    replayMessages.length > 0,
  );
  const promptMessageId = process.env.OPENCODE_PROMPT_MESSAGE_ID || "unknown";
  const opencodeMessageId = makeAscendingMessageId();
  const replayFallbackText = replayMessages
    .map((replayMessage) => "Recovered prior conversation context:\n" + replayMessage.text)
    .join("\n\n");

  const requestBody = {
    messageID: opencodeMessageId,
    model: buildModelSpec(process.env.OPENCODE_PROMPT_MODEL || "", process.env.OPENCODE_PROMPT_REASONING_EFFORT || ""),
    parts: [
      {
        text:
          replayFallbackText
            ? replayFallbackText + "\n\n" + decodeEnvBase64("OPENCODE_PROMPT_USER_B64")
            : decodeEnvBase64("OPENCODE_PROMPT_USER_B64"),
        type: "text",
      },
    ],
    system: decodeEnvBase64("OPENCODE_PROMPT_SYSTEM_B64") || undefined,
  };
  const promptStartedAt = Date.now();
  const response = await fetch(serverBaseUrl + "/event");
  if (!response.ok || !response.body) {
    throw new Error("Failed to connect to OpenCode event stream.");
  }

  await httpJson(serverBaseUrl + "/session/" + sessionId + "/prompt_async", {
    body: JSON.stringify(requestBody),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  const textState = {
    combinedText: "",
    partOrder: [],
    partText: new Map(),
  };
  const allowedAssistantIds = new Set();
  const pendingParts = new Map();
  let assistantMessageId = null;
  let sawRunActivity = false;
  let runtimeError = null;
  let completionDeadlineAt = 0;

  const extendCompletionDeadline = () => {
    completionDeadlineAt = Date.now() + 1500;
  };

  const handleAuthorizedPart = async (part, delta) => {
    if (completionDeadlineAt) {
      extendCompletionDeadline();
    }

    if (part?.type === "text") {
      const nextText = mergeTextPart(textState, part, delta);
      if (nextText) {
        await postRuntimeEvent({
          messageId: promptMessageId,
          payload: {
            text: nextText,
            timestamp: Date.now(),
          },
          type: "token",
        });
      }
      return;
    }

    const transformed = transformPartToEvent(
      part,
      promptMessageId,
      textState.combinedText,
      typeof delta === "string" ? delta : "",
    );
    if (transformed.event) {
      await postRuntimeEvent(transformed.event);
    }
  };

  const flushEvent = async (raw) => {
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const type = typeof parsed?.type === "string" ? parsed.type : "";
    const props = parsed?.properties && typeof parsed.properties === "object" ? parsed.properties : {};

    if (type === "session.idle") {
      if (props?.sessionID === sessionId && sawRunActivity) {
        extendCompletionDeadline();
      }
      return;
    }

    if (type === "message.updated") {
      const info = props?.info && typeof props.info === "object" ? props.info : {};
      const createdAt = getMessageCreatedAt(info);
      const messageId = typeof info?.id === "string" ? info.id : "";
      const isCurrentRunAssistant =
        info?.sessionID === sessionId &&
        info?.role === "assistant" &&
        !!messageId &&
        (info?.parentID === opencodeMessageId || createdAt >= promptStartedAt);

      if (isCurrentRunAssistant) {
        sawRunActivity = true;
        allowedAssistantIds.add(messageId);
        assistantMessageId = messageId;
        await flushPendingParts(messageId, pendingParts, handleAuthorizedPart);

        if (completionDeadlineAt) {
          extendCompletionDeadline();
        }
      }

      if (
        isCurrentRunAssistant &&
        typeof info?.finish === "string" &&
        info.finish &&
        info.finish !== "tool-calls"
      ) {
        extendCompletionDeadline();
      }

      return;
    }

    if (type === "message.part.updated") {
      const part = props?.part && typeof props.part === "object" ? props.part : {};
      if (part?.sessionID !== sessionId) {
        return;
      }

      if (!allowedAssistantIds.has(part?.messageID)) {
        const pending = pendingParts.get(part.messageID) || [];
        pending.push({
          delta: props?.delta,
          part,
        });
        pendingParts.set(part.messageID, pending);
        return;
      }
      sawRunActivity = true;
      await handleAuthorizedPart(part, props?.delta);
      return;
    }

    if (type === "message.part.added") {
      const part = props?.part && typeof props.part === "object" ? props.part : {};
      if (part?.sessionID !== sessionId) {
        return;
      }

      if (!allowedAssistantIds.has(part?.messageID)) {
        const pending = pendingParts.get(part.messageID) || [];
        pending.push({
          delta: props?.delta,
          part,
        });
        pendingParts.set(part.messageID, pending);
        return;
      }
      sawRunActivity = true;
      await handleAuthorizedPart(part, props?.delta);
      return;
    }

    if (type === "message.error") {
      const errorMessage =
        (props?.error && typeof props.error === "object" && props.error && typeof props.error.message === "string"
          ? props.error.message
          : null) ||
        (typeof props?.message === "string" ? props.message : null) ||
        "OpenCode prompt failed.";
      runtimeError = errorMessage;
      await postRuntimeEvent({
        messageId: promptMessageId,
        payload: {
          error: errorMessage,
          timestamp: Date.now(),
        },
        type: "error",
      });
    }
  };

  try {
    while (true) {
      const nextChunk = completionDeadlineAt
        ? await Promise.race([
            reader.read().then((result) => ({ ...result, timeout: false })),
            delay(Math.max(0, completionDeadlineAt - Date.now())).then(() => ({
              done: false,
              timeout: true,
              value: undefined,
            })),
          ])
        : { ...(await reader.read()), timeout: false };

      if (nextChunk.timeout) {
        break;
      }

      const { done, value } = nextChunk;
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes("\n\n")) {
        const index = buffer.indexOf("\n\n");
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const raw = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .filter(Boolean)
          .join("\n");

        if (!raw || raw === "[DONE]") {
          continue;
        }

        await flushEvent(raw);

        if (runtimeError) {
          break;
        }
      }

      if (runtimeError) {
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  if (runtimeError) {
    throw new Error(runtimeError);
  }

  const finalState = await waitForFinalMessageState({
    allowedAssistantIds,
    assistantMessageId,
    currentText: textState.combinedText,
    opencodeMessageId,
    promptStartedAt,
    sessionId,
  });
  let finalText = finalState.text || textState.combinedText;

  if (!finalText && (process.env.OPENCODE_PROXY_MODE || "").trim() === "codex") {
    const sessionMessages = await httpJson(serverBaseUrl + "/session/" + sessionId + "/message", {
      method: "GET",
    }).catch(() => null);

    process.stdout.write(
      JSON.stringify({
        debug: {
          finalState,
          promptMessageId,
          requestMessageId: opencodeMessageId,
          sessionMessages: (Array.isArray(sessionMessages) ? sessionMessages : []).slice(-6).map((msg) => ({
            info:
              msg?.info && typeof msg.info === "object"
                ? {
                    finish: typeof msg.info.finish === "string" ? msg.info.finish : undefined,
                    id: typeof msg.info.id === "string" ? msg.info.id : undefined,
                    parentID:
                      typeof msg.info.parentID === "string" ? msg.info.parentID : undefined,
                    role: typeof msg.info.role === "string" ? msg.info.role : undefined,
                    sessionID:
                      typeof msg.info.sessionID === "string" ? msg.info.sessionID : undefined,
                  }
                : {},
            parts: summarizeMessageParts(msg?.parts),
          })),
        },
        messageId: promptMessageId,
        type: "codex_empty_text_debug",
      }) + "\n",
    );
  }

  if (finalText) {
    await postRuntimeEvent({
      messageId: promptMessageId,
      payload: {
        text: finalText,
        timestamp: Date.now(),
      },
      type: "token",
    });
  }

  process.stdout.write(
    JSON.stringify({
      assistantMessageId: finalState.assistantMessageId || null,
      messageId: promptMessageId,
      sessionId,
      success: true,
      text: finalText,
      userMessageId: opencodeMessageId,
      usageLogPath,
    }) + "\n",
  );
};

const abortPrompt = async () => {
  await ensureServer();
  const sessionId = await readSessionId();

  if (!sessionId) {
    return;
  }

  await httpJson(serverBaseUrl + "/session/" + sessionId + "/abort", {
    method: "POST",
  }).catch(() => {});
};

const sessionMetadata = async () => {
  await ensureServer();
  const session = await resolveExistingSessionId();
  const generated = session?.sessionId
    ? await waitForGeneratedSessionTitle(session.sessionId)
    : { session: null, title: null };

  process.stdout.write(
    JSON.stringify({
      sessionId: session?.sessionId ?? null,
      success: true,
      title: generated.title,
    }) + "\n",
  );
};

const command = process.argv[2];
const serializeErrorMessage = (error) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error || "OpenCode runtime failed.");
};

try {
  if (command === "ensure-server") {
    await ensureServer();
  } else if (command === "prompt") {
    await prompt();
  } else if (command === "abort") {
    await abortPrompt();
  } else if (command === "session-metadata") {
    await sessionMetadata();
  } else {
    throw new Error("Unknown opencode runtime command: " + command);
  }
} catch (error) {
  const message = serializeErrorMessage(error);

  process.stdout.write(
    JSON.stringify({
      command,
      error: message,
      success: false,
    }) + "\n",
  );
  process.exit(1);
}
`;

const writeRuntimeFilesCommand = [
  "python3 - <<'PY'",
  "import base64",
  "import os",
  "import pathlib",
  "",
  "def decode(name):",
  "    raw = os.environ.get(name, '')",
  "    normalized = ''.join(raw.split()).replace('-', '+').replace('_', '/')",
  "    if normalized:",
  "        normalized += '=' * (-len(normalized) % 4)",
  "    return base64.b64decode(normalized).decode('utf-8') if normalized else ''",
  "",
  "runtime_dir = pathlib.Path(os.getcwd()) / '.diabolo' / 'opencode'",
  "runtime_dir.mkdir(parents=True, exist_ok=True)",
  "(runtime_dir / 'opencode-runtime.mjs').write_text(decode('OPENCODE_RUNTIME_SCRIPT_B64'))",
  "PY",
].join("\n");

export const buildEnsurePersistentOpenCodeServerCommand = () =>
  [writeRuntimeFilesCommand, "node .diabolo/opencode/opencode-runtime.mjs ensure-server"].join(
    "\n",
  );

export const buildRunPersistentOpenCodePromptCommand = () =>
  "node .diabolo/opencode/opencode-runtime.mjs prompt";

export const buildAbortPersistentOpenCodePromptCommand = () =>
  "node .diabolo/opencode/opencode-runtime.mjs abort";

export const buildReadPersistentOpenCodeSessionMetadataCommand = () =>
  "node .diabolo/opencode/opencode-runtime.mjs session-metadata";

export const buildPersistentOpenCodeRuntimeEnvironment = () => ({
  OPENCODE_RUNTIME_SCRIPT_B64: Buffer.from(OPENCODE_RUNTIME_SCRIPT, "utf8").toString("base64"),
});
