import "@tanstack/react-start/server-only";
import { ResultAsync } from "neverthrow";

import { Github } from "@/lib/github";

export type DetectedRepoSkillEntry = {
  detectedFrom: "repo_directory" | "skills_lock";
  installSpec: string | null;
  name: string;
  source: string;
  url: string;
};

const REPO_SKILLS_DIRECTORY = ".agents/skills";
const SKILLS_LOCK_PATH = "skills-lock.json";

const buildRepoSkillUrl = (
  repoHtmlUrl: string | null,
  defaultBranch: string | null,
  name: string,
) => {
  if (!repoHtmlUrl || !defaultBranch) {
    return "";
  }

  return `${repoHtmlUrl}/tree/${encodeURIComponent(defaultBranch)}/.agents/skills/${encodeURIComponent(name)}`;
};

const parseSkillsLock = (raw: string | null) => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const candidateSkills = Reflect.get(parsed, "skills");

    if (!candidateSkills || typeof candidateSkills !== "object" || Array.isArray(candidateSkills)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(candidateSkills).flatMap(([name, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return [];
        }

        const source = Reflect.get(value, "source");
        const sourceType = Reflect.get(value, "sourceType");

        return [
          [
            name,
            {
              source: typeof source === "string" ? source : undefined,
              sourceType: typeof sourceType === "string" ? sourceType : undefined,
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
};

const buildDetectedSkill = ({
  defaultBranch,
  lockEntry,
  name,
  repoHtmlUrl,
}: {
  defaultBranch: string | null;
  lockEntry?: { source?: string; sourceType?: string };
  name: string;
  repoHtmlUrl: string | null;
}): DetectedRepoSkillEntry => {
  const trimmedName = name.trim();
  const repoUrl = buildRepoSkillUrl(repoHtmlUrl, defaultBranch, trimmedName);
  const source = lockEntry?.source?.trim() || "Repository";
  const isGithubSkill = lockEntry?.sourceType === "github" && Boolean(lockEntry.source?.trim());

  return {
    detectedFrom: lockEntry ? "skills_lock" : "repo_directory",
    installSpec:
      isGithubSkill && lockEntry?.source ? `${lockEntry.source.trim()}@${trimmedName}` : null,
    name: trimmedName,
    source,
    url:
      isGithubSkill && lockEntry?.source
        ? `https://github.com/${lockEntry.source.trim()}`
        : repoUrl,
  };
};

export const detectRepoSkills = (input: {
  defaultBranch: string | null;
  repoHtmlUrl: string | null;
  repoId: string;
  userId: string;
}): ResultAsync<DetectedRepoSkillEntry[], Error> =>
  ResultAsync.combine([
    Github.getRepoFileContentForUser({
      path: SKILLS_LOCK_PATH,
      repoId: input.repoId,
      userId: input.userId,
    }),
    Github.listRepoDirectoryNamesForUser({
      path: REPO_SKILLS_DIRECTORY,
      repoId: input.repoId,
      userId: input.userId,
    }),
  ]).map(([skillsLockRaw, repoSkillDirectoryNames]) => {
    const lockSkills = parseSkillsLock(skillsLockRaw);
    const knownNames = new Set<string>();
    const detectedSkills: DetectedRepoSkillEntry[] = [];

    for (const [name, lockEntry] of Object.entries(lockSkills)) {
      const trimmedName = name.trim();

      if (!trimmedName || knownNames.has(trimmedName)) {
        continue;
      }

      knownNames.add(trimmedName);
      detectedSkills.push(
        buildDetectedSkill({
          defaultBranch: input.defaultBranch,
          lockEntry,
          name: trimmedName,
          repoHtmlUrl: input.repoHtmlUrl,
        }),
      );
    }

    for (const name of repoSkillDirectoryNames ?? []) {
      const trimmedName = name.trim();

      if (!trimmedName || knownNames.has(trimmedName)) {
        continue;
      }

      knownNames.add(trimmedName);
      detectedSkills.push(
        buildDetectedSkill({
          defaultBranch: input.defaultBranch,
          name: trimmedName,
          repoHtmlUrl: input.repoHtmlUrl,
        }),
      );
    }

    return detectedSkills.sort((left, right) => left.name.localeCompare(right.name));
  });
