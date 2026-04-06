import { createFileRoute, redirect } from "@tanstack/react-router";

// Projects are now managed via the sidebar. Redirect to the main workspace.
export const Route = createFileRoute("/_auth/app/projects")({
  beforeLoad: () => {
    throw redirect({ to: "/app" });
  },
  component: () => null,
});
