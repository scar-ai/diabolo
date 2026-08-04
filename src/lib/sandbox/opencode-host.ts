import { Buffer } from "node:buffer";

import {
  buildOpenCodeConfigContent,
  buildOpenCodeRuntimeFingerprint,
  type OpenCodeConfig,
} from "@/lib/opencode/config";
import type { RuntimeRunCompletedPayload } from "@/lib/opencode/protocol";
import { getRuntimeEventEndpoint, createRuntimeEventToken } from "@/lib/opencode/runtime-events";
import { Sandbox } from "@/lib/sandbox";
import {
  OPENCODE_SERVER_PORT,
  OPENCODE_USAGE_LOG_PATH,
  buildAbortPersistentOpenCodePromptCommand,
  buildEnsurePersistentOpenCodeServerCommand,
  buildPersistentOpenCodeRuntimeEnvironment,
  buildReadPersistentOpenCodeSessionMetadataCommand,
  buildRunPersistentOpenCodePromptCommand,
} from "@/lib/sandbox/opencode-runtime";

type RunSandboxCommand = (
  sandbox: Sandbox.Session,
  taskId: string,
  messageId: string,
  command: string,
  cwd?: string,
  envVars?: Record<string, string>,
  timeout?: number,
  label?: string,
) => Promise<{ exitCode: number; output: string }>;

/**
 * Background runs additionally surface the agent's result, which the host reads
 * off the event stream as the run happens rather than by parsing output later.
 */
type RunSandboxBackgroundCommand = (...args: Parameters<RunSandboxCommand>) => Promise<{
  exitCode: number;
  output: string;
  runResult: RuntimeRunCompletedPayload | null;
}>;

type OpenCodeReplayMessage = {
  messageId: string;
  text: string;
};

export type OpenCodeSessionMetadataResult = {
  sessionId?: string | null;
  success?: boolean;
  title?: string | null;
};

const buildOpenCodeUserPrompt = (
  userPrompt: string,
  options?: {
    attachments?: Array<{ fileName: string; mediaType: string; sandboxPath: string }>;
  },
) =>
  [
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
    "Progress updates:",
    "Before investigating, call the report-progress tool with one short sentence describing what you are about to do and why it matters.",
    "Call report-progress again whenever you move to a meaningfully different phase, such as understanding the code, implementing, or verifying.",
    "Keep each update under 180 characters, specific to the task, and suitable for the end user. Report intent and observable progress, never private reasoning or chain-of-thought.",
    "Do not send updates for every individual tool call.",
    "",
    "Sandbox workflow:",
    "Repository dependencies are not preinstalled after cloning. Before running a package script, check whether its dependencies are present and install them with the repository's package manager when needed.",
    "Keep temporary logs and generated artifacts inside the repository, preferably under .opencode/artifacts, so they remain accessible to tools and the task UI.",
    "When a task needs a long-running development server, launch it detached with its output redirected to an artifact log, then verify the process or listening port before opening it in the browser.",
    "",
    "User task:",
    userPrompt.trim(),
  ].join("\n");

const buildOpenCodePromptEnvironment = (input: {
  messageId: string;
  model: string;
  prompt: string;
  reasoningEffort?: string | null;
}) => ({
  OPENCODE_PROMPT_MESSAGE_ID: input.messageId,
  OPENCODE_PROMPT_MODEL: input.model,
  OPENCODE_PROMPT_REASONING_EFFORT: input.reasoningEffort?.trim() || "",
  OPENCODE_PROMPT_USER_B64: Buffer.from(input.prompt, "utf8").toString("base64"),
});

export const buildOpenCodeRuntimeEnvironment = (input: {
  apiKey: string;
  apiKeyEnvVar: string;
  authJson?: string;
  defaultBranch: string;
  githubToken: string;
  model: string;
  providerKind: "codex" | "manual";
  providerId: string;
  providerName: string;
  projectEnvVars?: Record<string, string>;
  reasoningEffort?: string | null;
  repoFullName: string;
  runtimeBaseUrl: string;
  sandboxId: string;
  sandboxPath: string;
  taskId: string;
  upstreamBaseUrl: string;
  userPrompt: string;
  viewer: { email: string; name: string };
  messageId: string;
  attachments?: Array<{ fileName: string; mediaType: string; sandboxPath: string }>;
  forceNewSession?: boolean;
  replayMessages?: OpenCodeReplayMessage[];
  sessionId?: string | null;
}) => ({
  [input.apiKeyEnvVar]: input.apiKey,
  OPENCODE_CONFIG_CONTENT_B64: Buffer.from(
    buildOpenCodeConfigContent({
      apiKey: input.apiKey,
      apiKeyEnvVar: input.apiKeyEnvVar,
      baseUrl: input.upstreamBaseUrl,
      model: input.model,
      providerId: input.providerId,
      providerKind: input.providerKind,
      providerName: input.providerName,
      runtimeBaseUrl: input.runtimeBaseUrl,
      selectedProviderId: input.providerId,
    }),
    "utf8",
  ).toString("base64"),
  OPENCODE_AUTH_JSON_B64: input.authJson
    ? Buffer.from(input.authJson, "utf8").toString("base64")
    : "",
  OPENCODE_GITHUB_DEFAULT_BRANCH: input.defaultBranch,
  OPENCODE_GITHUB_REPO_FULL_NAME: input.repoFullName,
  OPENCODE_GITHUB_TOKEN: input.githubToken,
  OPENCODE_GIT_AUTHOR_EMAIL: input.viewer.email,
  OPENCODE_GIT_AUTHOR_NAME: input.viewer.name,
  OPENCODE_RUNTIME_EVENT_ENDPOINT: getRuntimeEventEndpoint(),
  OPENCODE_RUNTIME_EVENT_TOKEN: createRuntimeEventToken(input.taskId),
  OPENCODE_RUNTIME_TASK_ID: input.taskId,
  OPENCODE_SERVER_PORT: String(OPENCODE_SERVER_PORT),
  OPENCODE_PROVIDER_KIND: input.providerKind,
  OPENCODE_REPO_PATH: input.sandboxPath,
  OPENCODE_FORCE_NEW_SESSION: input.forceNewSession ? "1" : "0",
  OPENCODE_SESSION_ID: input.sessionId?.trim() || "",
  OPENCODE_SESSION_REPLAY_B64: input.replayMessages?.length
    ? Buffer.from(JSON.stringify(input.replayMessages), "utf8").toString("base64")
    : "",
  ...buildOpenCodePromptEnvironment({
    messageId: input.messageId,
    model: input.model,
    prompt: buildOpenCodeUserPrompt(input.userPrompt, {
      attachments: input.attachments,
    }),
    reasoningEffort: input.reasoningEffort,
  }),
  ...(input.projectEnvVars ?? {}),
  ...Sandbox.getSpawnTaskEnvironment(input.taskId),
  ...buildPersistentOpenCodeRuntimeEnvironment(),
});

export const ensureOpenCodeServer = async (input: {
  environment: Record<string, string>;
  messageId: string;
  run: RunSandboxCommand;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  taskId: string;
}) =>
  input.run(
    input.sandbox,
    input.taskId,
    input.messageId,
    buildEnsurePersistentOpenCodeServerCommand(),
    input.sandboxPath,
    input.environment,
    120,
    "ensure opencode server",
  );

export const runOpenCodePrompt = async (input: {
  environment: Record<string, string>;
  messageId: string;
  runBackground: RunSandboxBackgroundCommand;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  taskId: string;
}) =>
  input.runBackground(
    input.sandbox,
    input.taskId,
    input.messageId,
    buildRunPersistentOpenCodePromptCommand(),
    input.sandboxPath,
    input.environment,
    3600,
    "opencode prompt",
  );

export const abortOpenCodePrompt = async (input: {
  environment?: Record<string, string>;
  messageId: string;
  run: RunSandboxCommand;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  taskId: string;
}) =>
  input.run(
    input.sandbox,
    input.taskId,
    input.messageId,
    buildAbortPersistentOpenCodePromptCommand(),
    input.sandboxPath,
    input.environment,
    30,
    "abort opencode prompt",
  );

export const readOpenCodeSessionMetadata = async (input: {
  environment: Record<string, string>;
  messageId: string;
  run: RunSandboxCommand;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  taskId: string;
}) =>
  input.run(
    input.sandbox,
    input.taskId,
    input.messageId,
    buildReadPersistentOpenCodeSessionMetadataCommand(),
    input.sandboxPath,
    input.environment,
    30,
    "read opencode session metadata",
  );

export const readOpenCodeUsageLog = async (input: {
  messageId: string;
  run: RunSandboxCommand;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  taskId: string;
}) =>
  input.run(
    input.sandbox,
    input.taskId,
    input.messageId,
    `if [ -f '${OPENCODE_USAGE_LOG_PATH}' ]; then cat '${OPENCODE_USAGE_LOG_PATH}'; fi`,
    input.sandboxPath,
    undefined,
    30,
    "read usage log",
  );

export const parseOpenCodeSessionMetadataResult = (output: string) =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as OpenCodeSessionMetadataResult];
      } catch {
        return [];
      }
    })
    .find((entry) => entry && entry.success === true) ?? null;

export const getOpenCodeRuntimeFingerprint = (config: OpenCodeConfig) =>
  buildOpenCodeRuntimeFingerprint(config);
