import { spawnSync } from "node:child_process";

const command = process.argv[2];
const args = process.argv.slice(2);
const liveDbCommands = new Set(["push", "pull", "migrate", "studio", "drop", "introspect"]);

const databaseUrl = process.env.DATABASE_URL;
let shouldStartLocalDb = false;

if (command && liveDbCommands.has(command) && databaseUrl) {
  try {
    const { hostname, protocol } = new URL(databaseUrl);
    shouldStartLocalDb =
      (protocol === "postgres:" || protocol === "postgresql:") &&
      ["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    shouldStartLocalDb = false;
  }
}

if (shouldStartLocalDb) {
  const dockerResult = spawnSync("docker", ["compose", "up", "-d", "db"], {
    stdio: "inherit",
  });

  if (dockerResult.error) {
    console.warn(
      `Unable to start the local Postgres container automatically: ${dockerResult.error.message}`,
    );
  } else if (dockerResult.status !== 0) {
    console.warn("docker compose up -d db exited non-zero; continuing with the Drizzle command.");
  }
}

const drizzleResult = spawnSync("pnpm", ["exec", "drizzle-kit", ...args], {
  stdio: "inherit",
});

if (drizzleResult.error) {
  console.error(drizzleResult.error);
}

process.exit(drizzleResult.status ?? 1);
