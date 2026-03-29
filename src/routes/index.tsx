import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/app/projects" });
  },
  component: HomePage,
});

function HomePage() {
  return null;
}
