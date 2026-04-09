import "@tanstack/react-start/server-only";

const doubleQuoteForShell = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const writeFileCommand = (targetPath: string, content: string) =>
  [
    `mkdir -p "$(dirname ${doubleQuoteForShell(targetPath)})"`,
    `cat <<'EOF' > ${doubleQuoteForShell(targetPath)}`,
    content,
    "EOF",
  ].join("\n");

const GIT_TOOLS_PACKAGE_JSON = JSON.stringify(
  {
    name: "diabolo-opencode-git",
    private: true,
    type: "module",
    dependencies: {
      "@opencode-ai/plugin": "latest",
    },
  },
  null,
  2,
);

const GIT_TOOLS_CONTENT = String.raw`import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "@opencode-ai/plugin";

const execFileAsync = promisify(execFile);

const getRepoPath = (context) =>
  process.env.OPENCODE_REPO_PATH || context?.worktree || context?.directory || process.cwd();

const toErrorMessage = (error) => (error instanceof Error ? error.message : String(error));

const runGit = async (args, context, options = {}) => {
  const repoPath = getRepoPath(context);

  try {
    const result = await execFileAsync("git", args, {
      cwd: repoPath,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: options.timeoutMs ?? 30000,
    });

    return {
      output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
      repoPath,
    };
  } catch (error) {
    throw new Error("git " + args.join(" ") + " failed: " + toErrorMessage(error));
  }
};

const parseStatus = async (context) => {
  const [{ output: branchOutput }, { output: fileOutput }] = await Promise.all([
    runGit(["status", "--branch", "--short"], context),
    runGit(["status", "--short"], context),
  ]);

  const firstLine = branchOutput.split("\n")[0] || "";
  const branchMatch = firstLine.match(/^##\s+([^\s.]+)(?:\.\.\.([^\s]+))?(?:\s+\[(.+)\])?/);
  const currentBranch = branchMatch?.[1] ?? null;
  const upstream = branchMatch?.[2] ?? null;
  const counters = branchMatch?.[3] ?? "";
  const ahead = Number((counters.match(/ahead (\d+)/)?.[1] ?? "0"));
  const behind = Number((counters.match(/behind (\d+)/)?.[1] ?? "0"));

  return {
    ahead,
    behind,
    branchPublished: Boolean(upstream),
    currentBranch,
    fileStatus: fileOutput
      ? fileOutput.split("\n").filter(Boolean).map((line) => ({ raw: line }))
      : [],
  };
};

const getGithubRepo = () => {
  const fullName = process.env.OPENCODE_GITHUB_REPO_FULL_NAME;

  if (!fullName || !fullName.includes("/")) {
    throw new Error("GitHub repository context is not configured.");
  }

  const [owner, repo] = fullName.split("/", 2);

  return { owner, repo };
};

const getGithubHeaders = () => {
  const token = process.env.OPENCODE_GITHUB_TOKEN;

  if (!token) {
    throw new Error("GitHub token is not configured in this sandbox.");
  }

  return {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
};

export const git_status = tool({
  description:
    "Get the current git branch, ahead/behind counts, remote publication state, and file status for the current sandbox repository. Use this before deciding whether you still need to branch, commit, push, or open a PR.",
  args: {},
  async execute(args, context) {
    return JSON.stringify(await parseStatus(context), null, 2);
  },
});

export const git_stage = tool({
  description:
    "Stage files in the current sandbox repository. Use this before git_commit.",
  args: {
    files: tool.schema
      .array(tool.schema.string())
      .min(1)
      .describe("Files or directories to stage, like ['.'] or ['src/app.ts']."),
  },
  async execute(args, context) {
    await runGit(["add", ...args.files], context, { timeoutMs: 45000 });
    return JSON.stringify(
      {
        staged: args.files,
        ...(await parseStatus(context)),
      },
      null,
      2,
    );
  },
});

export const git_create_branch = tool({
  description:
    "Create a new branch in the current sandbox repository and switch to it. Use this when you made meaningful changes and need a handoff-ready result.",
  args: {
    name: tool.schema.string().min(1).describe("Name of the branch to create."),
  },
  async execute(args, context) {
    await runGit(["checkout", "-b", args.name], context, { timeoutMs: 45000 });
    return JSON.stringify(await parseStatus(context), null, 2);
  },
});

export const git_checkout_branch = tool({
  description: "Check out an existing branch in the current sandbox repository.",
  args: {
    name: tool.schema.string().min(1).describe("Name of the branch to check out."),
  },
  async execute(args, context) {
    await runGit(["checkout", args.name], context, { timeoutMs: 45000 });
    return JSON.stringify(await parseStatus(context), null, 2);
  },
});

export const git_delete_branch = tool({
  description: "Delete a branch in the current sandbox repository.",
  args: {
    name: tool.schema.string().min(1).describe("Name of the branch to delete."),
  },
  async execute(args, context) {
    await runGit(["branch", "-D", args.name], context, { timeoutMs: 45000 });
    return JSON.stringify(
      {
        deleted: args.name,
        ...(await parseStatus(context)),
      },
      null,
      2,
    );
  },
});

export const git_commit = tool({
  description:
    "Create a git commit from staged changes in the current sandbox repository. Use this after git_stage and before git_push.",
  args: {
    allowEmpty: tool.schema
      .boolean()
      .optional()
      .describe("Allow an empty commit if nothing is staged."),
    message: tool.schema.string().min(1).describe("Commit message."),
  },
  async execute(args, context) {
    const commitArgs = ["commit", "-m", args.message];

    if (args.allowEmpty ?? false) {
      commitArgs.push("--allow-empty");
    }

    const { output } = await runGit(commitArgs, context, { timeoutMs: 45000 });
    const { output: sha } = await runGit(["rev-parse", "HEAD"], context);

    return JSON.stringify(
      {
        message: args.message,
        output,
        sha: sha.trim(),
      },
      null,
      2,
    );
  },
});

export const git_push = tool({
  description:
    "Push the current branch to origin. Use this before git_create_pr when the task produced meaningful repository changes.",
  args: {},
  async execute(args, context) {
    await runGit(["push", "--porcelain", "-u", "origin", "HEAD"], context, {
      timeoutMs: 60000,
    });
    return JSON.stringify(await parseStatus(context), null, 2);
  },
});

export const git_pull = tool({
  description: "Pull the current branch from origin.",
  args: {},
  async execute(args, context) {
    await runGit(["pull", "--ff-only"], context, { timeoutMs: 60000 });
    return JSON.stringify(await parseStatus(context), null, 2);
  },
});

export const git_create_pr = tool({
  description:
    "Open a GitHub pull request for the current branch from the current task. Use this before finishing implementation work when you changed the repository in a meaningful way.",
  args: {
    base: tool.schema
      .string()
      .optional()
      .describe("Optional base branch. Defaults to the repository default branch."),
    body: tool.schema.string().min(1).describe("Pull request body in markdown."),
    title: tool.schema.string().min(1).describe("Pull request title."),
  },
  async execute(args, context) {
    const status = await parseStatus(context);
    const head = status.currentBranch;

    if (!head) {
      throw new Error("Create or check out a branch before opening a pull request.");
    }

    const { owner, repo } = getGithubRepo();
    const response = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/pulls", {
      method: "POST",
      headers: getGithubHeaders(),
      body: JSON.stringify({
        base: args.base || process.env.OPENCODE_GITHUB_DEFAULT_BRANCH || "main",
        body: args.body,
        head,
        title: args.title,
      }),
    });

    if (!response.ok) {
      throw new Error((await response.text()).trim() || "Failed to create pull request.");
    }

    const payload = await response.json();

    return JSON.stringify(
      {
        branchName: head,
        prNumber: payload.number,
        prUrl: payload.html_url,
        url: payload.html_url,
      },
      null,
      2,
    );
  },
});
`;

export const buildGitToolsOpenCodeSetupCommand = () =>
  [
    'OPENCODE_TOOLS_ROOT="${OPENCODE_TOOLS_ROOT:-$HOME/.config/opencode}"',
    'mkdir -p "$OPENCODE_TOOLS_ROOT/tools"',
    writeFileCommand("$OPENCODE_TOOLS_ROOT/package.json", GIT_TOOLS_PACKAGE_JSON),
    'GLOBAL_NODE_MODULES="$(npm root -g)"',
    'if [ ! -e "$OPENCODE_TOOLS_ROOT/node_modules" ] && [ -d "$GLOBAL_NODE_MODULES" ]; then ln -s "$GLOBAL_NODE_MODULES" "$OPENCODE_TOOLS_ROOT/node_modules"; fi',
    'if [ ! -d "$OPENCODE_TOOLS_ROOT/node_modules/@opencode-ai/plugin" ]; then echo "Global @opencode-ai/plugin dependency is missing from the Daytona browser snapshot." >&2; exit 1; fi',
    writeFileCommand("$OPENCODE_TOOLS_ROOT/tools/git.ts", GIT_TOOLS_CONTENT),
  ].join("\n");
