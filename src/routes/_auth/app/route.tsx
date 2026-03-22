import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useMatchRoute, useRouter } from "@tanstack/react-router";
import { HouseIcon, HistoryIcon, LogOutIcon } from "lucide-react";

import { HeaderPortalProvider, useHeaderSlots } from "@/components/app/header-portal";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import authClient from "@/lib/auth/auth-client";
import { authQueryOptions } from "@/lib/auth/queries";
export const Route = createFileRoute("/_auth/app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <HeaderPortalProvider>
      <AppLayoutInner />
    </HeaderPortalProvider>
  );
}

function AppLayoutInner() {
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const matchRoute = useMatchRoute();
  const router = useRouter();
  const initials = (user.name ?? user.email ?? "?").slice(0, 1).toUpperCase();
  const isSessionsActive =
    !!matchRoute({ to: "/app/sessions" }) || !!matchRoute({ to: "/app/tasks/$taskId" });
  const headerSlots = useHeaderSlots();

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <header className="relative flex shrink-0 items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <svg
            className="size-7 text-foreground"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
          </svg>
          {headerSlots.left}
        </div>

        <nav className="absolute left-1/2 flex -translate-x-1/2 items-center gap-x-0.5 rounded-lg bg-muted p-0.5">
          <Link
            to="/app"
            activeOptions={{ exact: true }}
            className="relative flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors [&_svg]:size-4"
            activeProps={{ className: "bg-background text-foreground shadow-sm/5 dark:bg-input" }}
            inactiveProps={{ className: "text-muted-foreground/72 hover:text-muted-foreground" }}
          >
            <HouseIcon aria-hidden="true" />
            Home
          </Link>
          <Link
            to="/app/sessions"
            className={`relative flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors [&_svg]:size-4 ${
              isSessionsActive
                ? "bg-background text-foreground shadow-sm/5 dark:bg-input"
                : "text-muted-foreground/72 hover:text-muted-foreground"
            }`}
          >
            <HistoryIcon aria-hidden="true" />
            Sessions
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {headerSlots.right}
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded-full">
              <Avatar className="size-9 border border-border">
                {user.image ? <AvatarImage src={user.image} alt={user.name ?? ""} /> : null}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onClick={async () => {
                  await authClient.signOut({
                    fetchOptions: {
                      onResponse: async () => {
                        queryClient.setQueryData(authQueryOptions().queryKey, null);
                        await router.invalidate();
                      },
                    },
                  });
                }}
              >
                <LogOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
