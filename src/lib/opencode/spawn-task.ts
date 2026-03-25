import "@tanstack/react-start/server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/env/server";

const doubleQuoteForShell = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const writeFileCommand = (targetPath: string, content: string) =>
  [
    `mkdir -p "$(dirname ${doubleQuoteForShell(targetPath)})"`,
    `cat <<'EOF' > ${doubleQuoteForShell(targetPath)}`,
    content,
    "EOF",
  ].join("\n");

const SPAWN_TASK_PACKAGE_JSON = JSON.stringify(
  {
    name: "diabolo-opencode-tools",
    private: true,
    type: "module",
    dependencies: {
      "@daytonaio/sdk": "latest",
      "@opencode-ai/plugin": "latest",
      zod: "^4.3.6",
    },
  },
  null,
  2,
);

const SPAWN_TASK_TOOL_CONTENT = String.raw`import { z } from "zod";

const responseToText = async (response) => {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json();
      return typeof payload?.error === "string" ? payload.error : JSON.stringify(payload, null, 2);
    } catch {}
  }

  return (await response.text()).trim();
};

export default {
  description:
    "Spawn a child background coding task in the same repository. Use this to delegate a bounded sub-task while you continue working.",
  args: {
    title: z.string().min(1).describe("Short title describing the child task."),
    prompt: z
      .string()
      .min(10)
      .describe("Detailed instructions for the child task. The child only sees what you write here."),
    model: z
      .string()
      .optional()
      .describe("Optional model override for the child task."),
  },
  async execute(args) {
    const endpoint = process.env.OPENCODE_SPAWN_TASK_ENDPOINT;
    const parentTaskId = process.env.OPENCODE_SPAWN_TASK_PARENT_ID;
    const token = process.env.OPENCODE_SPAWN_TASK_TOKEN;

    if (!endpoint || !parentTaskId || !token) {
      throw new Error("spawn-task is not configured in this sandbox.");
    }

    let response;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: args.model || null,
          parentTaskId,
          prompt: args.prompt,
          title: args.title,
        }),
      });
    } catch (error) {
      throw new Error(
        "Failed to reach the spawn-task endpoint: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }

    if (!response.ok) {
      throw new Error(await responseToText(response));
    }

    const payload = await response.json();

    return [
      "Child task spawned successfully.",
      "",
      "  Task ID: " + payload.taskId,
      "  Status:  QUEUED",
      payload.url ? "  URL:     " + payload.url : null,
      "",
      "Use the task id to reference this child task later.",
    ]
      .filter(Boolean)
      .join("\n");
  },
};
`;

const hashSpawnTaskToken = (taskId: string) =>
  createHmac("sha256", env.BETTER_AUTH_SECRET).update(`spawn-task:${taskId}`).digest("hex");

export const createSpawnTaskToken = (taskId: string) => hashSpawnTaskToken(taskId);

export const verifySpawnTaskToken = (taskId: string, token: string) => {
  const expected = Buffer.from(hashSpawnTaskToken(taskId));
  const actual = Buffer.from(token);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
};

export const getSpawnTaskEndpoint = () =>
  new URL("/api/opencode/spawn-task", env.VITE_BASE_URL).toString();

export const buildSpawnTaskOpenCodeSetupCommand = () =>
  [
    'OPENCODE_TOOLS_ROOT="${OPENCODE_TOOLS_ROOT:-$HOME/.config/opencode}"',
    'mkdir -p "$OPENCODE_TOOLS_ROOT/tools"',
    writeFileCommand("$OPENCODE_TOOLS_ROOT/package.json", SPAWN_TASK_PACKAGE_JSON),
    writeFileCommand("$OPENCODE_TOOLS_ROOT/tools/spawn-task.ts", SPAWN_TASK_TOOL_CONTENT),
    'GLOBAL_NODE_MODULES="$(npm root -g)"',
    'if [ ! -e "$OPENCODE_TOOLS_ROOT/node_modules" ] && [ -d "$GLOBAL_NODE_MODULES" ]; then ln -s "$GLOBAL_NODE_MODULES" "$OPENCODE_TOOLS_ROOT/node_modules"; fi',
    'if [ ! -d "$OPENCODE_TOOLS_ROOT/node_modules/zod" ]; then echo "Global zod dependency is missing from the Daytona browser snapshot." >&2; exit 1; fi',
    'if [ ! -d "$OPENCODE_TOOLS_ROOT/node_modules/@opencode-ai/plugin" ]; then echo "Global @opencode-ai/plugin dependency is missing from the Daytona browser snapshot." >&2; exit 1; fi',
  ].join("\n");
