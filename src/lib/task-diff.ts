/**
 * Unified-diff parsing shared by the server (splitting a run's patch into
 * per-file rows) and the client (rendering one file's patch as lines).
 */

/** Files beyond this are dropped: no diff view is useful past a few hundred. */
export const MAX_DIFF_FILES = 300;

/** Patches larger than this are stored truncated rather than not at all. */
export const MAX_DIFF_FILE_PATCH_BYTES = 400_000;

/** Ceiling on the whole run's patch, enforced while it is still in the sandbox. */
export const MAX_DIFF_PATCH_BYTES = 4_000_000;

export const TASK_DIFF_CHANGE_TYPES = ["added", "deleted", "modified", "renamed"] as const;

export type TaskDiffChangeType = (typeof TASK_DIFF_CHANGE_TYPES)[number];

export type ParsedDiffFile = {
  additions: number;
  changeType: TaskDiffChangeType;
  deletions: number;
  filePath: string;
  isBinary: boolean;
  patch: string;
  previousPath: string | null;
  truncated: boolean;
};

export type DiffLine = {
  content: string;
  newLineNumber: number | null;
  oldLineNumber: number | null;
  type: "addition" | "context" | "deletion" | "hunk";
};

const stripPathPrefix = (value: string) => {
  const trimmed = value.trim().replace(/\t.*$/, "");

  if (trimmed === "/dev/null") {
    return null;
  }

  const unquoted =
    trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;

  return unquoted.replace(/^[ab]\//, "");
};

const readHeaderPaths = (headerLine: string) => {
  const match = headerLine.match(/^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/);

  return match ? { newPath: match[2], oldPath: match[1] } : null;
};

const parseFileSection = (section: string): ParsedDiffFile | null => {
  const lines = section.split("\n");
  const headerPaths = readHeaderPaths(lines[0] ?? "");

  let oldPath = headerPaths?.oldPath ?? null;
  let newPath = headerPaths?.newPath ?? null;
  let changeType: TaskDiffChangeType = "modified";
  let isBinary = false;
  let additions = 0;
  let deletions = 0;
  let inHunk = false;

  for (const line of lines.slice(1)) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      if (line.startsWith("new file mode")) {
        changeType = "added";
      } else if (line.startsWith("deleted file mode")) {
        changeType = "deleted";
      } else if (line.startsWith("rename from ")) {
        changeType = "renamed";
        oldPath = line.slice("rename from ".length).trim();
      } else if (line.startsWith("rename to ")) {
        changeType = "renamed";
        newPath = line.slice("rename to ".length).trim();
      } else if (line.startsWith("--- ")) {
        oldPath = stripPathPrefix(line.slice(4)) ?? oldPath;
      } else if (line.startsWith("+++ ")) {
        newPath = stripPathPrefix(line.slice(4)) ?? newPath;
      } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
        isBinary = true;
      }

      continue;
    }

    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  const filePath = newPath ?? oldPath;

  if (!filePath) {
    return null;
  }

  const patch = section.replace(/\n+$/, "");
  const truncated = patch.length > MAX_DIFF_FILE_PATCH_BYTES;

  return {
    additions,
    changeType,
    deletions,
    filePath,
    isBinary,
    patch: truncated ? patch.slice(0, MAX_DIFF_FILE_PATCH_BYTES) : patch,
    previousPath: changeType === "renamed" && oldPath && oldPath !== filePath ? oldPath : null,
    truncated,
  };
};

/** Splits a whole-run `git diff` into one entry per file, newest git first. */
export const parseUnifiedDiff = (raw: string): ParsedDiffFile[] => {
  const normalized = raw.replace(/\r\n/g, "\n");

  if (!normalized.trim()) {
    return [];
  }

  const sections: string[] = [];
  let current: string[] | null = null;

  for (const line of normalized.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) {
        sections.push(current.join("\n"));
      }

      current = [line];
      continue;
    }

    current?.push(line);
  }

  if (current) {
    sections.push(current.join("\n"));
  }

  return sections
    .slice(0, MAX_DIFF_FILES)
    .flatMap((section) => {
      const parsed = parseFileSection(section);
      return parsed ? [parsed] : [];
    })
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
};

/**
 * Turns one file's patch into renderable lines. Everything before the first
 * hunk is git's own metadata, which the file row already says more clearly.
 */
export const parseDiffLines = (patch: string): DiffLine[] => {
  const lines: DiffLine[] = [];
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let inHunk = false;

  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLineNumber = match ? Number(match[1]) : 0;
      newLineNumber = match ? Number(match[2]) : 0;
      inHunk = true;
      lines.push({ content: line, newLineNumber: null, oldLineNumber: null, type: "hunk" });
      continue;
    }

    if (!inHunk || line.startsWith("\\ No newline")) {
      continue;
    }

    if (line.startsWith("+")) {
      lines.push({
        content: line.slice(1),
        newLineNumber: newLineNumber++,
        oldLineNumber: null,
        type: "addition",
      });
      continue;
    }

    if (line.startsWith("-")) {
      lines.push({
        content: line.slice(1),
        newLineNumber: null,
        oldLineNumber: oldLineNumber++,
        type: "deletion",
      });
      continue;
    }

    lines.push({
      content: line.startsWith(" ") ? line.slice(1) : line,
      newLineNumber: newLineNumber++,
      oldLineNumber: oldLineNumber++,
      type: "context",
    });
  }

  return lines;
};

export const formatDiffChangeType = (changeType: string) =>
  changeType === "added"
    ? "Added"
    : changeType === "deleted"
      ? "Deleted"
      : changeType === "renamed"
        ? "Renamed"
        : "Modified";
