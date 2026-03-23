import { type ResultAsync } from "neverthrow";

import { Github } from "@/lib/github";
import { Log } from "@/lib/log";
import { buildOpenCodeConfigContent, ensureOpenCodeConfig } from "@/lib/opencode/config";
import { didGitMetadataGenerationTimeout, generateGitMetadata } from "@/lib/opencode/git-metadata";
import { Sandbox } from "@/lib/sandbox";
import { buildOpenCodePrompt, buildOpenCodeRunCommand } from "@/lib/sandbox/opencode";
import {
  appendAgentMessage,
  appendFollowUpAgentMessage,
  appendFollowUpLog,
  appendJobLog,
  jobs,
  requireJob,
  updateFollowUp,
  updateJob,
} from "@/lib/sandbox/state";
import { SandboxWorkspace } from "@/lib/sandbox/workspace";

const log = Log.create({ ns: "sandbox.run" });

const read = (value: string) => value.trim();
const escape = (value: string) => value.replace(/'/g, `'\\''`);

const run = async (
  sandbox: Sandbox.Session,
  jobId: string,
  command: string,
  cwd?: string,
  envVars?: Record<string, string>,
  timeout = 0,
  options?: {
    followUpId?: string;
  },
) => {
  const response = await sandbox.executeCommand(command, {
    cwd,
    envVars,
    timeoutSeconds: timeout,
  });

  if (response.output) {
    if (options?.followUpId) appendFollowUpLog(jobId, options.followUpId, `${response.output}\n`);
    else appendJobLog(jobId, `${response.output}\n`);
  }

  if (response.exitCode !== 0) {
    throw new Error(read(response.output) || `Command failed with exit code ${response.exitCode}.`);
  }

  return response;
};

const parse = (jobId: string, output: string, followUpId?: string) => {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed);

      if (event.type !== "text" || !event.part?.text) continue;

      if (followUpId) {
        appendFollowUpAgentMessage(
          jobId,
          followUpId,
          event.part.text,
          event.timestamp ?? Date.now(),
        );
        continue;
      }

      appendAgentMessage(jobId, event.part.text, event.timestamp ?? Date.now());
    } catch {}
  }
};

const unwrapResult = async <T>(result: ResultAsync<T, Error>): Promise<T> => {
  const res = await result;
  if (res.isErr()) throw res.error;
  return res.value;
};

export namespace SandboxRun {
  export const destroy = async (
    jobId: string,
    provider: Sandbox.Provider,
    stage?: string,
    userId?: string,
  ) => SandboxWorkspace.destroy(provider, requireJob(jobId, userId), updateJob, { stage });

  export const task = async (
    jobId: string,
    input: Sandbox.TaskInput,
    provider: Sandbox.Provider,
    setupTools?: string,
  ) => {
    const op = log.child({ jobId });

    try {
      const [repo, githubAccessToken, viewer, authenticatedRemoteUrl] = await Promise.all([
        unwrapResult<Github.Repo | null>(Github.getRepo(input.repoId)),
        unwrapResult<string>(Github.getAccessToken()),
        unwrapResult<{ email: string; login: string; name: string }>(Github.getViewer()),
        unwrapResult<string>(Github.getAuthenticatedRemoteUrl(input.repoId)),
      ]);
      const openCode = ensureOpenCodeConfig();

      if (!repo) {
        throw new Error("Unknown repository selection.");
      }

      op.info("task running", { repo: repo.fullName });

      updateJob(jobId, {
        repoName: repo.fullName,
        repoUrl: repo.htmlUrl,
        status: "running",
      });

      const sourceBranch =
        jobs.get(jobId)?.sourceBranch || input.sourceBranch.trim() || repo.defaultBranch;
      const enableStagehandTools = Sandbox.isFrontendTaskPrompt(input.prompt);
      const prepared = await SandboxWorkspace.prepare({
        authenticatedRemoteUrl,
        branch: sourceBranch,
        enableStagehandTools,
        githubAccessToken,
        jobId,
        provider,
        repoName: repo.name,
        repoOwnerLogin: repo.ownerLogin,
        repoUrl: repo.cloneUrl,
        run,
        setupTools: enableStagehandTools ? setupTools : undefined,
        update: updateJob,
        viewer,
      });

      updateJob(jobId, {
        stage: "Running OpenCode task",
      });

      const prompt = buildOpenCodePrompt(input.prompt, {
        enableStagehandTools,
        sandboxId: prepared.sandbox.id,
      });
      const response = await run(
        prepared.sandbox,
        jobId,
        buildOpenCodeRunCommand(openCode.model, prompt, {
          enableStagehandTools,
        }),
        prepared.sandboxPath,
        {
          OPENROUTER_API_KEY: openCode.apiKey,
          OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(openCode.model),
        },
        3600,
      );

      parse(jobId, response.output);

      updateJob(jobId, {
        stage: "Checking generated changes",
      });

      const changes = await run(
        prepared.sandbox,
        jobId,
        "git status --porcelain",
        prepared.sandboxPath,
        undefined,
        60,
      );

      if (!read(changes.output)) {
        throw new Error("OpenCode finished without producing repository changes.");
      }

      updateJob(jobId, {
        stage: "Collecting change summary",
      });

      const [diffSummary, changedFiles] = await Promise.all([
        run(
          prepared.sandbox,
          jobId,
          "git diff --stat --summary",
          prepared.sandboxPath,
          undefined,
          60,
        ),
        run(prepared.sandbox, jobId, "git status --short", prepared.sandboxPath, undefined, 60),
      ]);

      updateJob(jobId, {
        stage: "Generating branch, pull request, and comment metadata",
      });

      const started = Date.now();
      const metadata = await generateGitMetadata(
        {
          baseBranch: sourceBranch,
          changedFiles: changedFiles.output,
          diffSummary: diffSummary.output,
          repoFullName: repo.fullName,
          userPrompt: input.prompt,
        },
        openCode.apiKey,
        openCode.model,
      );

      if (didGitMetadataGenerationTimeout(started)) {
        appendJobLog(
          jobId,
          "Git metadata generation timed out; using fallback branch, commit, and PR metadata.\n",
        );
        op.warn("git metadata generation timed out");
      }

      updateJob(jobId, {
        branchName: metadata.branchName,
        stage: "Committing and pushing branch",
      });

      await run(
        prepared.sandbox,
        jobId,
        [
          `git checkout -b '${escape(metadata.branchName)}'`,
          "git add -A",
          `git -c core.hooksPath=/dev/null commit --no-verify -m '${escape(metadata.commitTitle)}'`,
          `GIT_TERMINAL_PROMPT=0 git push --porcelain -u origin '${escape(metadata.branchName)}'`,
        ].join("\n"),
        prepared.sandboxPath,
        undefined,
        900,
      );

      updateJob(jobId, {
        stage: "Opening pull request",
      });

      const pr = await unwrapResult<{ number: number; url: string }>(
        Github.createPullRequest({
          base: sourceBranch,
          body: metadata.prBody,
          head: metadata.branchName,
          repoId: input.repoId,
          title: metadata.prTitle,
        }),
      );

      if (metadata.prComment.trim()) {
        updateJob(jobId, {
          stage: "Posting pull request comment",
        });

        try {
          await unwrapResult<void>(
            Github.createPullRequestComment({
              body: metadata.prComment,
              prNumber: pr.number,
              repoId: input.repoId,
            }),
          );
        } catch (err) {
          appendJobLog(
            jobId,
            `Failed to post pull request comment: ${provider.formatError(err)}\n`,
          );
          op.warn("failed to post pr comment", { error: err });
        }
      }

      updateJob(jobId, {
        completedAt: new Date().toISOString(),
        prNumber: pr.number,
        prUrl: pr.url,
        stage: "Task completed",
        status: "succeeded",
      });

      op.info("task completed", { pr: pr.number });
    } catch (err) {
      updateJob(jobId, {
        completedAt: new Date().toISOString(),
        error: provider.formatError(err),
        stage: "Task failed",
        status: "failed",
      });
      op.error("task failed", { error: err });
    } finally {
      const current = jobs.get(jobId);

      if (current && current.status !== "failed" && current.status !== "succeeded") {
        updateJob(jobId, {
          completedAt: new Date().toISOString(),
          stage: "Task completed",
          status: "succeeded",
        });
      }

      if (input.quickTask) {
        const stage =
          jobs.get(jobId)?.status === "failed"
            ? "Quick task failed; sandbox destroyed"
            : "Quick task completed; sandbox destroyed";

        try {
          await SandboxWorkspace.destroy(provider, requireJob(jobId), updateJob, { stage });
        } catch (err) {
          appendJobLog(
            jobId,
            `Failed to destroy quick task sandbox: ${provider.formatError(err)}\n`,
          );
          op.warn("failed to destroy quick task sandbox", { error: err });
        }
      }
    }
  };

  export const followUp = async (
    jobId: string,
    prompt: string,
    provider: Sandbox.Provider,
    setupTools?: string,
    userId?: string,
  ) => {
    const op = log.child({ jobId });
    const openCode = ensureOpenCodeConfig();
    const followUpId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const trimmedPrompt = prompt.trim();
    const enableStagehandTools = Sandbox.isFrontendTaskPrompt(trimmedPrompt);
    const job = requireJob(jobId, userId);

    op.info("follow-up started", { followUpId });

    updateJob(jobId, {
      completedAt: undefined,
      error: undefined,
      followUpHistory: [
        ...job.followUpHistory,
        {
          id: followUpId,
          prompt: trimmedPrompt,
          responseMessages: [],
          stage: "Running follow-up task",
          startedAt,
          status: "running",
        },
      ],
      stage: "Running follow-up task",
      status: "running",
    });

    try {
      const [viewer, githubAccessToken, repo, authenticatedRemoteUrl] = await Promise.all([
        unwrapResult<{ email: string; login: string; name: string }>(Github.getViewer()),
        unwrapResult<string>(Github.getAccessToken()),
        unwrapResult<Github.Repo | null>(Github.getRepo(job.repoId)),
        unwrapResult<string>(Github.getAuthenticatedRemoteUrl(job.repoId)),
      ]);

      if (!repo) {
        throw new Error("Unknown repository selection.");
      }

      const prepared = await SandboxWorkspace.getOrCreateFollowUp({
        authenticatedRemoteUrl,
        enableStagehandTools,
        followUpId,
        githubAccessToken,
        job,
        provider,
        repo,
        run,
        setupTools: enableStagehandTools ? setupTools : undefined,
        update: updateJob,
        updateFollowUp,
        viewer,
      });

      if (!prepared.sandboxPath) {
        throw new Error("No sandbox workspace available for follow-up.");
      }

      if (enableStagehandTools && setupTools) {
        updateJob(jobId, {
          stage: "Preparing Stagehand tools",
        });
        updateFollowUp(jobId, followUpId, (entry) => ({
          ...entry,
          stage: "Preparing Stagehand tools",
        }));

        await run(prepared.sandbox, jobId, setupTools, prepared.sandboxPath, undefined, 900, {
          followUpId,
        });
      }

      updateJob(jobId, {
        stage: "Running follow-up task",
      });
      updateFollowUp(jobId, followUpId, (entry) => ({
        ...entry,
        stage: "Running follow-up task",
      }));

      const followUpPrompt = buildOpenCodePrompt(prompt, {
        enableStagehandTools,
        sandboxId: prepared.sandbox.id,
      });
      const response = await run(
        prepared.sandbox,
        jobId,
        buildOpenCodeRunCommand(openCode.model, followUpPrompt, {
          enableStagehandTools,
        }),
        prepared.sandboxPath,
        {
          OPENROUTER_API_KEY: openCode.apiKey,
          OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(openCode.model),
        },
        3600,
        { followUpId },
      );

      parse(jobId, response.output, followUpId);

      updateJob(jobId, {
        completedAt: new Date().toISOString(),
        stage: "Follow-up completed",
        status: "succeeded",
      });
      updateFollowUp(jobId, followUpId, (entry) => ({
        ...entry,
        completedAt: new Date().toISOString(),
        stage: "Follow-up completed",
        status: "succeeded",
      }));

      op.info("follow-up completed", { followUpId });
    } catch (err) {
      updateJob(jobId, {
        completedAt: new Date().toISOString(),
        error: provider.formatError(err),
        stage: "Follow-up failed",
        status: "failed",
      });
      updateFollowUp(jobId, followUpId, (entry) => ({
        ...entry,
        completedAt: new Date().toISOString(),
        error: provider.formatError(err),
        stage: "Follow-up failed",
        status: "failed",
      }));

      op.error("follow-up failed", { followUpId, error: err });
    }
  };
}
