import { buildAgentBrowserOpenCodeSetupCommand } from "@/lib/opencode/agent-browser";
import { buildGitToolsOpenCodeSetupCommand } from "@/lib/opencode/git-tools";
import { buildSpawnTaskOpenCodeSetupCommand } from "@/lib/opencode/spawn-task";

const SANDBOX_TOOL_PATH_EXPORT =
  'export PATH="$HOME/.local/bin:$HOME/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:$(npm config get prefix)/bin:$PATH"';

export const CODEX_LOCAL_PROXY_BASE_URL = "http://127.0.0.1:4312";
export const OPENCODE_SERVER_BASE_URL = "http://127.0.0.1:4311";
export const OPENCODE_USAGE_LOG_PATH = ".opencode/artifacts/opencode-usage.jsonl";
export const OPENCODE_RUNTIME_METADATA_PATH = ".diabolo/opencode-runtime.json";

export const CODEX_LOCAL_PROXY_SCRIPT = String.raw`import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const port = Number(process.env.OPENCODE_CODEX_PROXY_PORT || "4312");
const mode = (process.env.OPENCODE_PROXY_MODE || "manual").trim() || "manual";
const providerId = (process.env.OPENCODE_CODEX_PROVIDER_ID || "codex").trim() || "codex";
const endpoint = "https://chatgpt.com/backend-api/codex/responses";
const upstreamBaseUrl = (process.env.OPENCODE_PROXY_UPSTREAM_BASE_URL || "").trim().replace(/\/+$/, "");
const usageLogPath = (process.env.OPENCODE_PROXY_USAGE_LOG_PATH || "").trim();

const appendUsageRecord = async (usage) => {
  if (!usageLogPath || !usage || typeof usage !== "object") {
    return;
  }

  const inputTokens =
    typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
  const outputTokens =
    typeof usage.outputTokens === "number" && Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
  const cacheCreationTokens =
    typeof usage.cacheCreationTokens === "number" && Number.isFinite(usage.cacheCreationTokens)
      ? usage.cacheCreationTokens
      : 0;
  const cacheReadTokens =
    typeof usage.cacheReadTokens === "number" && Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0;
  const reasoningTokens =
    typeof usage.reasoningTokens === "number" && Number.isFinite(usage.reasoningTokens)
      ? usage.reasoningTokens
      : 0;
  const totalTokens =
    typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)
      ? usage.totalTokens
      : inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens + reasoningTokens;

  if (totalTokens <= 0) {
    return;
  }

  await fs.mkdir(path.dirname(usageLogPath), { recursive: true }).catch(() => {});
  await fs
    .appendFile(
      usageLogPath,
      JSON.stringify({
        cacheCreationTokens,
        cacheReadTokens,
        inputTokens,
        outputTokens,
        reasoningTokens,
        timestamp: Date.now(),
        totalTokens,
        type: "usage",
      }) + "\n",
      "utf8",
    )
    .catch(() => {});
};

const extractCodexUsage = (payload) => {
  const usage = payload?.usage;

  if (!usage || typeof usage !== "object") {
    return null;
  }

  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  const reasoningTokens =
    typeof usage.output_tokens_details?.reasoning_tokens === "number"
      ? usage.output_tokens_details.reasoning_tokens
      : 0;
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
};

const extractChatCompletionsUsage = (payload) => {
  const usage = payload?.usage;

  if (!usage || typeof usage !== "object") {
    return null;
  }

  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const cacheReadTokens =
    typeof usage.prompt_tokens_details?.cached_tokens === "number"
      ? usage.prompt_tokens_details.cached_tokens
      : 0;
  const inputTokens = Math.max(0, promptTokens - cacheReadTokens);
  const reasoningTokens =
    typeof usage.completion_tokens_details?.reasoning_tokens === "number"
      ? usage.completion_tokens_details.reasoning_tokens
      : 0;
  const totalTokens =
    typeof usage.total_tokens === "number" ? usage.total_tokens : promptTokens + completionTokens;

  return {
    cacheCreationTokens: 0,
    cacheReadTokens,
    inputTokens,
    outputTokens: completionTokens,
    reasoningTokens,
    totalTokens,
  };
};

const readJson = async (response) => {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
};

const getResponseErrorMessage = async (response) => {
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
    typeof payload.error.message === "string" &&
    payload.error.message
  ) {
    return payload.error.message;
  }

  const text = (await response.text().catch(() => "")).trim();
  return text || "Codex request failed.";
};

const extractMessageText = (message) => {
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

const normalizeRole = (role) => {
  if (role === "assistant" || role === "developer") {
    return role;
  }

  if (role === "system") {
    return "developer";
  }

  return "user";
};

const normalizeToolCallId = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || "call_" + crypto.randomUUID();
};

const normalizeToolChoice = (toolChoice) => {
  if (toolChoice === "auto" || toolChoice === "none" || toolChoice === "required") {
    return toolChoice;
  }

  const functionName =
    toolChoice?.type === "function" && typeof toolChoice?.function?.name === "string"
      ? toolChoice.function.name.trim()
      : "";

  return functionName ? { name: functionName, type: "function" } : undefined;
};

const mapTools = (tools) =>
  (tools ?? [])
    .flatMap((tool) => {
      const name = typeof tool?.function?.name === "string" ? tool.function.name.trim() : "";

      if (tool?.type !== "function" || !name) {
        return [];
      }

      return [
        {
          description:
            typeof tool.function?.description === "string" && tool.function.description.trim()
              ? tool.function.description.trim()
              : undefined,
          name,
          parameters:
            tool.function?.parameters && typeof tool.function.parameters === "object"
              ? tool.function.parameters
              : undefined,
          strict: typeof tool.function?.strict === "boolean" ? tool.function.strict : undefined,
          type: "function",
        },
      ];
    })
    .filter(Boolean);

const buildResponsesBody = (payload, model) => {
  const instructions =
    (payload.messages ?? [])
      .filter((message) => message?.role === "system")
      .map((message) => extractMessageText(message))
      .filter(Boolean)
      .join("\n\n") || "You are a helpful assistant.";

  const input = (payload.messages ?? []).flatMap((message) => {
    const text = extractMessageText(message);

    if (message?.role === "tool") {
      const callId =
        typeof message.tool_call_id === "string" ? normalizeToolCallId(message.tool_call_id) : "";

      return callId
        ? [
            {
              type: "function_call_output",
              call_id: callId,
              output: text || "",
            },
          ]
        : [];
    }

    const output = [];

    if (text) {
      output.push({
        type: "message",
        role: normalizeRole(message.role),
        content:
          message?.role === "system"
            ? text
            : [
                {
                  type: message?.role === "assistant" ? "output_text" : "input_text",
                  text,
                },
              ],
      });
    }

    if (message?.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        const name = typeof toolCall?.function?.name === "string" ? toolCall.function.name.trim() : "";
        const callId = typeof toolCall?.id === "string" ? normalizeToolCallId(toolCall.id) : "";

        if (!name || !callId || toolCall?.type !== "function") {
          continue;
        }

        output.push({
          type: "function_call",
          arguments:
            typeof toolCall.function?.arguments === "string" && toolCall.function.arguments.trim()
              ? toolCall.function.arguments
              : "{}",
          call_id: callId,
          name,
        });
      }
    }

    return output;
  });

  const tools = mapTools(payload.tools);

  return {
    instructions,
    input,
    model,
    parallel_tool_calls:
      typeof payload.parallel_tool_calls === "boolean" ? payload.parallel_tool_calls : undefined,
    store: false,
    stream: true,
    temperature: payload.temperature,
    tool_choice: normalizeToolChoice(payload.tool_choice),
    tools: tools.length > 0 ? tools : undefined,
  };
};

const getBackendModel = (model) => {
  const normalized = typeof model === "string" ? model.trim() : "";
  const prefix = providerId + "/";

  if (!normalized) {
    return "codex-mini-latest";
  }

  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
};

const extractOutputText = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = payload.output;

  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.content)) {
        return [];
      }

      return entry.content.flatMap((part) => {
        if (
          part &&
          typeof part === "object" &&
          part.type === "output_text" &&
          typeof part.text === "string"
        ) {
          return [part.text];
        }

        return [];
      });
    })
    .join("\n")
    .trim();
};

const extractToolCalls = (payload) => {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.output)) {
    return [];
  }

  return payload.output.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    if (
      item.type !== "function_call" ||
      typeof item.name !== "string" ||
      typeof item.call_id !== "string"
    ) {
      return [];
    }

    return [
      {
        id: item.call_id,
        type: "function",
        function: {
          name: item.name,
          arguments:
            typeof item.arguments === "string" && item.arguments.trim() ? item.arguments : "{}",
        },
      },
    ];
  });
};

const getFinishReason = (payload) => {
  if ((payload.toolCalls ?? []).length > 0) {
    return "tool_calls";
  }

  return payload.content ? "stop" : "length";
};

const parseSsePayload = async (response) => {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let dataBuffer = "";
  let lineBuffer = "";
  let completedResponse = null;
  const outputItems = new Map();
  let responseId = null;
  const outputTextParts = [];
  let sawDone = false;
  let usage = null;

  const flushEvent = () => {
    const trimmed = dataBuffer.trim();
    dataBuffer = "";

    if (!trimmed || trimmed === "[DONE]") {
      return;
    }

    try {
      const event = JSON.parse(trimmed);
      const type = typeof event?.type === "string" ? event.type : "";

      if (!responseId && typeof event?.response_id === "string") {
        responseId = event.response_id;
      }

      if (type === "response.output_text.delta" && typeof event?.delta === "string") {
        outputTextParts.push(event.delta);
      }

      if (type === "response.output_text.done" && typeof event?.text === "string") {
        outputTextParts.push(event.text);
      }

      if (
        type === "response.content_part.done" &&
        event?.part &&
        typeof event.part === "object" &&
        event.part.type === "output_text" &&
        typeof event.part.text === "string"
      ) {
        outputTextParts.push(event.part.text);
      }

      if (type === "response.output_item.added" && event?.item && typeof event.item === "object") {
        const itemId = typeof event.item?.id === "string" ? event.item.id : null;

        if (itemId) {
          outputItems.set(itemId, { ...event.item });
        }
      }

      if (type === "response.output_item.done" && event?.item && typeof event.item === "object") {
        const itemId = typeof event.item?.id === "string" ? event.item.id : null;

        if (itemId) {
          outputItems.set(itemId, { ...(outputItems.get(itemId) ?? {}), ...event.item });
        }
      }

      if (type === "response.completed" && event?.response && typeof event.response === "object") {
        completedResponse = event.response;
        usage = extractCodexUsage(event.response);
        if (
          outputItems.size > 0 &&
          (!Array.isArray(completedResponse?.output) || completedResponse.output.length === 0)
        ) {
          completedResponse.output = Array.from(outputItems.values());
        }
        if (typeof completedResponse?.id === "string") {
          responseId = completedResponse.id;
        }
        sawDone = true;
      }
    } catch {}
  };

  const processTextChunk = (text) => {
    lineBuffer += text;

    while (true) {
      const newlineIndex = lineBuffer.indexOf("\n");

      if (newlineIndex === -1) {
        break;
      }

      const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      lineBuffer = lineBuffer.slice(newlineIndex + 1);

      if (line.startsWith("data:")) {
        dataBuffer += line.slice(5).trim() + "\n";
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
    if (usage) {
      completedResponse.usage = usage;
    }
    return completedResponse;
  }

  return outputTextParts.length > 0 ? { id: responseId, output_text: outputTextParts.join(""), usage } : null;
};

const createChatCompletion = ({ content, id, model, toolCalls, usage }) => ({
  id: typeof id === "string" && id ? id : "chatcmpl-" + crypto.randomUUID(),
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model,
  usage:
    usage && typeof usage === "object"
      ? {
          completion_tokens: usage.outputTokens,
          prompt_tokens: usage.inputTokens,
          total_tokens: usage.totalTokens,
        }
      : undefined,
  choices: [
    {
      index: 0,
      finish_reason: getFinishReason({ content, toolCalls }),
      message: {
        role: "assistant",
        content: content || null,
        ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
      },
    },
  ],
});

const sendJson = (response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

const sendStream = (response, payload) => {
  const id = typeof payload.id === "string" && payload.id ? payload.id : "chatcmpl-" + crypto.randomUUID();
  const created = Math.floor(Date.now() / 1000);

  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
  response.write(
    "data: " +
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
      }) +
      "\n\n",
  );
  if (payload.content) {
    response.write(
      "data: " +
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
        }) +
        "\n\n",
    );
  }
  for (const [index, toolCall] of (payload.toolCalls ?? []).entries()) {
    response.write(
      "data: " +
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
        }) +
        "\n\n",
    );
  }
  if (payload.usage) {
    response.write(
      "data: " +
        JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model: payload.model,
          choices: [],
          usage: {
            completion_tokens: payload.usage.outputTokens,
            prompt_tokens: payload.usage.inputTokens,
            total_tokens: payload.usage.totalTokens,
          },
        }) +
        "\n\n",
    );
  }
  response.write(
    "data: " +
      JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model: payload.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: getFinishReason(payload),
          },
        ],
      }) +
      "\n\n",
  );
  response.write("data: [DONE]\n\n");
  response.end();
};

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  if (request.method !== "POST" || request.url !== "/chat/completions") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const authorization = request.headers.authorization || "";

  if (!authorization.trim()) {
    sendJson(response, 401, { error: "Missing Authorization header." });
    return;
  }

  const chunks = [];

  try {
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");
    const payload = rawBody ? JSON.parse(rawBody) : {};
    if (mode === "codex") {
      const model = getBackendModel(payload.model);
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
          origin: "https://chatgpt.com",
          referer: "https://chatgpt.com/",
          "user-agent": "OpenAI/Codex",
        },
        body: JSON.stringify(buildResponsesBody(payload, model)),
      });

      if (!upstream.ok) {
        sendJson(response, upstream.status, { error: await getResponseErrorMessage(upstream) });
        return;
      }

      const upstreamPayload = await parseSsePayload(upstream);
      const content = extractOutputText(upstreamPayload);
      const toolCalls = extractToolCalls(upstreamPayload);
      const usage = upstreamPayload?.usage ?? null;

      if (!content && toolCalls.length === 0) {
        sendJson(response, 502, { error: "Codex returned an empty response." });
        return;
      }

      await appendUsageRecord(usage);

      if (payload.stream) {
        sendStream(response, {
          content,
          id: upstreamPayload.id,
          model,
          toolCalls,
          usage,
        });
        return;
      }

      sendJson(
        response,
        200,
        createChatCompletion({
          content,
          id: upstreamPayload.id,
          model,
          toolCalls,
          usage,
        }),
      );
      return;
    }

    const manualEndpoint = upstreamBaseUrl ? upstreamBaseUrl + "/chat/completions" : "";

    if (!manualEndpoint) {
      sendJson(response, 500, { error: "Manual provider proxy is missing an upstream base URL." });
      return;
    }

    const manualPayload =
      payload && typeof payload === "object" && payload.stream
        ? {
            ...payload,
            stream_options: {
              ...(payload.stream_options && typeof payload.stream_options === "object"
                ? payload.stream_options
                : {}),
              include_usage: true,
            },
          }
        : payload;

    const upstream = await fetch(manualEndpoint, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(manualPayload),
    });

    if (!upstream.ok) {
      sendJson(response, upstream.status, { error: await getResponseErrorMessage(upstream) });
      return;
    }

    const responseHeaders = {
      "cache-control": upstream.headers.get("cache-control") || "no-cache",
      connection: upstream.headers.get("connection") || "keep-alive",
      "content-type":
        upstream.headers.get("content-type") || "text/event-stream; charset=utf-8",
    };

    if (payload.stream) {
      const text = await upstream.text();
      const usage = text
        .split("\n")
        .flatMap((line) => {
          const trimmed = line.trim();

          if (!trimmed.startsWith("data:")) {
            return [];
          }

          const rawEvent = trimmed.slice(5).trim();

          if (!rawEvent || rawEvent === "[DONE]") {
            return [];
          }

          try {
            return [JSON.parse(rawEvent)];
          } catch {
            return [];
          }
        })
        .map((event) => extractChatCompletionsUsage(event))
        .find(Boolean);

      await appendUsageRecord(usage);

      response.writeHead(200, responseHeaders);
      response.end(text);
      return;
    }

    const rawPayload = await upstream.text();
    let parsedPayload = null;

    try {
      parsedPayload = rawPayload ? JSON.parse(rawPayload) : null;
    } catch {}

    await appendUsageRecord(extractChatCompletionsUsage(parsedPayload));

    response.writeHead(200, {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    });
    response.end(rawPayload);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Failed to proxy provider request.",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write("codex-proxy:ready\n");
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
`;

const escapeForSingleQuotedShell = (value: string) => value.replace(/'/g, `'\\''`);

const writeGeneratedConfigCommand = [
  "python3 - <<'PY'",
  "import base64",
  "import os",
  "import pathlib",
  "",
  "target = pathlib.Path(os.getcwd()).parent / '.opencode.generated.json'",
  "target.write_text(base64.b64decode(os.environ['OPENCODE_CONFIG_CONTENT_B64']).decode('utf-8'))",
  "PY",
].join("\n");

const buildOpenCodeRuntimeEnsureCommand = () =>
  [
    "python3 - <<'PY'",
    "import base64",
    "import json",
    "import os",
    "import pathlib",
    "import subprocess",
    "import sys",
    "import time",
    "import urllib.error",
    "import urllib.request",
    "",
    "workspace = pathlib.Path(os.getcwd())",
    "artifacts_dir = workspace / '.opencode' / 'artifacts'",
    "artifacts_dir.mkdir(parents=True, exist_ok=True)",
    "metadata_path = workspace / '.diabolo' / 'opencode-runtime.json'",
    "metadata_path.parent.mkdir(parents=True, exist_ok=True)",
    "config_path = workspace.parent / '.opencode.generated.json'",
    "config_path.write_text(base64.b64decode(os.environ['OPENCODE_CONFIG_CONTENT_B64']).decode('utf-8'))",
    "proxy_path = workspace / '.diabolo' / 'codex-openai-proxy.mjs'",
    "proxy_log_path = artifacts_dir / 'codex-proxy.log'",
    "server_log_path = artifacts_dir / 'opencode-serve.log'",
    "proxy_health_url = os.environ.get('OPENCODE_CODEX_PROXY_HEALTH_URL', 'http://127.0.0.1:4312/health')",
    "proxy_base_url = os.environ.get('OPENCODE_CODEX_PROXY_BASE_URL', 'http://127.0.0.1:4312').rstrip('/')",
    "server_base_url = os.environ.get('OPENCODE_SERVER_BASE_URL', 'http://127.0.0.1:4311').rstrip('/')",
    "server_health_url = server_base_url + '/global/health'",
    "server_port = server_base_url.rsplit(':', 1)[-1]",
    "",
    "def read_json(path):",
    "    if not path.exists():",
    "        return {}",
    "    try:",
    "        return json.loads(path.read_text())",
    "    except Exception:",
    "        return {}",
    "",
    "def write_json(path, payload):",
    "    path.write_text(json.dumps(payload, indent=2) + '\\n')",
    "",
    "def http_json(url, method='GET', payload=None, timeout=5):",
    "    data = None if payload is None else json.dumps(payload).encode('utf-8')",
    "    req = urllib.request.Request(url, data=data, method=method)",
    "    if data is not None:",
    "        req.add_header('Content-Type', 'application/json')",
    "    with urllib.request.urlopen(req, timeout=timeout) as response:",
    "        body = response.read().decode('utf-8')",
    "        return response.status, json.loads(body) if body.strip() else {}",
    "",
    "def is_healthy(url):",
    "    try:",
    "        with urllib.request.urlopen(url, timeout=1) as response:",
    "            return 200 <= response.status < 300",
    "    except Exception:",
    "        return False",
    "",
    "def start_process(args, log_path):",
    "    log_file = open(log_path, 'ab')",
    "    env = os.environ.copy()",
    "    env['OPENCODE_CONFIG'] = str(config_path)",
    "    return subprocess.Popen(",
    "        args,",
    "        cwd=str(workspace),",
    "        env=env,",
    "        stdin=subprocess.DEVNULL,",
    "        stdout=log_file,",
    "        stderr=subprocess.STDOUT,",
    "        start_new_session=True,",
    "    )",
    "",
    "def wait_for_health(url, label):",
    "    for _ in range(50):",
    "        if is_healthy(url):",
    "            return",
    "        time.sleep(0.2)",
    "    raise RuntimeError(label + ' failed to become healthy.')",
    "",
    "metadata = read_json(metadata_path)",
    "",
    "if os.environ.get('OPENCODE_CODEX_USE_LOCAL_PROXY') == '1' and not is_healthy(proxy_health_url):",
    "    proxy_path.write_text(base64.b64decode(os.environ['OPENCODE_CODEX_PROXY_SCRIPT_B64']).decode('utf-8'))",
    "    proxy_process = start_process(['node', str(proxy_path)], proxy_log_path)",
    "    metadata['proxyPid'] = proxy_process.pid",
    "    wait_for_health(proxy_health_url, 'Codex sandbox proxy')",
    "",
    "if not is_healthy(server_health_url):",
    "    server_process = start_process(",
    "        ['opencode', 'serve', '--port', str(server_port), '--hostname', '127.0.0.1', '--print-logs'],",
    "        server_log_path,",
    "    )",
    "    metadata['serverPid'] = server_process.pid",
    "    wait_for_health(server_health_url, 'OpenCode server')",
    "",
    "session_id = metadata.get('sessionId') if isinstance(metadata.get('sessionId'), str) else None",
    "if session_id:",
    "    try:",
    "        status, _ = http_json(server_base_url + '/session/' + session_id, timeout=3)",
    "        if status >= 400:",
    "            session_id = None",
    "    except Exception:",
    "        session_id = None",
    "",
    "if not session_id:",
    "    _, payload = http_json(server_base_url + '/session', method='POST', payload={}, timeout=10)",
    "    session_id = payload.get('id')",
    "    if not isinstance(session_id, str) or not session_id.strip():",
    "        raise RuntimeError('Failed to create OpenCode session.')",
    "",
    "metadata.update({",
    "    'opencodeBaseUrl': server_base_url,",
    "    'proxyBaseUrl': proxy_base_url,",
    "    'sessionId': session_id,",
    "    'updatedAt': int(time.time() * 1000),",
    "})",
    "write_json(metadata_path, metadata)",
    "print(json.dumps({'type': 'runtime_ready', 'sessionId': session_id, 'opencodeBaseUrl': server_base_url}))",
    "PY",
  ].join("\n");

export const opencodeInstallCommand = [
  SANDBOX_TOOL_PATH_EXPORT,
  'if ! command -v opencode >/dev/null 2>&1; then echo "OpenCode is missing from the Daytona browser snapshot." >&2; exit 1; fi',
  "opencode --version",
  buildAgentBrowserOpenCodeSetupCommand(),
  buildGitToolsOpenCodeSetupCommand(),
  buildSpawnTaskOpenCodeSetupCommand(),
].join("\n");

export const buildOpenCodePrompt = (
  userPrompt: string,
  options?: {
    attachments?: Array<{ fileName: string; mediaType: string; sandboxPath: string }>;
    conversationHistory?: Array<{
      error?: string | null;
      kind: "follow_up" | "initial";
      prompt: string;
      responseMessages: Array<{ text: string }>;
      sequence: number;
      stage?: string;
      status: string;
    }>;
    envVarKeys?: string[];
    sandboxId?: string;
  },
) =>
  [
    "You are working inside a cloned GitHub repository.",
    "Solve the user's request with the smallest sufficient amount of work.",
    "Inspect only the code and files needed to complete the task.",
    "Keep tool calls focused and avoid unnecessary exploration, refactors, or repeated checks.",
    "Run only the verification needed for the specific change you made.",
    "Do not fix unrelated issues or expand the scope unless the user asks.",
    "Before you stop, you must send at least one plain-language assistant response addressed to the user.",
    "Do not end on tool calls, tool results, step markers, or logs alone.",
    "After using tools, always follow with a concise final assistant message that states what happened, what changed, and any remaining blocker or next step.",
    "If a tool fails or the task is blocked, explicitly tell the user that in your final assistant message instead of ending silently.",
    "Do not inspect or print secret files such as .env, .env.*, .diabolo/*, SSH keys, tokens, or credential stores unless the user explicitly asks for that.",
    "Custom git tools are available: git_status, git_create_branch, git_checkout_branch, git_stage, git_commit, git_push, git_pull, git_create_pr, and git_delete_branch.",
    "Do not create a branch, commit, push, or open a PR unless the user explicitly asks for it or the task is clearly about publishing changes.",
    "If you changed files but publishing was not requested, it is acceptable to finish with local workspace changes only.",
    "",
    "Fresh scaffold and bootstrap rules:",
    "If you create a new app, initialize a new package, or change package.json or a lockfile, install dependencies in that project before running build, test, dev, preview, or framework CLI commands that depend on local binaries.",
    "Do not run install, build, test, and serve commands in parallel for a freshly scaffolded app. Run them sequentially and wait for each step to finish before starting the next one.",
    "If a command fails because a project binary is missing, such as vite, next, react-scripts, astro, or tsc, treat that as a signal that dependencies for the current project are not installed yet. Install them in the current working directory, then retry.",
    "If the user asks you to inspect a local page or route, make dependency installation and local startup explicit: install dependencies first when needed, then start the app, then verify the app is reachable, then use the browser tools.",
    "For runtime verification artifacts such as logs, pid files, screenshots, and temporary output, use workspace-local paths like .opencode/artifacts or another hidden directory inside the repository. Do not use /tmp or other directories outside the workspace.",
    "Do not rely on optional host utilities such as lsof for verification. Prefer curl, direct process output, or the browser tools available in this sandbox.",
    "This repo's dev command is `pnpm dev` and it runs Vite. For localhost browser checks, prefer the Vite dev server URL and confirm the actual port from the dev output or by probing the server before opening the browser.",
    "",
    "Browser validation instructions:",
    "Browser/computer-use tools are always available in this sandbox.",
    "Use the local browser tools for browser automation, screenshots, and interactive verification whenever the task touches frontend behavior or the user asks for computer use.",
    "If the user explicitly asks for the browser, screenshots, clicking, typing, localhost pages, or similar interactive actions, you must use the browser tools instead of relying only on shell inspection.",
    options?.sandboxId
      ? `The current Daytona sandbox id is ${options.sandboxId}. Run browser automation inside this sandbox and keep browser activity local to it.`
      : "Use the current sandbox for local browser actions whenever possible.",
    "Key tools available include open_url, snapshot, click, fill, type, keyboard_type, press, wait, screenshot, evaluate, and close.",
    "Preferred workflow: open the page, take a snapshot to get refs like @e1, interact using those refs, then capture a screenshot before finishing when visual verification matters.",
    "For localhost pages, do not call open_url until the server is actually reachable. Start the app, wait for the correct localhost URL to respond, then open it in the browser tool.",
    "If open_url fails, do not stop. Check the dev server output, confirm the correct port and route, wait or retry, and continue until you can inspect the page or have a concrete blocker to report.",
    "When the user asks you to 'just tell me what you see', your final assistant message should briefly describe the visible page content, layout, and any obvious issues you noticed.",
    "",
    ...(options?.envVarKeys?.length
      ? [
          "Project environment variables:",
          `The following environment variables have been injected into this sandbox by the user: ${options.envVarKeys.join(", ")}.`,
          "They are available as process environment variables for commands you run.",
          "Do not open or print .env files to inspect secrets unless the user explicitly asks for that.",
          "Do not tell the user that no environment variables are defined — they are already present in this sandbox.",
          "",
        ]
      : []),
    ...(options?.attachments?.length
      ? [
          "Message attachments:",
          "The following files are attached to this OpenCode message and are also available inside the repository workspace:",
          ...options.attachments.map(
            (attachment) =>
              `- ${attachment.fileName} (${attachment.mediaType}) at ${attachment.sandboxPath}`,
          ),
          "Use these attachments as part of the user's request. If an attachment is an image, inspect it directly.",
          "",
        ]
      : []),
    ...(options?.conversationHistory?.length
      ? [
          "Conversation history from earlier task messages:",
          "Use earlier user messages here as context for the current follow-up.",
          "Do not treat earlier agent responses as the final answer for this follow-up.",
          ...options.conversationHistory.flatMap((message) => {
            return [
              `Earlier ${message.kind === "initial" ? "initial task" : "follow-up"} ${message.sequence + 1} user message:`,
              message.prompt.trim(),
              ...(message.error?.trim()
                ? [
                    `Earlier ${message.kind === "initial" ? "initial task" : "follow-up"} ${message.sequence + 1} error:`,
                    message.error.trim(),
                  ]
                : []),
              ...(message.status !== "completed"
                ? [
                    `Earlier ${message.kind === "initial" ? "initial task" : "follow-up"} ${message.sequence + 1} status:`,
                    message.status,
                  ]
                : []),
              "",
            ];
          }),
        ]
      : []),
    "User task:",
    userPrompt.trim(),
  ].join("\n");

export const buildOpenCodeRuntimeCommand = () =>
  [
    SANDBOX_TOOL_PATH_EXPORT,
    writeGeneratedConfigCommand,
    'export OPENCODE_CONFIG="$PWD/../.opencode.generated.json"',
    buildOpenCodeRuntimeEnsureCommand(),
  ].join("\n");

const buildOpenCodePromptRunnerCommand = () =>
  [
    "python3 - <<'PY'",
    "import base64",
    "import json",
    "import os",
    "import pathlib",
    "import socket",
    "import sys",
    "import time",
    "import urllib.error",
    "import urllib.request",
    "import uuid",
    "",
    "INACTIVITY_TIMEOUT_SECONDS = 120",
    "PROMPT_MAX_DURATION_SECONDS = 3600",
    "",
    "workspace = pathlib.Path(os.getcwd())",
    "metadata_path = workspace / '.diabolo' / 'opencode-runtime.json'",
    "usage_log_path = workspace / '.opencode' / 'artifacts' / 'opencode-usage.jsonl'",
    "prompt = base64.b64decode(os.environ['OPENCODE_RUN_PROMPT_B64']).decode('utf-8')",
    "model = os.environ['OPENCODE_RUN_MODEL']",
    "attachments = json.loads(base64.b64decode(os.environ['OPENCODE_RUN_ATTACHMENTS_B64']).decode('utf-8'))",
    "",
    "def fail(message):",
    "    print(json.dumps({'type': 'error', 'message': message}))",
    "    sys.exit(0)",
    "",
    "def emit(payload):",
    "    print(json.dumps(payload))",
    "    sys.stdout.flush()",
    "",
    "def http_json(url, method='GET', payload=None, timeout=30):",
    "    data = None if payload is None else json.dumps(payload).encode('utf-8')",
    "    req = urllib.request.Request(url, data=data, method=method)",
    "    if data is not None:",
    "        req.add_header('Content-Type', 'application/json')",
    "    with urllib.request.urlopen(req, timeout=timeout) as response:",
    "        body = response.read().decode('utf-8')",
    "        return response.status, json.loads(body) if body.strip() else {}",
    "",
    "def request_abort():",
    "    try:",
    "        http_json(base_url + '/session/' + session_id + '/abort', method='POST', payload={}, timeout=10)",
    "    except Exception:",
    "        pass",
    "",
    "try:",
    "    metadata = json.loads(metadata_path.read_text())",
    "except Exception:",
    "    fail('OpenCode runtime metadata is missing.')",
    "",
    "base_url = str(metadata.get('opencodeBaseUrl') or '').rstrip('/')",
    "session_id = str(metadata.get('sessionId') or '').strip()",
    "if not base_url or not session_id:",
    "    fail('OpenCode runtime is not initialized.')",
    "",
    "if usage_log_path.exists():",
    "    usage_log_path.unlink()",
    "",
    "provider_id, model_id = (model.split('/', 1) + [''])[:2] if '/' in model else ('', model)",
    "message_id = 'msg_%013d_%s' % (int(time.time() * 1000), uuid.uuid4().hex)",
    "request_body = {",
    "    'messageID': message_id,",
    "    'parts': [{'type': 'text', 'text': prompt}],",
    "}",
    "if provider_id and model_id:",
    "    request_body['model'] = {'providerID': provider_id, 'modelID': model_id}",
    "",
    "sse_request = urllib.request.Request(base_url + '/event', method='GET')",
    "prompt_request = urllib.request.Request(",
    "    base_url + '/session/' + session_id + '/prompt_async',",
    "    data=json.dumps(request_body).encode('utf-8'),",
    "    method='POST',",
    "    headers={'Content-Type': 'application/json'},",
    ")",
    "",
    "cumulative_text = {}",
    "emitted_tool_states = set()",
    "allowed_assistant_ids = set()",
    "pending_parts = {}",
    "compaction_occurred = False",
    "tracked_assistant_ids = set()",
    "session_error = None",
    "last_activity = time.time()",
    "",
    "def buffer_part(oc_message_id, part, delta):",
    "    pending_parts.setdefault(oc_message_id, []).append((part, delta))",
    "",
    "def handle_part(part, delta=None):",
    "    part_type = part.get('type')",
    "    if part_type == 'text':",
    "        part_id = str(part.get('id') or '')",
    "        text = str(part.get('text') or '')",
    "        if delta:",
    "            next_text = cumulative_text.get(part_id, '') + str(delta)",
    "        else:",
    "            next_text = text",
    "        if next_text and len(next_text) > len(cumulative_text.get(part_id, '')):",
    "            cumulative_text[part_id] = next_text",
    "            emit({'type': 'text', 'part': {'text': next_text}})",
    "        return",
    "    if part_type == 'tool':",
    "        state = part.get('state', {}) if isinstance(part.get('state'), dict) else {}",
    "        status = str(state.get('status') or '')",
    "        tool_input = state.get('input', {})",
    "        if status in ('', 'pending') and not tool_input:",
    "            return",
    "        key = '%s:%s:%s:%s' % (part.get('sessionID', ''), part.get('callID', ''), status, part.get('tool', ''))",
    "        if key in emitted_tool_states:",
    "            return",
    "        emitted_tool_states.add(key)",
    "        emit({'type': 'tool_result', 'part': part})",
    "        return",
    "    if part_type == 'step-start':",
    "        emit({'type': 'tool_result', 'part': part})",
    "        return",
    "    if part_type == 'step-finish':",
    "        emit({'type': 'tool_result', 'part': part})",
    "",
    "def flush_pending_parts(oc_message_id):",
    "    pending = pending_parts.pop(oc_message_id, [])",
    "    for part, delta in pending:",
    "        handle_part(part, delta)",
    "",
    "def sync_message_state():",
    "    saw_active_tool = False",
    "    saw_progress = False",
    "    try:",
    "        _, messages = http_json(base_url + '/session/' + session_id + '/message', timeout=30)",
    "    except Exception:",
    "        return saw_progress, saw_active_tool",
    "    if not isinstance(messages, list):",
    "        return saw_progress, saw_active_tool",
    "    for message in messages:",
    "        if not isinstance(message, dict):",
    "            continue",
    "        info = message.get('info', {}) if isinstance(message.get('info'), dict) else {}",
    "        if info.get('role') != 'assistant':",
    "            continue",
    "        parent_matches = info.get('parentID') == message_id",
    "        in_tracked_set = info.get('id') in tracked_assistant_ids",
    "        is_compaction_summary = info.get('summary') is True",
    "        if not (parent_matches or in_tracked_set or (compaction_occurred and not is_compaction_summary)):",
    "            continue",
    "        for part in message.get('parts', []):",
    "            if not isinstance(part, dict):",
    "                continue",
    "            if part.get('type') == 'tool':",
    "                state = part.get('state', {}) if isinstance(part.get('state'), dict) else {}",
    "                if str(state.get('status') or '') == 'running':",
    "                    saw_active_tool = True",
    "            before_text = dict(cumulative_text)",
    "            before_tool_count = len(emitted_tool_states)",
    "            handle_part(part)",
    "            if cumulative_text != before_text or len(emitted_tool_states) != before_tool_count:",
    "                saw_progress = True",
    "    return saw_progress, saw_active_tool",
    "",
    "try:",
    "    sse_response = urllib.request.urlopen(sse_request, timeout=5)",
    "except Exception as exc:",
    "    fail('Failed to connect to OpenCode SSE: ' + str(exc))",
    "",
    "try:",
    "    try:",
    "        urllib.request.urlopen(prompt_request, timeout=30).read()",
    "    except urllib.error.HTTPError as exc:",
    "        body = exc.read().decode('utf-8', errors='replace').strip()",
    "        fail(body or ('OpenCode prompt request failed with status %s.' % exc.code))",
    "",
    "    event_lines = []",
    "    start = time.time()",
    "    while True:",
    "        now = time.time()",
    "        if now - start > PROMPT_MAX_DURATION_SECONDS:",
    "            request_abort()",
    "            sync_message_state()",
    "            session_error = 'OpenCode prompt exceeded the maximum duration.'",
    "            break",
    "        if now - last_activity > INACTIVITY_TIMEOUT_SECONDS:",
    "            saw_progress, saw_active_tool = sync_message_state()",
    "            if saw_progress or saw_active_tool:",
    "                last_activity = now",
    "                continue",
    "            request_abort()",
    "            sync_message_state()",
    "            session_error = 'OpenCode SSE stream inactive for too long.'",
    "            break",
    "        try:",
    "            raw_line = sse_response.readline()",
    "        except (TimeoutError, socket.timeout):",
    "            continue",
    "        except OSError as exc:",
    "            if 'timed out' in str(exc).lower():",
    "                continue",
    "            session_error = 'OpenCode SSE connection failed: ' + str(exc)",
    "            break",
    "        if not raw_line:",
    "            continue",
    "        last_activity = time.time()",
    "        line = raw_line.decode('utf-8', errors='replace').rstrip('\\r\\n')",
    "        if line.startswith('data:'):",
    "            event_lines.append(line[5:].lstrip())",
    "            continue",
    "        if line:",
    "            continue",
    "        if not event_lines:",
    "            continue",
    "        event = None",
    "        try:",
    "            event = json.loads('\\n'.join(event_lines))",
    "        except Exception:",
    "            event_lines = []",
    "            continue",
    "        event_lines = []",
    "        event_type = event.get('type')",
    "        props = event.get('properties', {}) if isinstance(event.get('properties'), dict) else {}",
    "        if event_type == 'session.error' and props.get('sessionID') == session_id:",
    "            error = props.get('error', {}) if isinstance(props.get('error'), dict) else {}",
    "            data = error.get('data', {}) if isinstance(error.get('data'), dict) else {}",
    "            session_error = data.get('message') or error.get('message') or error.get('name') or 'OpenCode session error.'",
    "            break",
    "        if event_type == 'message.updated':",
    "            info = props.get('info', {}) if isinstance(props.get('info'), dict) else {}",
    "            if info.get('sessionID') == session_id and info.get('role') == 'assistant':",
    "                oc_message_id = info.get('id')",
    "                parent_matches = info.get('parentID') == message_id",
    "                is_compaction_summary = info.get('summary') is True",
    "                if isinstance(oc_message_id, str) and oc_message_id and (parent_matches or (compaction_occurred and not is_compaction_summary)):",
    "                    tracked_assistant_ids.add(oc_message_id)",
    "                    allowed_assistant_ids.add(oc_message_id)",
    "                    flush_pending_parts(oc_message_id)",
    "        if event_type == 'message.part.updated':",
    "            part = props.get('part', {}) if isinstance(props.get('part'), dict) else {}",
    "            delta = props.get('delta')",
    "            oc_message_id = part.get('messageID')",
    "            if isinstance(oc_message_id, str) and oc_message_id:",
    "                if oc_message_id in allowed_assistant_ids:",
    "                    handle_part(part, delta)",
    "                else:",
    "                    buffer_part(oc_message_id, part, delta)",
    "        if event_type == 'session.idle' and props.get('sessionID') == session_id:",
    "            sync_message_state()",
    "            break",
    "        if event_type == 'session.status' and props.get('sessionID') == session_id:",
    "            status = props.get('status', {}) if isinstance(props.get('status'), dict) else {}",
    "            if status.get('type') == 'idle':",
    "                sync_message_state()",
    "                break",
    "        if event_type == 'session.compacted' and props.get('sessionID') == session_id:",
    "            compaction_occurred = True",
    "finally:",
    "    try:",
    "        sse_response.close()",
    "    except Exception:",
    "        pass",
    "",
    "if session_error:",
    "    emit({'type': 'error', 'message': session_error})",
    "PY",
  ].join("\n");

export const buildOpenCodePromptCommand = (
  model: string,
  prompt: string,
  attachments?: Array<{ sandboxPath: string }>,
) => {
  const attachmentPaths = (attachments ?? []).map((attachment) => attachment.sandboxPath);
  const promptB64 = Buffer.from(prompt, "utf8").toString("base64");
  const attachmentsB64 = Buffer.from(JSON.stringify(attachmentPaths), "utf8").toString("base64");

  return [
    SANDBOX_TOOL_PATH_EXPORT,
    `export OPENCODE_RUN_MODEL='${escapeForSingleQuotedShell(model)}'`,
    `export OPENCODE_RUN_PROMPT_B64='${escapeForSingleQuotedShell(promptB64)}'`,
    `export OPENCODE_RUN_ATTACHMENTS_B64='${escapeForSingleQuotedShell(attachmentsB64)}'`,
    buildOpenCodePromptRunnerCommand(),
  ].join("\n");
};
