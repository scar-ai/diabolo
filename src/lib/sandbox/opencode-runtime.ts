import { Buffer } from "node:buffer";

import { RUNTIME_EVENT_PREFIX, RUNTIME_PROTOCOL_VERSION } from "@/lib/opencode/protocol";

export const OPENCODE_SERVER_PORT = 4096;
export const OPENCODE_AUTH_FILE_PATH = ".diabolo/opencode/data/opencode/auth.json";
export const OPENCODE_USAGE_LOG_PATH = ".opencode/artifacts/opencode-usage.jsonl";

/**
 * The agent runtime that runs inside the sandbox.
 *
 * Completion is driven by a single authoritative signal: `POST /session/:id/message`
 * blocks until the whole prompt is done and returns the finished assistant
 * message. The `/event` stream is used only to mirror progress to the user while
 * that call is in flight, so losing it degrades liveness and nothing else.
 */
export const OPENCODE_RUNTIME_SCRIPT = String.raw`import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

const EVENT_PREFIX = ${JSON.stringify(RUNTIME_EVENT_PREFIX)};
const PROTOCOL_VERSION = ${RUNTIME_PROTOCOL_VERSION};

const repoPath = process.cwd();
const stateDir = path.join(repoPath, ".diabolo", "opencode");
const dataDir = path.join(stateDir, "data");
const artifactsDir = path.join(repoPath, ".opencode", "artifacts");
const authPath = path.join(dataDir, "opencode", "auth.json");
const configPath = path.join(repoPath, ".opencode.generated.json");
const sessionPath = path.join(stateDir, "session.json");
const runtimeStatePath = path.join(stateDir, "runtime-state.json");
const serverPidPath = path.join(stateDir, "server.pid");
const serverLogPath = path.join(artifactsDir, "opencode-serve.log");
const usageLogPath = path.join(artifactsDir, "opencode-usage.jsonl");
const serverPort = Number(process.env.OPENCODE_SERVER_PORT || "4096");
const serverBaseUrl = "http://127.0.0.1:" + serverPort;

// How long the recovery path keeps waiting for a run whose blocking request
// lost its socket, before giving up and reporting failure.
const RECOVERY_TIMEOUT_MS = 3600000;
const RECOVERY_POLL_MS = 5000;

// Recovery assumes the run is still executing on a live server. If the server
// itself is gone, waiting out the full timeout only delays a failure that has
// already happened, so give up after this many consecutive unreachable polls.
const RECOVERY_UNHEALTHY_POLL_LIMIT = 6;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeEnvBase64 = (name) => {
  const raw = process.env[name] || "";
  const normalized = raw.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");

  if (!normalized) {
    return "";
  }

  return Buffer.from(
    normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4),
    "base64",
  ).toString("utf8");
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

const writeTextFile = async (targetPath, content) => {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.writeFile(targetPath, content, "utf8");
};

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

const taskId = process.env.OPENCODE_RUNTIME_TASK_ID || "";
const promptMessageId = process.env.OPENCODE_PROMPT_MESSAGE_ID || "";
const eventEndpoint = process.env.OPENCODE_RUNTIME_EVENT_ENDPOINT || "";
const eventToken = process.env.OPENCODE_RUNTIME_EVENT_TOKEN || "";
const runId = randomUUID();

let eventSeq = 0;
// The HTTP fast path is best-effort, but it is chained so events cannot arrive
// out of order relative to each other.
let postChain = Promise.resolve();

// Every event goes to stdout, which is ordered, durable and always readable by
// the host. The HTTP POST is an optional latency shortcut for deployments where
// the sandbox can reach the app; the host dedupes on (runId, seq), so an event
// arriving twice is a no-op.
const emit = (type, payload) => {
  const envelope = {
    messageId: promptMessageId,
    payload: payload || {},
    runId,
    seq: eventSeq++,
    taskId,
    type,
    v: PROTOCOL_VERSION,
  };

  process.stdout.write(EVENT_PREFIX + JSON.stringify(envelope) + "\n");

  if (!eventEndpoint || !eventToken || !taskId) {
    return;
  }

  postChain = postChain.then(() =>
    fetch(eventEndpoint, {
      body: JSON.stringify(envelope),
      headers: {
        authorization: "Bearer " + eventToken,
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(10000),
    }).catch(() => {}),
  );
};

const flushEvents = () => postChain;

// ---------------------------------------------------------------------------
// HTTP to the local OpenCode server
// ---------------------------------------------------------------------------

// node's fetch aborts a request whose headers take longer than five minutes, so
// the blocking prompt call has to go through a raw request with timeouts off.
const request = ({ body, method, path: requestPath, timeoutMs = 0 }) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(
      {
        headers: {
          accept: "application/json",
          ...(payload
            ? { "content-length": String(payload.length), "content-type": "application/json" }
            : {}),
        },
        host: "127.0.0.1",
        method,
        path: requestPath,
        port: serverPort,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode || 0, text }));
        response.on("error", reject);
      },
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs);

    if (timeoutMs > 0) {
      req.on("timeout", () => {
        req.destroy(new Error("OpenCode request timed out after " + timeoutMs + "ms."));
      });
    }

    if (payload) {
      req.write(payload);
    }

    req.end();
  });

const httpJson = async (options) => {
  const response = await request(options);
  let payload = null;

  try {
    payload = response.text ? JSON.parse(response.text) : null;
  } catch {}

  if (response.status < 200 || response.status >= 300) {
    const message =
      (isRecord(payload) && typeof payload.error === "string" && payload.error) ||
      (isRecord(payload) && typeof payload.message === "string" && payload.message) ||
      response.text ||
      "HTTP " + response.status;
    throw new Error(message);
  }

  return payload;
};

const getJson = (requestPath, timeoutMs = 30000) =>
  httpJson({ method: "GET", path: requestPath, timeoutMs });

const tryGetJson = (requestPath, timeoutMs = 30000) =>
  getJson(requestPath, timeoutMs).catch(() => null);

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

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

    for (let i = 0; i < 25 && pidIsRunning(pid); i += 1) {
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

const ensureRuntimeFiles = async () => {
  await fsp.mkdir(stateDir, { recursive: true });
  await fsp.mkdir(artifactsDir, { recursive: true });
  await writeTextFile(configPath, decodeEnvBase64("OPENCODE_CONFIG_CONTENT_B64"));

  const authJson = decodeEnvBase64("OPENCODE_AUTH_JSON_B64");

  if (authJson) {
    await writeTextFile(authPath, authJson);
  }
};

const waitForHealth = async (timeoutMs) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const healthy = await request({ method: "GET", path: "/global/health", timeoutMs: 1000 })
      .then((response) => response.status >= 200 && response.status < 300)
      .catch(() => false);

    if (healthy) {
      return true;
    }

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
  createHash("sha256")
    .update(
      JSON.stringify({
        apiKey: process.env.OPENCODE_PROVIDER_API_KEY || "",
        config: decodeEnvBase64("OPENCODE_CONFIG_CONTENT_B64"),
        providerKind: process.env.OPENCODE_PROVIDER_KIND || "",
      }),
    )
    .digest("hex");

// A changed provider or config cannot be picked up by a server that is already
// running, so retire it (and the session bound to it) before reusing the port.
const retireStaleServer = async () => {
  const state = (await readJson(runtimeStatePath)) || {};
  const nextFingerprint = fingerprintConfig();

  if (state.configFingerprint && state.configFingerprint !== nextFingerprint) {
    await killPidFile(serverPidPath);
    await fsp.rm(sessionPath, { force: true }).catch(() => {});
  }

  await writeJson(runtimeStatePath, {
    configFingerprint: nextFingerprint,
    updatedAt: Date.now(),
  });
};

const ensureServer = async () => {
  await ensureRuntimeFiles();
  await retireStaleServer();

  if (await waitForHealth(300)) {
    return;
  }

  await killPidFile(serverPidPath);
  await spawnDetached({
    args: ["serve", "--port", String(serverPort), "--hostname", "127.0.0.1"],
    command: "opencode",
    env: {
      OPENCODE_CLIENT: "serve",
      OPENCODE_CONFIG: configPath,
      XDG_DATA_HOME: dataDir,
    },
    logPath: serverLogPath,
    pidPath: serverPidPath,
  });

  if (!(await waitForHealth(30000))) {
    throw new Error(
      "OpenCode server failed to become healthy. See .opencode/artifacts/opencode-serve.log.",
    );
  }
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const readStoredSessionId = async () => {
  const session = await readJson(sessionPath);
  return typeof session?.id === "string" && session.id ? session.id : null;
};

const sessionExists = async (sessionId) =>
  Boolean(sessionId) && Boolean(await tryGetJson("/session/" + sessionId));

const createSession = async () => {
  const created = await httpJson({ body: {}, method: "POST", path: "/session", timeoutMs: 30000 });
  const id = typeof created?.id === "string" && created.id ? created.id : null;

  if (!id) {
    throw new Error("Failed to create an OpenCode session.");
  }

  await writeJson(sessionPath, { createdAt: Date.now(), id });
  return id;
};

/**
 * Resolves the session this run should use. The caller decides whether an
 * unreachable preferred session is fatal (a resumed session that must exist) or
 * simply means "start fresh" (a run that carries replayed history instead).
 */
const resolveSessionId = async ({ allowCreateWhenMissing, forceCreate, preferredSessionId }) => {
  if (forceCreate) {
    return createSession();
  }

  const preferred = (preferredSessionId || "").trim();

  if (preferred) {
    if (await sessionExists(preferred)) {
      await writeJson(sessionPath, { createdAt: Date.now(), id: preferred });
      return preferred;
    }

    if (!allowCreateWhenMissing) {
      throw new Error("The persisted OpenCode session no longer exists on the server.");
    }

    return createSession();
  }

  const stored = await readStoredSessionId();

  if (stored && (await sessionExists(stored))) {
    return stored;
  }

  return createSession();
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
            isRecord(entry) && typeof entry.text === "string" && entry.text.trim().length > 0,
        )
      : [];
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const getTextBlocks = (parts) =>
  (Array.isArray(parts) ? parts : [])
    .filter((part) => isRecord(part) && part.type === "text")
    .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
    .filter(Boolean);

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

const extractErrorMessage = (error) => {
  if (!isRecord(error)) {
    return "";
  }

  const name = typeof error.name === "string" ? error.name : "";
  const data = isRecord(error.data) ? error.data : {};
  const message = (typeof data.message === "string" ? data.message : "") ||
    (typeof error.message === "string" ? error.message : "");
  const cleaned = message
    .split("\n")
    .filter((line) => !/^\s+at\s/.test(line))
    .join("\n")
    .trim()
    .slice(0, 1000);

  if (!cleaned) {
    return name || "The agent run failed.";
  }

  return name && !cleaned.startsWith(name) ? name + ": " + cleaned : cleaned;
};

const buildModelSpec = (model) => {
  const trimmed = (model || "").trim();

  if (!trimmed) {
    return undefined;
  }

  const slash = trimmed.indexOf("/");

  return slash === -1
    ? { modelID: trimmed, providerID: "anthropic" }
    : { modelID: trimmed.slice(slash + 1), providerID: trimmed.slice(0, slash) };
};

// OpenCode selects reasoning effort through the model's named variant
// ("low" / "medium" / "high"), not through per-request model options: the
// request body accepts only { providerID, modelID } for "model" and silently
// drops anything else, so effort passed there never reaches the model.
const buildModelVariant = (reasoningEffort) => (reasoningEffort || "").trim().toLowerCase() || undefined;

const appendUsageRecord = (part) => {
  if (part?.type !== "step-finish") {
    return;
  }

  const tokens = isRecord(part.tokens) ? part.tokens : {};
  const cache = isRecord(tokens.cache) ? tokens.cache : {};
  const asCount = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const record = {
    cacheCreationTokens: asCount(cache.write),
    cacheReadTokens: asCount(cache.read),
    inputTokens: asCount(tokens.input),
    outputTokens: asCount(tokens.output),
    reasoningTokens: asCount(tokens.reasoning),
    timestamp: Date.now(),
    type: "usage",
  };
  record.totalTokens =
    record.inputTokens +
    record.outputTokens +
    record.reasoningTokens +
    record.cacheCreationTokens +
    record.cacheReadTokens;

  if (record.totalTokens <= 0) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(usageLogPath), { recursive: true });
    fs.appendFileSync(usageLogPath, JSON.stringify(record) + "\n", "utf8");
  } catch {}
};

// ---------------------------------------------------------------------------
// Progress stream
// ---------------------------------------------------------------------------

/**
 * Mirrors the server's event bus to the host while the prompt runs. This is
 * advisory only: the run's outcome comes from the blocking prompt request, so a
 * stream that drops or never reconnects costs liveness and nothing more.
 */
const startProgressStream = (sessionId, promptStartedAt) => {
  let stopped = false;
  let activeRequest = null;

  // Assistant messages from earlier runs share this session, so parts are only
  // forwarded once their message is confirmed to belong to this run. Parts that
  // arrive first are held until that confirmation lands.
  const runMessageIds = new Set();
  const bufferedParts = new Map();
  const textBlocks = new Map();
  const blockOrder = [];
  const reasoningBlocks = new Map();
  const reasoningOrder = [];
  const toolStatuses = new Map();
  // Latest known token counts per step. A step-finish part is revised in place
  // as it settles, so totals are recomputed from this rather than accumulated —
  // adding each part as it arrives would count revisions twice.
  const usageSteps = new Map();

  // Text and reasoning stream identically — full current text of a block, keyed
  // by its position — so they share one emitter and differ only in event type.
  const emitBlockPart = (eventType, blocks, order, part, delta) => {
    const blockId = typeof part.id === "string" ? part.id : "";

    if (!blockId) {
      return;
    }

    let block = blocks.get(blockId);

    if (!block) {
      block = { index: order.length, text: "" };
      blocks.set(blockId, block);
      order.push(blockId);
    }

    const next =
      typeof part.text === "string" && part.text
        ? part.text
        : typeof delta === "string" && delta
          ? block.text + delta
          : block.text;

    if (next === block.text) {
      return;
    }

    block.text = next;
    emit(eventType, { blockId, index: block.index, text: next });
  };

  const emitUsagePart = (part) => {
    const tokens = isRecord(part.tokens) ? part.tokens : {};
    const cache = isRecord(tokens.cache) ? tokens.cache : {};
    const asCount = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
    const stepId = typeof part.id === "string" ? part.id : "";
    const step = {
      cacheReadTokens: asCount(cache.read),
      cacheWriteTokens: asCount(cache.write),
      inputTokens: asCount(tokens.input),
      outputTokens: asCount(tokens.output),
      reasoningTokens: asCount(tokens.reasoning),
    };
    const stepTotal =
      step.inputTokens +
      step.outputTokens +
      step.reasoningTokens +
      step.cacheReadTokens +
      step.cacheWriteTokens;

    if (!stepId || stepTotal <= 0) {
      return;
    }

    const previous = usageSteps.get(stepId);

    if (previous && previous.totalTokens === stepTotal) {
      return;
    }

    step.totalTokens = stepTotal;
    usageSteps.set(stepId, step);

    const totals = {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      steps: usageSteps.size,
      totalTokens: 0,
    };

    for (const counted of usageSteps.values()) {
      for (const key of Object.keys(totals)) {
        if (key !== "steps") {
          totals[key] += counted[key];
        }
      }
    }

    emit("token_usage", totals);
  };

  const emitToolPart = (part) => {
    const state = isRecord(part.state) ? part.state : {};
    const callId =
      (typeof part.callID === "string" && part.callID) || (typeof part.id === "string" && part.id);

    if (!callId) {
      return;
    }

    const status =
      state.status === "error" ? "error" : state.status === "completed" ? "completed" : "running";

    if (toolStatuses.get(callId) === status) {
      return;
    }

    toolStatuses.set(callId, status);

    const output = state.output;
    emit(status === "running" ? "tool_start" : "tool_end", {
      args: isRecord(state.input) ? state.input : {},
      callId,
      output:
        typeof output === "string"
          ? output
          : output === undefined || output === null
            ? ""
            : JSON.stringify(output),
      status,
      title: typeof state.title === "string" ? state.title : "",
      tool: typeof part.tool === "string" ? part.tool : "",
    });
  };

  const handlePart = (part, delta) => {
    if (part.type === "text") {
      emitBlockPart("text", textBlocks, blockOrder, part, delta);
      return;
    }

    if (part.type === "reasoning") {
      emitBlockPart("reasoning", reasoningBlocks, reasoningOrder, part, delta);
      return;
    }

    if (part.type === "tool" || part.type === "tool-invocation" || part.type === "tool-result") {
      emitToolPart(part);
      return;
    }

    // Usage is only broadcast from here, never written to the usage log: the
    // same step-finish parts come back on the finished message, and recording
    // both would double every run's billed usage.
    if (part.type === "step-finish") {
      emitUsagePart(part);
    }
  };

  const acceptPart = (part, delta) => {
    if (!isRecord(part) || part.sessionID !== sessionId) {
      return;
    }

    const messageId = typeof part.messageID === "string" ? part.messageID : "";

    if (!runMessageIds.has(messageId)) {
      const buffered = bufferedParts.get(messageId) || [];
      buffered.push({ delta, part });
      bufferedParts.set(messageId, buffered);
      return;
    }

    handlePart(part, delta);
  };

  const handleFrame = (raw) => {
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const type = typeof parsed?.type === "string" ? parsed.type : "";
    const props = isRecord(parsed?.properties) ? parsed.properties : {};

    if (type === "message.updated") {
      const info = isRecord(props.info) ? props.info : {};
      const messageId = typeof info.id === "string" ? info.id : "";
      const belongsToRun =
        info.sessionID === sessionId &&
        info.role === "assistant" &&
        Boolean(messageId) &&
        getMessageCreatedAt(info) >= promptStartedAt - 1000;

      if (!belongsToRun || runMessageIds.has(messageId)) {
        return;
      }

      runMessageIds.add(messageId);

      for (const buffered of bufferedParts.get(messageId) || []) {
        handlePart(buffered.part, buffered.delta);
      }

      bufferedParts.delete(messageId);
      return;
    }

    if (type === "message.part.updated" || type === "message.part.added") {
      acceptPart(props.part, props.delta);
    }
  };

  const consume = (response) =>
    new Promise((resolve) => {
      let buffer = "";
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        buffer += chunk;

        for (let index = buffer.indexOf("\n\n"); index !== -1; index = buffer.indexOf("\n\n")) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .filter(Boolean)
            .join("\n");

          if (data && data !== "[DONE]") {
            handleFrame(data);
          }
        }
      });
      response.on("end", finish);
      response.on("close", finish);
      response.on("error", finish);
    });

  const connect = () =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          headers: { accept: "text/event-stream" },
          host: "127.0.0.1",
          method: "GET",
          path: "/event",
          port: serverPort,
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error("Event stream returned HTTP " + response.statusCode));
            return;
          }

          resolve({ req, response });
        },
      );

      req.on("error", reject);
      req.setTimeout(0);
      req.end();
    });

  const pump = async () => {
    let backoffMs = 250;

    while (!stopped) {
      let stream = null;

      try {
        stream = await connect();
        backoffMs = 250;
      } catch {
        await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 5000);
        continue;
      }

      if (stopped) {
        stream.req.destroy();
        return;
      }

      activeRequest = stream.req;
      await consume(stream.response);
      activeRequest = null;
    }
  };

  void pump();

  return () => {
    stopped = true;
    activeRequest?.destroy();
    activeRequest = null;
  };
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const isTransportError = (error) => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "");

  return (
    message.includes("socket hang up") ||
    message.includes("econnreset") ||
    message.includes("epipe") ||
    message.includes("terminated") ||
    message.includes("timed out")
  );
};

/**
 * Recovers a run whose blocking request lost its connection. The prompt itself
 * keeps executing server-side, so wait for the session to go idle and then read
 * the assistant message it produced.
 */
const recoverRunResult = async (sessionId, promptStartedAt) => {
  const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
  let unhealthyPolls = 0;

  while (Date.now() < deadline) {
    await delay(RECOVERY_POLL_MS);

    // Every read below swallows its errors, so without an explicit health check
    // a dead server is indistinguishable from an idle one that has produced no
    // message yet — and the loop would run to its full timeout.
    if (!(await waitForHealth(1000))) {
      unhealthyPolls += 1;

      if (unhealthyPolls >= RECOVERY_UNHEALTHY_POLL_LIMIT) {
        throw new Error(
          "The OpenCode server stopped responding mid-run. It was most likely killed for exceeding the sandbox memory limit; see .opencode/artifacts/opencode-serve.log.",
        );
      }

      continue;
    }

    unhealthyPolls = 0;

    const statuses = await tryGetJson("/session/status");
    const status = isRecord(statuses) && isRecord(statuses[sessionId]) ? statuses[sessionId].type : "idle";

    if (status === "busy" || status === "retry") {
      continue;
    }

    const messages = await tryGetJson("/session/" + sessionId + "/message");
    const candidates = (Array.isArray(messages) ? messages : []).filter((message) => {
      const info = isRecord(message?.info) ? message.info : {};
      return (
        info.sessionID === sessionId &&
        info.role === "assistant" &&
        getMessageCreatedAt(info) >= promptStartedAt - 1000
      );
    });
    const latest = candidates.at(-1);

    if (latest) {
      return { info: latest.info, parts: latest.parts };
    }
  }

  throw new Error("The agent run lost its connection and did not finish within the time limit.");
};

const prompt = async () => {
  if (!promptMessageId) {
    throw new Error("OPENCODE_PROMPT_MESSAGE_ID is required to run a prompt.");
  }

  await ensureServer();
  await fsp.rm(usageLogPath, { force: true }).catch(() => {});

  const replayMessages = readReplayMessages();
  const sessionId = await resolveSessionId({
    allowCreateWhenMissing: replayMessages.length > 0,
    forceCreate: process.env.OPENCODE_FORCE_NEW_SESSION === "1",
    preferredSessionId: process.env.OPENCODE_SESSION_ID || "",
  });

  const userPrompt = decodeEnvBase64("OPENCODE_PROMPT_USER_B64");
  const replayPreamble = replayMessages
    .map((message) => "Recovered prior conversation context:\n" + message.text)
    .join("\n\n");
  const body = {
    model: buildModelSpec(process.env.OPENCODE_PROMPT_MODEL || ""),
    parts: [{ text: replayPreamble ? replayPreamble + "\n\n" + userPrompt : userPrompt, type: "text" }],
    system: decodeEnvBase64("OPENCODE_PROMPT_SYSTEM_B64") || undefined,
    variant: buildModelVariant(process.env.OPENCODE_PROMPT_REASONING_EFFORT || ""),
  };

  const promptStartedAt = Date.now();
  const stopProgressStream = startProgressStream(sessionId, promptStartedAt);
  emit("run_started", { sessionId, timestamp: promptStartedAt });

  let result;

  try {
    // Blocks for the entire run. This returning is the single authoritative
    // signal that the agent is done, and its payload is the final message.
    result = await httpJson({
      body,
      method: "POST",
      path: "/session/" + sessionId + "/message",
      timeoutMs: 0,
    });
  } catch (error) {
    if (!isTransportError(error)) {
      throw error;
    }

    result = await recoverRunResult(sessionId, promptStartedAt);
  } finally {
    stopProgressStream();
  }

  const info = isRecord(result?.info) ? result.info : {};

  if (isRecord(info.error) && info.error.name !== "MessageAbortedError") {
    throw new Error(extractErrorMessage(info.error));
  }

  const blocks = getTextBlocks(result?.parts);

  for (const part of Array.isArray(result?.parts) ? result.parts : []) {
    appendUsageRecord(part);
  }

  emit("run_completed", {
    assistantMessageId: typeof info.id === "string" ? info.id : null,
    blocks,
    sessionId,
    timestamp: Date.now(),
    userMessageId: typeof info.parentID === "string" ? info.parentID : "",
  });

  await flushEvents();
};

const abortPrompt = async () => {
  await ensureServer();
  const sessionId = await readStoredSessionId();

  if (!sessionId) {
    return;
  }

  await httpJson({ method: "POST", path: "/session/" + sessionId + "/abort", timeoutMs: 30000 }).catch(
    () => {},
  );
};

const DEFAULT_TITLE_PATTERNS = [/^new session(?:\s*[-:]\s*[\dTZ:.\-+]+)?$/i, /^untitled session$/i];

const extractSessionTitle = (payload) => {
  const candidates = [payload?.title, payload?.name, payload?.summary];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
};

// The server generates a session title asynchronously after the first exchange,
// so poll briefly rather than accepting the placeholder it starts with.
const sessionMetadata = async () => {
  await ensureServer();
  const sessionId = (process.env.OPENCODE_SESSION_ID || "").trim() || (await readStoredSessionId());
  let title = null;

  for (let attempt = 0; sessionId && attempt < 30; attempt += 1) {
    const candidate = extractSessionTitle(await tryGetJson("/session/" + sessionId));

    if (candidate) {
      title = candidate;

      if (!DEFAULT_TITLE_PATTERNS.some((pattern) => pattern.test(candidate))) {
        break;
      }
    }

    await delay(500);
  }

  const isPlaceholder = title !== null && DEFAULT_TITLE_PATTERNS.some((pattern) => pattern.test(title));

  process.stdout.write(
    JSON.stringify({
      sessionId: sessionId || null,
      success: true,
      title: isPlaceholder ? null : title,
    }) + "\n",
  );
};

const command = process.argv[2];

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
  const message =
    error instanceof Error && error.message.trim() ? error.message : String(error || "Runtime failed.");

  if (command === "prompt") {
    emit("run_failed", { message, timestamp: Date.now() });
    await flushEvents();
  }

  process.stdout.write(JSON.stringify({ command, error: message, success: false }) + "\n");
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
