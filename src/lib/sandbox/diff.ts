import "@tanstack/react-start/server-only";
import { Log } from "@/lib/log";
import type { Sandbox } from "@/lib/sandbox";
import { MAX_DIFF_PATCH_BYTES, parseUnifiedDiff } from "@/lib/task-diff";

const log = Log.create({ ns: "sandbox.diff" });

const DIFF_OUTPUT_PATH = ".diabolo/diff/workspace.patch";
const UNTRACKED_LIST_PATH = ".diabolo/diff/untracked.list";

// The env file is written by the platform and carries project secrets, so it
// never belongs in a diff the user is shown. The two directories are the
// platform's own scratch space, normally already git-excluded in the sandbox.
const DIFF_PATHSPEC = `. ':(exclude).env' ':(exclude).diabolo' ':(exclude).opencode'`;

type Run = (
  sandbox: Sandbox.Session,
  taskId: string,
  messageId: string,
  command: string,
  cwd?: string,
  envVars?: Record<string, string>,
  timeout?: number,
  label?: string,
) => Promise<{ exitCode: number; output: string }>;

type DiffContext = {
  messageId: string;
  run: Run;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  taskId: string;
};

/**
 * The commit the workspace sits on before the agent touches it. Diffing against
 * this is what makes the result "what this run changed" rather than "how this
 * branch differs from main".
 */
export const readWorkspaceBaseCommit = async (context: DiffContext) => {
  try {
    const result = await context.run(
      context.sandbox,
      context.taskId,
      context.messageId,
      "git rev-parse HEAD",
      context.sandboxPath,
      undefined,
      30,
      "read base commit",
    );

    return result.output.trim().split("\n").at(-1)?.trim() || null;
  } catch (error) {
    log.warn("failed to read workspace base commit", { error, taskId: context.taskId });
    return null;
  }
};

/**
 * Everything the run changed relative to `baseCommit`: commits it made plus
 * whatever it left uncommitted, untracked files included.
 *
 * The patch is written to a file and downloaded rather than read from command
 * output, so a large diff never floods the task's log stream.
 */
export const captureWorkspaceDiff = async (context: DiffContext & { baseCommit: string }) => {
  const command = [
    "mkdir -p .diabolo/diff",
    // `git diff` ignores untracked files, so they are recorded as intent-to-add
    // for the length of this command and reset straight after. Intent-to-add
    // stages no content, and resetting exactly the files that were untracked
    // leaves anything the agent staged itself untouched.
    `git ls-files -z --others --exclude-standard -- ${DIFF_PATHSPEC} > ${UNTRACKED_LIST_PATH} 2>/dev/null || true`,
    `xargs -0 -r git add -N -- < ${UNTRACKED_LIST_PATH} >/dev/null 2>&1 || true`,
    `git diff --no-color --no-ext-diff --find-renames ${context.baseCommit} -- ${DIFF_PATHSPEC} 2>/dev/null | head -c ${MAX_DIFF_PATCH_BYTES} > ${DIFF_OUTPUT_PATH} || true`,
    `xargs -0 -r git reset -q -- < ${UNTRACKED_LIST_PATH} >/dev/null 2>&1 || true`,
  ].join("\n");

  await context.run(
    context.sandbox,
    context.taskId,
    context.messageId,
    command,
    context.sandboxPath,
    undefined,
    120,
    "capture workspace diff",
  );

  const content = await context.sandbox.downloadFile(
    `${context.sandboxPath.replace(/\/$/, "")}/${DIFF_OUTPUT_PATH}`,
    180,
  );

  return parseUnifiedDiff(content.toString("utf8"));
};
