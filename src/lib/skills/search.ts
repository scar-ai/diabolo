import "@tanstack/react-start/server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProjectSkillEntry } from "@/lib/project/skills";

const execFileAsync = promisify(execFile);
const SEARCH_RESULT_PATTERN =
  /([^\s]+\/[^\s]+@[^\s]+)\s+([0-9.]+[KM]? installs)\n└\s+(https:\/\/skills\.sh\/[^\s]+)/g;

export type SkillSearchResult = ProjectSkillEntry & {
  installsLabel: string;
};

const stripAnsi = (value: string) => {
  let result = "";

  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 27) {
      result += value[index];
      continue;
    }

    const nextIndex = index + 1;

    if (value[nextIndex] === "[") {
      index = nextIndex + 1;

      while (index < value.length) {
        const code = value.charCodeAt(index);

        if (code >= 64 && code <= 126) {
          break;
        }

        index += 1;
      }
    }
  }

  return result;
};

const parseInstallSpec = (installSpec: string) => {
  const separatorIndex = installSpec.lastIndexOf("@");

  if (separatorIndex <= 0 || separatorIndex === installSpec.length - 1) {
    throw new Error(`Unexpected skill install spec: ${installSpec}`);
  }

  return {
    name: installSpec.slice(separatorIndex + 1),
    source: installSpec.slice(0, separatorIndex),
  };
};

export const searchSkills = async (query: string) => {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 2) {
    return [];
  }

  const { stdout, stderr } = await execFileAsync(
    "pnpm",
    ["dlx", "skills@latest", "find", trimmedQuery],
    {
      env: process.env,
      timeout: 60_000,
    },
  );

  const output = stripAnsi(`${stdout}\n${stderr}`);
  const results: SkillSearchResult[] = [];

  for (const match of output.matchAll(SEARCH_RESULT_PATTERN)) {
    const installSpec = match[1]?.trim();
    const installsLabel = match[2]?.trim();
    const url = match[3]?.trim();

    if (!installSpec || !installsLabel || !url) {
      continue;
    }

    const parsed = parseInstallSpec(installSpec);

    results.push({
      installSpec,
      installsLabel,
      name: parsed.name,
      source: parsed.source,
      url,
    });
  }

  return results;
};
