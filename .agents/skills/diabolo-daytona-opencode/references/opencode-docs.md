# OpenCode Docs

Official docs root: <https://opencode.ai/docs/>

Use this reference when changing OpenCode config generation, permissions, tools, model selection, prompt wiring, or project-level behavior in diabolo.

## Docs to open

- Docs root: <https://opencode.ai/docs/>
- Config: <https://opencode.ai/docs/config/>
- Tools: <https://opencode.ai/docs/tools/>

## Relevant points for this repo

- OpenCode supports project-level config via `opencode.json` in the project root. The docs say project config takes precedence over global and remote config, and OpenCode searches from the current directory upward to the nearest Git root.
- OpenCode uses a JSON or JSONC config format with the published schema at `https://opencode.ai/config.json`.
- Tool permissions are explicit config. The docs describe per-tool permission settings such as `bash`, `edit`, `webfetch`, and `skill`.
- The tools docs confirm that the `skill` tool can load a `SKILL.md` file into the conversation when permission is allowed.

## How that maps to diabolo

- `src/lib/opencode/config.ts` generates a temporary OpenCode config instead of relying on a checked-in `opencode.json`. Preserve that approach unless the repo intentionally moves to committed project config.
- The generated config already grants `bash`, `edit`, and `webfetch`; update permissions deliberately, because changing them changes what the coding agent can actually do inside the sandbox.
- `src/lib/sandbox/opencode-runtime.ts` exports the generated config through `OPENCODE_CONFIG` and runs the persistent OpenCode server used by task sessions.
- `src/lib/opencode/config.ts` uses OpenCode's native `openai` provider for Codex and generates custom provider definitions only for API-key providers.
- `src/lib/opencode/codex.ts` starts OpenCode's built-in headless OAuth flow through the provider auth API in an isolated Daytona sandbox. Do not reimplement OpenAI's OAuth or Codex Responses protocol in the app.

## Design bias

- Prefer one generated source of truth for OpenCode config over scattered config fragments.
- Keep permissions tight enough to match the intended runtime, but broad enough for the repo's agent workflows to function.
- Treat prompt construction, tool setup, and config generation as separate responsibilities.
