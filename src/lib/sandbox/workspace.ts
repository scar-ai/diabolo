import { Buffer } from "node:buffer";

import type { Github } from "@/lib/github";
import { Log } from "@/lib/log";
import { buildReportProgressOpenCodeSetupCommand } from "@/lib/opencode/spawn-task";
import { formatProjectEnvVarsForDotEnv } from "@/lib/project/env";
import type { ProjectSkillEntry } from "@/lib/project/skills";
import type { Sandbox } from "@/lib/sandbox";
import { SandboxRuntimeState } from "@/lib/sandbox/runtime-state";
import type { TaskRecord } from "@/lib/sandbox/store";
import { findTaskRecord, updateTaskRecord } from "@/lib/sandbox/store";
import { normalizeSandboxTierId } from "@/lib/sandbox/tiers";

import { opencodeInstallCommand } from "./opencode";

type Viewer = {
  email: string;
  login: string;
  name: string;
};

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

const log = Log.create({ ns: "sandbox.workspace" });

const updateStage = async (
  taskId: string,
  messageId: string,
  stage: string,
  status: "queued" | "running" = "running",
) =>
  SandboxRuntimeState.setTaskStage({
    messageId,
    stage,
    status,
    taskId,
  });

const PROJECT_ENV_START_MARKER = "# >>> diabolo project env >>>";
const PROJECT_ENV_END_MARKER = "# <<< diabolo project env <<<";
const PROJECT_SKILLS_MANIFEST_PATH = ".diabolo/project-skills.json";

const escapeForSingleQuotedShell = (value: string) => value.replace(/'/g, `'\\''`);

export const buildSandboxGitExcludeCommand = () =>
  [
    "node - <<'JS'",
    "const fs = require('fs');",
    "const path = require('path');",
    "const excludePath = path.join('.git', 'info', 'exclude');",
    "const entries = ['.diabolo/', '.opencode/'];",
    "const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';",
    "const lines = new Set(existing.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean));",
    "for (const entry of entries) lines.add(entry);",
    "fs.mkdirSync(path.dirname(excludePath), { recursive: true });",
    "fs.writeFileSync(excludePath, Array.from(lines).join('\\n') + '\\n');",
    "JS",
  ].join("\n");

const buildProjectEnvSyncCommand = (envVars?: Record<string, string>) => {
  const projectEnvBlock = envVars ? formatProjectEnvVarsForDotEnv(envVars) : "";
  const block = projectEnvBlock
    ? `${PROJECT_ENV_START_MARKER}\n${projectEnvBlock}\n${PROJECT_ENV_END_MARKER}\n`
    : "";
  const blockB64 = Buffer.from(block, "utf8").toString("base64");

  return [
    `export DIABOLO_PROJECT_ENV_BLOCK_B64='${escapeForSingleQuotedShell(blockB64)}'`,
    "node - <<'JS'",
    "const fs = require('fs');",
    `const startMarker = ${JSON.stringify(PROJECT_ENV_START_MARKER)};`,
    `const endMarker = ${JSON.stringify(PROJECT_ENV_END_MARKER)};`,
    "const envPath = '.env';",
    "const block = Buffer.from(process.env.DIABOLO_PROJECT_ENV_BLOCK_B64 || '', 'base64').toString('utf8');",
    "let existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';",
    "const start = existing.indexOf(startMarker);",
    "const end = existing.indexOf(endMarker);",
    "if (start !== -1 && end !== -1 && end >= start) {",
    "  existing = existing.slice(0, start).replace(/[\\r\\n]+$/, '');",
    "}",
    "if (block) {",
    "  existing = existing.replace(/[\\r\\n]+$/, '');",
    "  fs.writeFileSync(envPath, existing ? existing + '\\n\\n' + block : block);",
    "} else if (existing) {",
    "  fs.writeFileSync(envPath, existing.replace(/[\\r\\n]+$/, '') + '\\n');",
    "} else if (fs.existsSync(envPath)) {",
    "  fs.unlinkSync(envPath);",
    "}",
    "JS",
  ].join("\n");
};

const syncProjectEnvFile = async (input: {
  envVars?: Record<string, string>;
  messageId: string;
  run: Run;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  taskId: string;
}) =>
  input.run(
    input.sandbox,
    input.taskId,
    input.messageId,
    buildProjectEnvSyncCommand(input.envVars),
    input.sandboxPath,
    undefined,
    120,
    "sync project env",
  );

const buildProjectSkillsSyncCommand = (skills: ProjectSkillEntry[]) => {
  const skillsB64 = Buffer.from(JSON.stringify(skills), "utf8").toString("base64");

  return [
    `export DIABOLO_PROJECT_SKILLS_B64='${escapeForSingleQuotedShell(skillsB64)}'`,
    "node - <<'JS'",
    "const fs = require('fs');",
    "const path = require('path');",
    "const { spawnSync } = require('child_process');",
    `const manifestPath = ${JSON.stringify(PROJECT_SKILLS_MANIFEST_PATH)};`,
    "const skillsRoot = path.join('.agents', 'skills');",
    "const raw = Buffer.from(process.env.DIABOLO_PROJECT_SKILLS_B64 || '', 'base64').toString('utf8');",
    "const payload = raw ? JSON.parse(raw) : [];",
    "let previous = [];",
    "if (fs.existsSync(manifestPath)) {",
    "  try {",
    "    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));",
    "    previous = Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];",
    "  } catch {}",
    "}",
    "fs.mkdirSync(path.dirname(manifestPath), { recursive: true });",
    "fs.mkdirSync(skillsRoot, { recursive: true });",
    "for (const skillName of previous) {",
    "  fs.rmSync(path.join(skillsRoot, skillName), { force: true, recursive: true });",
    "}",
    "for (const skill of payload) {",
    "  if (!skill || typeof skill !== 'object' || Array.isArray(skill)) continue;",
    "  if (typeof skill.installSpec !== 'string' || !skill.installSpec.trim()) continue;",
    "  const result = spawnSync(",
    "    'pnpm',",
    "    ['dlx', 'skills@latest', 'add', skill.installSpec, '-a', 'opencode', '-y'],",
    "    { cwd: process.cwd(), encoding: 'utf8', env: process.env },",
    "  );",
    "  if (result.stdout) process.stdout.write(result.stdout);",
    "  if (result.stderr) process.stderr.write(result.stderr);",
    "  if (result.status !== 0) process.exit(result.status ?? 1);",
    "}",
    "const installed = payload",
    "  .map((skill) => (skill && typeof skill.name === 'string' ? skill.name.trim() : ''))",
    "  .filter(Boolean);",
    "fs.writeFileSync(manifestPath, JSON.stringify(installed, null, 2) + '\\n');",
    "JS",
  ].join("\n");
};

const syncProjectSkills = async (input: {
  messageId: string;
  run: Run;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  skills: ProjectSkillEntry[];
  taskId: string;
}) =>
  input.run(
    input.sandbox,
    input.taskId,
    input.messageId,
    buildProjectSkillsSyncCommand(input.skills),
    input.sandboxPath,
    undefined,
    1800,
    "sync project skills",
  );

export namespace SandboxWorkspace {
  export const destroy = async (
    provider: Sandbox.Provider,
    taskId: string,
    opts?: {
      stage?: string;
    },
  ) => {
    const taskRecord = await findTaskRecord(taskId);

    if (!taskRecord?.sandboxId) {
      return;
    }

    try {
      await provider.destroyWorkspace(taskRecord.sandboxId);
    } catch {}

    await SandboxRuntimeState.setSandboxStatus(taskId, "stopped", {
      sandboxPath: null,
      sandboxId: null,
      sandboxName: null,
      stage: opts?.stage ?? "Sandbox stopped",
    });
  };

  export const prepare = async (input: {
    authenticatedRemoteUrl: string;
    branch: string;
    envVars?: Record<string, string>;
    githubAccessToken: string;
    messageId: string;
    provider: Sandbox.Provider;
    repoName: string;
    repoOwnerLogin: string;
    repoUrl: string;
    run: Run;
    skills: ProjectSkillEntry[];
    taskId: string;
    tierId?: string | null;
    viewer: Viewer;
  }) => {
    const op = log.child({ taskId: input.taskId });
    const prepareStartedAt = Date.now();

    try {
      await updateStage(input.taskId, input.messageId, "Creating sandbox");
      await SandboxRuntimeState.setSandboxStatus(input.taskId, "spawning");

      const createWorkspaceStartedAt = Date.now();
      const tierId = normalizeSandboxTierId(input.tierId);
      const sandbox = await input.provider.createWorkspace(input.repoName, { tierId });
      op.info("sandbox workspace created", {
        durationMs: Date.now() - createWorkspaceStartedAt,
        sandboxId: sandbox.id,
        sandboxName: sandbox.name,
        tierId,
      });

      await SandboxRuntimeState.setSandboxStatus(input.taskId, "ready", {
        sandboxId: sandbox.id,
        sandboxName: sandbox.name,
        stage: "Resolving sandbox workspace",
        status: "running",
      });

      await updateStage(input.taskId, input.messageId, "Resolving sandbox workspace");

      const resolveWorkspaceStartedAt = Date.now();
      const root = await sandbox.getWorkspaceRoot();
      const sandboxPath = `${root.replace(/\/$/, "")}/${input.repoName}`;
      op.info("sandbox workspace resolved", {
        durationMs: Date.now() - resolveWorkspaceStartedAt,
        sandboxId: sandbox.id,
        sandboxPath,
      });

      await updateTaskRecord(input.taskId, { sandboxPath });
      await updateStage(input.taskId, input.messageId, "Cloning repository into sandbox");

      const cloneStartedAt = Date.now();
      await sandbox.cloneRepository({
        accessToken: input.githubAccessToken,
        branch: input.branch,
        ownerLogin: input.repoOwnerLogin,
        targetPath: sandboxPath,
        url: input.repoUrl,
      });
      op.info("repository cloned into sandbox", {
        branch: input.branch,
        durationMs: Date.now() - cloneStartedAt,
        sandboxId: sandbox.id,
      });

      const setup = [
        `git remote set-url origin '${input.authenticatedRemoteUrl.replace(/'/g, `'\\''`)}'`,
        `git config user.name '${input.viewer.name.replace(/'/g, `'\\''`)}'`,
        `git config user.email '${input.viewer.email.replace(/'/g, `'\\''`)}'`,
        buildSandboxGitExcludeCommand(),
        opencodeInstallCommand,
      ];

      await SandboxRuntimeState.setSandboxStatus(input.taskId, "running", {
        sandboxPath,
        stage: "Preparing git branch and agent runtime",
      });

      await updateStage(input.taskId, input.messageId, "Preparing git branch and agent runtime");

      await input.run(
        sandbox,
        input.taskId,
        input.messageId,
        setup.join("\n"),
        sandboxPath,
        input.envVars,
        900,
        "bootstrap sandbox runtime",
      );
      op.info("sandbox bootstrap completed", {
        sandboxId: sandbox.id,
      });

      await updateStage(input.taskId, input.messageId, "Syncing project configuration");

      await syncProjectEnvFile({
        envVars: input.envVars,
        messageId: input.messageId,
        run: input.run,
        sandbox,
        sandboxPath,
        taskId: input.taskId,
      });

      await syncProjectSkills({
        messageId: input.messageId,
        run: input.run,
        sandbox,
        sandboxPath,
        skills: input.skills,
        taskId: input.taskId,
      });

      op.info("sandbox prepared", {
        durationMs: Date.now() - prepareStartedAt,
        sandboxId: sandbox.id,
        sandboxPath,
        skillCount: input.skills.length,
      });

      return {
        reused: false,
        sandbox,
        sandboxPath,
      };
    } catch (error) {
      op.error("sandbox prepare failed", {
        durationMs: Date.now() - prepareStartedAt,
        error,
      });
      await SandboxRuntimeState.markSpawnFailure(
        input.taskId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };

  export const getOrCreateFollowUp = async (input: {
    authenticatedRemoteUrl: string;
    githubAccessToken: string;
    messageId: string;
    provider: Sandbox.Provider;
    repo: Github.Repo;
    run: Run;
    taskId: string;
    taskRecord: TaskRecord;
    envVars?: Record<string, string>;
    skills: ProjectSkillEntry[];
    viewer: Viewer;
  }) => {
    if (input.taskRecord.sandboxId && input.taskRecord.sandboxPath) {
      const op = log.child({
        sandboxId: input.taskRecord.sandboxId,
        taskId: input.taskId,
      });

      try {
        const reconnectStartedAt = Date.now();
        const sandbox = await input.provider.getWorkspace(input.taskRecord.sandboxId);
        op.info("reused existing sandbox", {
          durationMs: Date.now() - reconnectStartedAt,
          sandboxPath: input.taskRecord.sandboxPath,
        });

        await input.run(
          sandbox,
          input.taskId,
          input.messageId,
          buildReportProgressOpenCodeSetupCommand(),
          input.taskRecord.sandboxPath,
          undefined,
          60,
          "sync progress reporting tool",
        );

        await syncProjectEnvFile({
          envVars: input.envVars,
          messageId: input.messageId,
          run: input.run,
          sandbox,
          sandboxPath: input.taskRecord.sandboxPath,
          taskId: input.taskId,
        });

        await syncProjectSkills({
          messageId: input.messageId,
          run: input.run,
          sandbox,
          sandboxPath: input.taskRecord.sandboxPath,
          skills: input.skills,
          taskId: input.taskId,
        });

        return {
          reused: true,
          sandbox,
          sandboxPath: input.taskRecord.sandboxPath,
        };
      } catch (error) {
        op.warn("existing sandbox reuse failed; recreating", {
          error,
          sandboxPath: input.taskRecord.sandboxPath,
        });
      }
    }

    await updateStage(input.taskId, input.messageId, "Recreating sandbox for follow-up");

    return prepare({
      authenticatedRemoteUrl: input.authenticatedRemoteUrl,
      branch: input.taskRecord.branchName?.trim() || input.repo.defaultBranch,
      envVars: input.envVars,
      githubAccessToken: input.githubAccessToken,
      messageId: input.messageId,
      provider: input.provider,
      repoName: input.repo.name,
      repoOwnerLogin: input.repo.ownerLogin,
      repoUrl: input.repo.cloneUrl,
      run: input.run,
      skills: input.skills,
      taskId: input.taskId,
      tierId: input.taskRecord.sandboxTier,
      viewer: input.viewer,
    });
  };
}
