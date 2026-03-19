import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_auth/app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <div className="min-h-svh bg-background px-4 py-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Button render={<Link to="/" />} size="sm" variant="outline" nativeButton={false}>
            back to home
          </Button>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>

        <Outlet />
      </div>
    </div>
  );
}
