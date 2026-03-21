import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/hello-world")({
  server: {
    handlers: {
      GET: () => {
        return new Response("hello world", {
          headers: { "Content-Type": "text/plain" },
        });
      },
    },
  },
});
