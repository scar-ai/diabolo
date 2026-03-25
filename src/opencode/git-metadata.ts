import "@tanstack/react-start/server-only";
import { OpenCode } from "@/opencode";

const GIT_METADATA_TIMEOUT_MS = 20_000;

export type GitMetadataContext = {
  baseBranch: string;
  changedFiles: string;
  diffSummary: string;
  repoFullName: string;
  userPrompt: string;
};

export type GeneratedGitMetadata = {
  branchName: string;
  commitTitle: string;
  prBody: string;
  prComment: string;
  prTitle: string;
};

const sanitizeNamePart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "repo";

const makeFallbackTitle = (prompt: string) =>
  prompt
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 72) || "Apply requested changes";

const makeFallbackBranchName = (prompt: string) =>
  `diabolo/${sanitizeNamePart(makeFallbackTitle(prompt))}-${Date.now().toString(36)}`;

const makeFallbackPrBody = (prompt: string) =>
  ["Summary", "- Applies the requested repository changes.", "", "Context", prompt.trim()].join(
    "\n",
  );

const makeFallbackPrComment = (prompt: string) =>
  ["Implemented the requested changes for this PR.", "", "Request context", prompt.trim()].join(
    "\n",
  );

const getFallbackMetadata = (userPrompt: string): GeneratedGitMetadata => ({
  branchName: makeFallbackBranchName(userPrompt),
  commitTitle: makeFallbackTitle(userPrompt),
  prBody: makeFallbackPrBody(userPrompt),
  prComment: makeFallbackPrComment(userPrompt),
  prTitle: makeFallbackTitle(userPrompt),
});

const tryParseJsonObject = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch {}

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(normalized.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const sanitizeGeneratedBranchName = (value: string, userPrompt: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/-]+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^-+|-+$/g, "")
    .replace(/\/-+|-+\//g, "/")
    .slice(0, 80);

  return normalized || makeFallbackBranchName(userPrompt);
};

export namespace OpenCodeGitMetadata {
  export const didTimeout = (startedAt: number) =>
    Date.now() - startedAt >= GIT_METADATA_TIMEOUT_MS;

  export const generate = async (
    context: GitMetadataContext,
    apiKey: string,
    model: string,
  ): Promise<GeneratedGitMetadata> => {
    const fallback = getFallbackMetadata(context.userPrompt);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GIT_METADATA_TIMEOUT_MS);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: [
                "You generate Git metadata for an automated coding task.",
                "Return strict JSON only.",
                "The JSON must include string fields: branchName, commitTitle, prTitle, prBody, prComment.",
                "branchName must be lowercase and use only letters, numbers, slashes, and hyphens.",
                "commitTitle must be a concise imperative git commit title under 72 characters.",
                "prTitle must be concise and descriptive under 80 characters.",
                "prBody must be valid markdown with a short summary and key changes.",
                "prComment must be a custom PR thread comment in markdown, concise and specific to the request.",
                "Do not mention that you are an AI or include code fences.",
              ].join(" "),
            },
            {
              role: "user",
              content: [
                `Repository: ${context.repoFullName}`,
                `Base branch: ${context.baseBranch}`,
                "",
                "User request:",
                context.userPrompt.trim(),
                "",
                "Diff summary:",
                context.diffSummary.trim() || "No diff summary available.",
                "",
                "Changed files:",
                context.changedFiles.trim() || "No changed files listed.",
              ].join("\n"),
            },
          ],
          model: OpenCode.getProviderScopedModelId(model),
          temperature: 0.4,
        }),
      });

      if (!response.ok) {
        return fallback;
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };
      const content = data.choices?.[0]?.message?.content;
      const parsed = content ? tryParseJsonObject(content) : null;

      if (!parsed) {
        return fallback;
      }

      return {
        branchName:
          typeof parsed.branchName === "string"
            ? sanitizeGeneratedBranchName(parsed.branchName, context.userPrompt)
            : fallback.branchName,
        commitTitle:
          typeof parsed.commitTitle === "string" && parsed.commitTitle.trim()
            ? parsed.commitTitle.trim().slice(0, 72)
            : fallback.commitTitle,
        prBody:
          typeof parsed.prBody === "string" && parsed.prBody.trim()
            ? parsed.prBody.trim()
            : fallback.prBody,
        prComment:
          typeof parsed.prComment === "string" && parsed.prComment.trim()
            ? parsed.prComment.trim()
            : fallback.prComment,
        prTitle:
          typeof parsed.prTitle === "string" && parsed.prTitle.trim()
            ? parsed.prTitle.trim().slice(0, 80)
            : fallback.prTitle,
      };
    } catch {
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  };
}
