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

const STAGEHAND_PACKAGE_JSON = JSON.stringify(
  {
    name: "diabolo-opencode-stagehand",
    private: true,
    type: "module",
    dependencies: {
      "@browserbasehq/stagehand": "^3.0.0",
      playwright: "^1.55.0",
      zod: "^4.3.6",
    },
  },
  null,
  2,
);

const STAGEHAND_TOOL_CONTENT = String.raw`import { mkdirSync } from "node:fs";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

let runtimePromise = null;

const DEFAULT_TIMEOUT_MS = 20000;
const NAVIGATION_TIMEOUT_MS = 15000;
const NAVIGATION_RETRY_DELAY_MS = 1000;
const toErrorMessage = (error) => (error instanceof Error ? error.message : String(error));
const toText = (value) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));
const withTimeout = async (label, promise, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  let timeoutId;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(label + " timed out after " + timeoutMs + "ms"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const getRuntimeDir = () =>
  process.env.OPENCODE_STAGEHAND_RUNTIME_DIR ||
  (process.env.HOME ? process.env.HOME + "/.cache/opencode-stagehand" : process.cwd());

const ensureDirectory = (target) => {
  mkdirSync(target, { recursive: true });
  return target;
};

const sleep = (timeoutMs) => new Promise((resolve) => setTimeout(resolve, timeoutMs));

const isChromeErrorUrl = (url) => url.startsWith("chrome-error://");

const getNavigationCandidates = (rawUrl) => {
  const parsed = new URL(rawUrl);
  const candidates = [parsed.toString()];

  if (parsed.hostname === "localhost") {
    parsed.hostname = "127.0.0.1";
    candidates.push(parsed.toString());
  }

  return candidates;
};

const navigateWithRetries = async (page, targetUrl) => {
  let lastError = null;

  for (const candidateUrl of getNavigationCandidates(targetUrl)) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await withTimeout(
          "Navigating with Stagehand",
          page.goto(candidateUrl, {
            waitUntil: "domcontentloaded",
            timeout: NAVIGATION_TIMEOUT_MS,
          }),
          NAVIGATION_TIMEOUT_MS + 2000,
        );

        const landedUrl = page.url();

        if (!isChromeErrorUrl(landedUrl)) {
          return;
        }

        lastError = new Error(
          "Chrome showed an internal error page while opening " +
            candidateUrl +
            " (landed on " +
            landedUrl +
            ").",
        );
      } catch (error) {
        lastError = error;
      }

      if (attempt < 3) {
        await sleep(NAVIGATION_RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw new Error(
    "Failed to open " +
      targetUrl +
      ": " +
      (lastError ? toErrorMessage(lastError) : "unknown navigation error"),
  );
};

const getModel = () => {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for Stagehand local tools.");
  }

  return {
    modelName: process.env.OPENCODE_STAGEHAND_MODEL || "openai/gpt-5",
    apiKey,
    baseURL: process.env.OPENCODE_STAGEHAND_MODEL_BASE_URL || "https://openrouter.ai/api/v1",
  };
};

const createRuntime = async () => {
  const runtimeDir = ensureDirectory(getRuntimeDir());
  const userDataDir = ensureDirectory(runtimeDir + "/user-data");
  const screenshotsDir = ensureDirectory(runtimeDir + "/screenshots");

  const stagehand = new Stagehand({
    env: "LOCAL",
    model: getModel(),
    cacheDir: runtimeDir + "/cache",
    localBrowserLaunchOptions: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--allow-running-insecure-content",
      ],
      chromiumSandbox: false,
      ignoreHTTPSErrors: true,
      preserveUserDataDir: true,
      userDataDir,
    },
  });

  await withTimeout("Stagehand initialization", stagehand.init(), 30000);

  return {
    screenshotsDir,
    stagehand,
  };
};

const ensureRuntime = async () => {
  if (!runtimePromise) {
    runtimePromise = createRuntime().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }

  return runtimePromise;
};

const getPage = async () => {
  const runtime = await ensureRuntime();
  const page = runtime.stagehand.context.activePage?.() || runtime.stagehand.context.pages()[0];

  if (!page) {
    throw new Error("Stagehand did not expose an active page.");
  }

  page.setDefaultTimeout?.(DEFAULT_TIMEOUT_MS);
  page.setDefaultNavigationTimeout?.(NAVIGATION_TIMEOUT_MS);

  return { page, runtime };
};

const getPageState = async () => {
  const { page } = await getPage();

  return {
    title: await page.title(),
    url: await page.url(),
  };
};

export const open_url = {
  description: "Open a URL in the sandbox-local Stagehand browser.",
  args: {
    url: z.url().describe("The URL to open."),
  },
  async execute(args) {
    const { page } = await getPage();
    await navigateWithRetries(page, args.url);
    return toText(await getPageState());
  },
};

export const get_state = {
  description: "Get the current Stagehand page URL and title.",
  args: {},
  async execute() {
    return toText(await getPageState());
  },
};

export const page_text = {
  description: "Return visible text content from the current page.",
  args: {},
  async execute() {
    const { page } = await getPage();
    return (
      await withTimeout(
        "Reading page text",
        page.evaluate(() => {
          const body = document.body;
          return body ? body.innerText : "";
        }),
      )
    ).trim();
  },
};

export const observe = {
  description: "Use Stagehand to discover actionable elements on the current page.",
  args: {
    instruction: z.string().min(1).describe("What to look for on the current page."),
  },
  async execute(args) {
    const { runtime } = await getPage();
    return toText(
      await withTimeout("Stagehand observe", runtime.stagehand.observe(args.instruction)),
    );
  },
};

export const act = {
  description: "Use Stagehand to perform a natural-language action on the current page.",
  args: {
    action: z.string().min(1).describe("The action to perform."),
  },
  async execute(args) {
    const { runtime } = await getPage();
    const result = await withTimeout("Stagehand act", runtime.stagehand.act(args.action));
    return toText({
      result,
      ...(await getPageState()),
    });
  },
};

export const screenshot = {
  description: "Capture a screenshot from the current Stagehand page.",
  args: {
    fullPage: z.boolean().optional().describe("Capture the full page instead of the viewport."),
    name: z.string().optional().describe("Optional filename prefix."),
  },
  async execute(args) {
    const { page, runtime } = await getPage();
    const prefix = (args.name || "stagehand").replace(/[^a-zA-Z0-9-_]+/g, "-");
    const path = runtime.screenshotsDir + "/" + prefix + "-" + Date.now() + ".png";
    await withTimeout(
      "Capturing Stagehand screenshot",
      page.screenshot({ fullPage: args.fullPage ?? true, path }),
    );
    return toText({
      path,
      ...(await getPageState()),
    });
  },
};

export const close = {
  description: "Close the current Stagehand browser session and clear local runtime state.",
  args: {},
  async execute() {
    if (!runtimePromise) {
      return toText({ closed: false });
    }

    try {
      const runtime = await runtimePromise;
      await withTimeout("Closing Stagehand", runtime.stagehand.close(), 10000);
      return toText({ closed: true });
    } catch (error) {
      throw new Error("Failed to close Stagehand: " + toErrorMessage(error));
    } finally {
      runtimePromise = null;
    }
  },
};
`;

export const buildStagehandOpenCodeSetupCommand = () =>
  [
    'OPENCODE_STAGEHAND_ROOT="${OPENCODE_STAGEHAND_ROOT:-$HOME/.config/opencode}"',
    'OPENCODE_STAGEHAND_CONFIG_DIR="${OPENCODE_STAGEHAND_CONFIG_DIR:-$OPENCODE_STAGEHAND_ROOT/config}"',
    'OPENCODE_STAGEHAND_RUNTIME_DIR="${OPENCODE_STAGEHAND_RUNTIME_DIR:-$HOME/.cache/opencode-stagehand}"',
    'OPENCODE_STAGEHAND_REPO_DIR="${OPENCODE_STAGEHAND_REPO_DIR:-$HOME/.local/share/opencode-stagehand/stagehand-repo}"',
    'OPENCODE_STAGEHAND_PLAYWRIGHT_BROWSERS_DIR="${OPENCODE_STAGEHAND_PLAYWRIGHT_BROWSERS_DIR:-$HOME/.cache/ms-playwright}"',
    'OPENCODE_STAGEHAND_READY_MARKER="${OPENCODE_STAGEHAND_RUNTIME_DIR}/.stagehand-ready-v2"',
    'mkdir -p "$OPENCODE_STAGEHAND_ROOT/tools" "$OPENCODE_STAGEHAND_RUNTIME_DIR" "$OPENCODE_STAGEHAND_REPO_DIR" "$OPENCODE_STAGEHAND_PLAYWRIGHT_BROWSERS_DIR"',
    'if ! command -v pnpm >/dev/null 2>&1; then if command -v corepack >/dev/null 2>&1; then pnpm() { corepack pnpm "$@"; }; else npm install -g pnpm --prefix "$HOME/.local"; export PATH="$HOME/.local/bin:$PATH"; fi; fi',
    "pnpm --version",
    "retry_stagehand_command() {",
    "  stagehand_attempt=1",
    '  while [ "$stagehand_attempt" -le 3 ]; do',
    '    if "$@"; then',
    "      return 0",
    "    fi",
    '    if [ "$stagehand_attempt" -eq 3 ]; then',
    "      return 1",
    "    fi",
    '    echo "Stagehand setup attempt ${stagehand_attempt} failed; retrying..."',
    '    sleep "$((stagehand_attempt * 5))"',
    "    stagehand_attempt=$((stagehand_attempt + 1))",
    "  done",
    "}",
    writeFileCommand("$OPENCODE_STAGEHAND_ROOT/package.json", STAGEHAND_PACKAGE_JSON),
    writeFileCommand("$OPENCODE_STAGEHAND_ROOT/tools/stagehand.ts", STAGEHAND_TOOL_CONTENT),
    'if [ ! -d "$OPENCODE_STAGEHAND_REPO_DIR/.git" ]; then git clone --depth=1 https://github.com/browserbase/stagehand.git "$OPENCODE_STAGEHAND_REPO_DIR"; fi',
    'if [ ! -d "$OPENCODE_STAGEHAND_ROOT/node_modules/@browserbasehq/stagehand" ] || [ ! -d "$OPENCODE_STAGEHAND_ROOT/node_modules/playwright" ] || [ ! -d "$OPENCODE_STAGEHAND_ROOT/node_modules/zod" ]; then (cd "$OPENCODE_STAGEHAND_ROOT" && pnpm install --ignore-scripts); fi',
    'if [ ! -f "$OPENCODE_STAGEHAND_READY_MARKER" ]; then (cd "$OPENCODE_STAGEHAND_ROOT" && PLAYWRIGHT_BROWSERS_PATH="$OPENCODE_STAGEHAND_PLAYWRIGHT_BROWSERS_DIR" retry_stagehand_command pnpm exec playwright install --with-deps chromium) && touch "$OPENCODE_STAGEHAND_READY_MARKER"; fi',
  ].join("\n");

export const buildStagehandOpenCodeExports = () =>
  [
    'export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"',
    'export OPENCODE_STAGEHAND_RUNTIME_DIR="${OPENCODE_STAGEHAND_RUNTIME_DIR:-$HOME/.cache/opencode-stagehand}"',
    'export OPENCODE_STAGEHAND_MODEL="${OPENCODE_STAGEHAND_MODEL:-openai/gpt-5}"',
    'export OPENCODE_STAGEHAND_MODEL_BASE_URL="${OPENCODE_STAGEHAND_MODEL_BASE_URL:-https://openrouter.ai/api/v1}"',
  ].join("\n");
