import { buildAgentBrowserOpenCodeSetupCommand } from "@/lib/opencode/agent-browser";
import { buildGitToolsOpenCodeSetupCommand } from "@/lib/opencode/git-tools";
import { buildSpawnTaskOpenCodeSetupCommand } from "@/lib/opencode/spawn-task";

const SANDBOX_TOOL_PATH_EXPORT =
  'export PATH="$HOME/.local/bin:$HOME/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:$(npm config get prefix)/bin:$PATH"';

export const CODEX_LOCAL_PROXY_BASE_URL = "http://127.0.0.1:4312";

export const CODEX_LOCAL_PROXY_SCRIPT = String.raw`import http from "node:http";

const port = Number(process.env.OPENCODE_CODEX_PROXY_PORT || "4312");
const providerId = (process.env.OPENCODE_CODEX_PROVIDER_ID || "codex").trim() || "codex";
const endpoint = "https://chatgpt.com/backend-api/codex/responses";

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
        content: message?.role === "system" ? text : [{ type: "input_text", text }],
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

      if (
        (type === "response.output_text.delta" || type === "response.output_text.added") &&
        typeof event?.delta === "string"
      ) {
        outputTextParts.push(event.delta);
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
    return completedResponse;
  }

  return outputTextParts.length > 0 ? { id: responseId, output_text: outputTextParts.join("") } : null;
};

const createChatCompletion = ({ content, id, model, toolCalls }) => ({
  id: typeof id === "string" && id ? id : "chatcmpl-" + crypto.randomUUID(),
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model,
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

    if (!content && toolCalls.length === 0) {
      sendJson(response, 502, { error: "Codex returned an empty response." });
      return;
    }

    if (payload.stream) {
      sendStream(response, {
        content,
        id: upstreamPayload.id,
        model,
        toolCalls,
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
      }),
    );
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Failed to proxy Codex request.",
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

const buildOpenCodeRunnerCommand = () =>
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
    "artifacts_dir = pathlib.Path(os.getcwd()) / '.opencode' / 'artifacts'",
    "artifacts_dir.mkdir(parents=True, exist_ok=True)",
    "log_path = artifacts_dir / 'opencode-run.log'",
    "proxy_path = pathlib.Path(os.getcwd()) / '.diabolo' / 'codex-openai-proxy.mjs'",
    "proxy_log_path = artifacts_dir / 'codex-proxy.log'",
    "",
    "model = os.environ['OPENCODE_RUN_MODEL']",
    "prompt = base64.b64decode(os.environ['OPENCODE_RUN_PROMPT_B64']).decode('utf-8')",
    "attachments = json.loads(base64.b64decode(os.environ['OPENCODE_RUN_ATTACHMENTS_B64']).decode('utf-8'))",
    "",
    "proxy_process = None",
    "proxy_log_file = None",
    "if os.environ.get('OPENCODE_CODEX_USE_LOCAL_PROXY') == '1':",
    "    proxy_path.parent.mkdir(parents=True, exist_ok=True)",
    "    proxy_path.write_text(base64.b64decode(os.environ['OPENCODE_CODEX_PROXY_SCRIPT_B64']).decode('utf-8'))",
    "    proxy_log_file = open(proxy_log_path, 'wb')",
    "    proxy_process = subprocess.Popen(",
    "        ['node', str(proxy_path)],",
    "        cwd=os.getcwd(),",
    "        env=os.environ.copy(),",
    "        stdout=proxy_log_file,",
    "        stderr=subprocess.STDOUT,",
    "        stdin=subprocess.DEVNULL,",
    "    )",
    "    proxy_health_url = os.environ.get('OPENCODE_CODEX_PROXY_HEALTH_URL', 'http://127.0.0.1:4312/health')",
    "    proxy_ready = False",
    "    for _ in range(50):",
    "        if proxy_process.poll() is not None:",
    "            break",
    "        try:",
    "            with urllib.request.urlopen(proxy_health_url, timeout=1) as health_response:",
    "                if health_response.status == 200:",
    "                    proxy_ready = True",
    "                    break",
    "        except Exception:",
    "            time.sleep(0.2)",
    "    if not proxy_ready:",
    "        raise RuntimeError('Codex sandbox proxy failed to start.')",
    "",
    "args = ['opencode', 'run', '--format', 'json', '--model', model, prompt]",
    "for attachment in attachments:",
    "    args.extend(['--file', attachment])",
    "",
    "return_code = 1",
    "last_offset = 0",
    "try:",
    "    with open(log_path, 'wb') as log_file:",
    "        process = subprocess.Popen(",
    "            args,",
    "            cwd=os.getcwd(),",
    "            env=os.environ.copy(),",
    "            stdout=log_file,",
    "            stderr=subprocess.STDOUT,",
    "            stdin=subprocess.DEVNULL,",
    "        )",
    "",
    "        while True:",
    "            if log_path.exists():",
    "                with open(log_path, 'rb') as reader:",
    "                    reader.seek(last_offset)",
    "                    chunk = reader.read()",
    "                    if chunk:",
    "                        sys.stdout.buffer.write(chunk)",
    "                        sys.stdout.buffer.flush()",
    "                        last_offset = reader.tell()",
    "",
    "            return_code = process.poll()",
    "            if return_code is not None:",
    "                break",
    "",
    "            time.sleep(0.2)",
    "",
    "    if log_path.exists():",
    "        with open(log_path, 'rb') as reader:",
    "            reader.seek(last_offset)",
    "            tail = reader.read()",
    "            if tail:",
    "                sys.stdout.buffer.write(tail)",
    "                sys.stdout.buffer.flush()",
    "finally:",
    "    if proxy_process is not None and proxy_process.poll() is None:",
    "        proxy_process.terminate()",
    "        try:",
    "            proxy_process.wait(timeout=5)",
    "        except subprocess.TimeoutExpired:",
    "            proxy_process.kill()",
    "    if proxy_log_file is not None:",
    "        proxy_log_file.close()",
    "",
    "sys.exit(return_code)",
    "PY",
  ].join("\n");

export const opencodeInstallCommand = [
  SANDBOX_TOOL_PATH_EXPORT,
  'if ! command -v opencode >/dev/null 2>&1; then echo "OpenCode is missing from the Daytona browser snapshot." >&2; exit 1; fi',
  "opencode --version",
  buildAgentBrowserOpenCodeSetupCommand(),
  buildSpawnTaskOpenCodeSetupCommand(),
  buildGitToolsOpenCodeSetupCommand(),
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
    "Complete the user's task fully before you stop.",
    "Inspect the codebase first, make the required changes, and run the relevant verification commands.",
    "Fix any issues you find during verification before finishing.",
    "Do not inspect or print secret files such as .env, .env.*, .diabolo/*, SSH keys, tokens, or credential stores unless the user explicitly asks for that.",
    "Custom git tools are available: git_status, git_create_branch, git_checkout_branch, git_stage, git_commit, git_push, git_pull, git_create_pr, and git_delete_branch.",
    "Completion rule: if you changed repository files in a meaningful way, do not finish with only local workspace changes. You must create a branch, stage the relevant files, commit the work, push the branch, and open a pull request before you stop unless the user explicitly asked you not to.",
    "Bias strongly toward opening a PR for real implementation work so the result is handoff-ready without extra user steps.",
    "Do not create a branch, commit, push, or PR if you only inspected the repo, debugged, or ran tests without meaningful code changes.",
    "",
    "Fresh scaffold and bootstrap rules:",
    "If you create a new app, initialize a new package, or change package.json or a lockfile, install dependencies in that project before running build, test, dev, preview, or framework CLI commands that depend on local binaries.",
    "Do not run install, build, test, and serve commands in parallel for a freshly scaffolded app. Run them sequentially and wait for each step to finish before starting the next one.",
    "If a command fails because a project binary is missing, such as vite, next, react-scripts, astro, or tsc, treat that as a signal that dependencies for the current project are not installed yet. Install them in the current working directory, then retry.",
    "For runtime verification artifacts such as logs, pid files, screenshots, and temporary output, use workspace-local paths like .opencode/artifacts or another hidden directory inside the repository. Do not use /tmp or other directories outside the workspace.",
    "Do not rely on optional host utilities such as lsof for verification. Prefer curl, direct process output, or the browser tools available in this sandbox.",
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

export const buildOpenCodeRunCommand = (
  model: string,
  prompt: string,
  attachments?: Array<{ sandboxPath: string }>,
) => {
  const attachmentPaths = (attachments ?? []).map((attachment) => attachment.sandboxPath);
  const promptB64 = Buffer.from(prompt, "utf8").toString("base64");
  const attachmentsB64 = Buffer.from(JSON.stringify(attachmentPaths), "utf8").toString("base64");

  return [
    SANDBOX_TOOL_PATH_EXPORT,
    writeGeneratedConfigCommand,
    'export OPENCODE_CONFIG="$PWD/../.opencode.generated.json"',
    `export OPENCODE_RUN_MODEL='${escapeForSingleQuotedShell(model)}'`,
    `export OPENCODE_RUN_PROMPT_B64='${escapeForSingleQuotedShell(promptB64)}'`,
    `export OPENCODE_RUN_ATTACHMENTS_B64='${escapeForSingleQuotedShell(attachmentsB64)}'`,
    buildOpenCodeRunnerCommand(),
  ].join("\n");
};
