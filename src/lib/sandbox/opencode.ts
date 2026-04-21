import { buildAgentBrowserOpenCodeSetupCommand } from "@/lib/opencode/agent-browser";
import { buildGitToolsOpenCodeSetupCommand } from "@/lib/opencode/git-tools";
import { buildSpawnTaskOpenCodeSetupCommand } from "@/lib/opencode/spawn-task";

const SANDBOX_TOOL_PATH_EXPORT =
  'export PATH="$HOME/.local/bin:$HOME/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:$(npm config get prefix)/bin:$PATH"';

export const CODEX_LOCAL_PROXY_BASE_URL = "http://127.0.0.1:4312";
export const OPENCODE_USAGE_LOG_PATH = ".opencode/artifacts/opencode-usage.jsonl";

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

  const output = payload.output;

  if (!Array.isArray(output)) {
    return typeof payload.output_text === "string" && payload.output_text.trim()
      ? payload.output_text.trim()
      : "";
  }

  const text = [...output]
    .reverse()
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }

      if (entry.type !== "message" || entry.role !== "assistant" || !Array.isArray(entry.content)) {
        return [];
      }

      return entry.content.flatMap((part) => {
        if (
          part &&
          typeof part === "object" &&
          (part.type === "output_text" || part.type === "text") &&
          typeof part.text === "string"
        ) {
          return [part.text];
        }

        return [];
      });
    })
    .join("\n")
    .trim();

  if (text) {
    return text;
  }

  return typeof payload.output_text === "string" && payload.output_text.trim()
    ? payload.output_text.trim()
    : "";
};

const extractToolCalls = (payload) => {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray(payload.output) ||
    extractOutputText(payload)
  ) {
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
        if (
          outputTextParts.length > 0 &&
          (typeof completedResponse?.output_text !== "string" || !completedResponse.output_text.trim())
        ) {
          completedResponse.output_text = outputTextParts.join("");
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

export const opencodeInstallCommand = [
  SANDBOX_TOOL_PATH_EXPORT,
  'if ! command -v opencode >/dev/null 2>&1; then echo "OpenCode is missing from the Daytona browser snapshot." >&2; exit 1; fi',
  "opencode --version",
  buildAgentBrowserOpenCodeSetupCommand(),
  buildGitToolsOpenCodeSetupCommand(),
  buildSpawnTaskOpenCodeSetupCommand(),
].join("\n");
