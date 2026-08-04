import { Daytona, DaytonaNotFoundError } from "@daytona/sdk";

const SNAPSHOT_VERSION = "v3";
const OPENCODE_VERSION = "1.18.11";

/**
 * Resources for sandboxes created from this snapshot.
 *
 * Daytona's default is 1 GiB, which the OpenCode server does not survive: it is
 * OOM-killed shortly after start, which silently kills the whole progress
 * stream (no agent text, no tool calls) and leaves the run blocked until it
 * times out. Sandboxes inherit these from the snapshot, so this is the only
 * place the allocation can be set — `daytona.create` accepts `resources` for
 * image-based sandboxes only.
 */
const SNAPSHOT_RESOURCES = {
  cpu: 2,
  disk: 10,
  memory: 4,
};
const DEFAULT_BASE_IMAGE = "node:22-bookworm";
const SNAPSHOT_READY_TIMEOUT_MS = 15 * 60 * 1000;
const SNAPSHOT_READY_POLL_MS = 5000;
const snapshotName =
  process.env.DAYTONA_BROWSER_SNAPSHOT?.trim() || `diabolo-opencode-browser-${SNAPSHOT_VERSION}`;
const baseImage =
  process.env.DAYTONA_DEFAULT_IMAGE?.trim() ||
  process.env.DAYTONA_BROWSER_BASE_IMAGE?.trim() ||
  DEFAULT_BASE_IMAGE;

if (!process.env.DAYTONA_API_KEY) {
  console.error("DAYTONA_API_KEY is required.");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isBuildingState = (state) => {
  const normalized = String(state || "").toLowerCase();
  return (
    normalized === "building" ||
    normalized === "pending" ||
    normalized === "queued" ||
    normalized === "creating"
  );
};

const createBrowserSnapshotImage = async () => {
  const { Image } = await import("@daytona/sdk");

  return Image.base(baseImage)
    .runCommands(
      "apt-get update",
      [
        "bash",
        "-lc",
        "export DEBIAN_FRONTEND=noninteractive && apt-get install -y git curl ca-certificates sudo python3 build-essential chromium",
      ],
      "rm -rf /var/lib/apt/lists/*",
      "corepack enable",
      "corepack prepare pnpm@10.33.0 --activate",
      `npm install -g opencode-ai@${OPENCODE_VERSION} @opencode-ai/plugin@${OPENCODE_VERSION} @daytona/sdk agent-browser zod`,
      [
        "bash",
        "-lc",
        'if command -v chromium >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1; then ln -sf "$(command -v chromium)" /usr/local/bin/google-chrome; fi',
      ],
      "node --version",
      "npm --version",
      "pnpm --version",
      "opencode --version",
      "agent-browser --version",
      "mkdir -p /home/daytona/.config/opencode/tools /root/.config/opencode/tools",
    )
    .env({
      PATH: "/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin",
    });
};

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  apiUrl: process.env.DAYTONA_API_URL || undefined,
  target: process.env.DAYTONA_TARGET || undefined,
});

try {
  let snapshot;

  try {
    snapshot = await daytona.snapshot.get(snapshotName);
    console.log(`Snapshot "${snapshotName}" already exists in state "${snapshot.state}".`);
  } catch (error) {
    if (!(error instanceof DaytonaNotFoundError)) {
      throw error;
    }

    console.log(`Creating Daytona browser snapshot "${snapshotName}" from ${baseImage}...`);
    snapshot = await daytona.snapshot.create(
      {
        image: await createBrowserSnapshotImage(),
        name: snapshotName,
        resources: SNAPSHOT_RESOURCES,
      },
      {
        onLogs: (chunk) => {
          process.stdout.write(chunk);
        },
        timeout: 1800,
      },
    );
  }

  const deadline = Date.now() + SNAPSHOT_READY_TIMEOUT_MS;

  while (isBuildingState(snapshot.state)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Snapshot "${snapshotName}" is still ${snapshot.state} after waiting 15 minutes.`,
      );
    }

    console.log(`Snapshot "${snapshotName}" is ${snapshot.state}. Waiting...`);
    await sleep(SNAPSHOT_READY_POLL_MS);
    snapshot = await daytona.snapshot.get(snapshotName);
  }

  if (snapshot.state !== "active") {
    console.log(`Activating snapshot "${snapshotName}"...`);
    snapshot = await daytona.snapshot.activate(snapshot);
  }

  console.log(`Ready snapshot: ${snapshot.name}`);
} finally {
  await daytona[Symbol.asyncDispose]?.();
}
