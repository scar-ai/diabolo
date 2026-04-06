import { createFileRoute, Outlet } from "@tanstack/react-router";

import { AppSidebar } from "@/components/app/app-sidebar";
import { AttachmentDropProvider } from "@/components/app/attachment-drop";
import { projectsQueryOptions } from "@/lib/project/queries";

export const Route = createFileRoute("/_auth/app")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      ...projectsQueryOptions(context.user.id),
      revalidateIfStale: true,
    });
  },
  component: AppLayout,
});

function AppLayout() {
  const { user } = Route.useRouteContext();

  return (
    <AttachmentDropProvider>
      <div className="flex h-svh overflow-hidden bg-background">
        <AppSidebar user={user} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </AttachmentDropProvider>
  );
}
