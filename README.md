# diabolo ⚙️😈

**diabolo** is a powerful platform for orchestrating AI agents in isolated, reproducible sandboxed environments. Built on a cutting-edge React 19 stack, it combines cloud-native development environments with sophisticated browser automation.

## 🚀 Key Features

- **🏗️ Sandboxed Execution:** Utilizes [Daytona](https://www.daytona.io/) to spin up secure, isolated development environments for AI agents to execute code and manage workspaces.
- **🌐 Intelligent Browsing:** Integrated with `agent-browser` and [OpenRouter](https://openrouter.ai/) so OpenCode agents can perform browser automation, screenshots, and interactive web verification inside the sandbox.
- **⚡ Modern Full-Stack:** Built with [TanStack Start](https://tanstack.com/start), leveraging React 19, [Vite](https://vite.dev/), and [Nitro](https://nitro.build/) for a seamless SSR and client-side experience.
- **🔐 Secure Auth:** Robust authentication powered by [Better Auth](https://www.better-auth.com/) with Drizzle ORM integration.
- **📊 Database & Types:** [Drizzle ORM](https://orm.drizzle.team/) with PostgreSQL for type-safe database operations and [Zod](https://zod.dev/) for rigorous schema validation.
- **🎨 Polished UI:** Styled with [Tailwind CSS v4](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/), and [Remix Icon](https://remixicon.com/).
- **🛠️ Developer First:** Ultra-fast linting and formatting with [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) and [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html).

## 🛠️ Tech Stack

- **Frontend:** React 19, TanStack Router, TanStack Query, TanStack Start.
- **Backend:** Nitro, Drizzle ORM, PostgreSQL.
- **Auth:** Better Auth.
- **Agent Capabilities:** Daytona SDK, `agent-browser`, Octokit (GitHub API).
- **Tooling:** TypeScript, Vite, Tailwind CSS v4, Oxlint, Oxfmt, Husky.

## 🏁 Getting Started

### 1. Prerequisites

- [pnpm](https://pnpm.io/) (Recommended)
- [Docker](https://www.docker.com/) (for local database)
- Daytona API Key (if using sandboxes)
- OpenRouter API Key (for browser automation)

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/diabolo.git
cd diabolo

# Install dependencies
pnpm install
```

### 3. Environment Setup

Create a `.env` file based on [`.env.example`](./.env.example) and fill in the required credentials.

### 4. Database Setup

Spin up the local database and run migrations:

```bash
pnpm db push
```

### 5. Development

Start the development server:

```bash
pnpm dev
```

The application will be available at `http://localhost:3000`.

## 📜 Available Scripts

- `pnpm dev`: Start the development server.
- `pnpm build`: Build for production.
- `pnpm start`: Run the production server.
- `pnpm check`: Run linting and formatting checks.
- `pnpm db`: Drizzle ORM management (generate, migrate, studio).
- `pnpm auth:migrate`: Sync Better Auth schema with the database.
- `pnpm ui`: shadcn/ui component management.

## 🤝 Contributing

Contributions are welcome! Please ensure you run `pnpm check` before submitting a PR to maintain code quality.

## 📄 License

This project is licensed under the [Unlicense](./LICENSE).
