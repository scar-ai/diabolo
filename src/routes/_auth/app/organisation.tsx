import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BuildingIcon,
  CheckIcon,
  CrownIcon,
  PlusIcon,
  ShieldIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  $acceptInvite,
  $cancelInvite,
  $createOrg,
  $declineInvite,
  $inviteMember,
  $kickMember,
  $promoteMember,
} from "@/lib/org/functions";
import { myInvitesQueryOptions, myOrgQueryOptions, orgKeys } from "@/lib/org/queries";
import { $acceptProjectInvite, $declineProjectInvite } from "@/lib/project/functions";
import { collaboratorKeys, myProjectInvitesQueryOptions } from "@/lib/project/queries";
import { $saveUserLlmProviders } from "@/lib/user/functions";
import { userLlmProvidersQueryOptions } from "@/lib/user/queries";

export const Route = createFileRoute("/_auth/app/organisation")({
  loader: async ({ context }) => {
    const userId = context.user.id;
    await Promise.all([
      context.queryClient.ensureQueryData({
        ...myOrgQueryOptions(userId),
        revalidateIfStale: true,
      }),
      context.queryClient.ensureQueryData({
        ...myInvitesQueryOptions(userId),
        revalidateIfStale: true,
      }),
      context.queryClient.ensureQueryData({
        ...myProjectInvitesQueryOptions(userId),
        revalidateIfStale: true,
      }),
    ]);
  },
  component: OrganisationPage,
});

function OrganisationPage() {
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const createOrg = useServerFn($createOrg);
  const inviteMember = useServerFn($inviteMember);
  const acceptInvite = useServerFn($acceptInvite);
  const declineInvite = useServerFn($declineInvite);
  const cancelInvite = useServerFn($cancelInvite);
  const kickMember = useServerFn($kickMember);
  const promoteMember = useServerFn($promoteMember);

  const acceptProjectInvite = useServerFn($acceptProjectInvite);
  const declineProjectInvite = useServerFn($declineProjectInvite);
  const saveProviders = useServerFn($saveUserLlmProviders);

  const orgQuery = useQuery(myOrgQueryOptions(user.id));
  const invitesQuery = useQuery(myInvitesQueryOptions(user.id));
  const projectInvitesQuery = useQuery(myProjectInvitesQueryOptions(user.id));
  const providersQuery = useQuery(userLlmProvidersQueryOptions());

  const org = orgQuery.data ?? null;
  const invites = invitesQuery.data ?? [];
  const projectInvites = projectInvitesQuery.data ?? [];
  const organisationProviders = (providersQuery.data ?? []).filter(
    (provider) => provider.scope === "organisation",
  );
  const isProvidersLoading = providersQuery.isPending && !providersQuery.isFetched;

  const [createOrgName, setCreateOrgName] = useState("");
  const [inviteUsername, setInviteUsername] = useState("");
  const [draftProviders, setDraftProviders] = useState<typeof organisationProviders | null>(null);
  const providerDrafts = draftProviders ?? organisationProviders;

  const createOrgMutation = useMutation({
    mutationFn: () => createOrg({ data: { name: createOrgName.trim() } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orgKeys.all });
      toast.success("Organisation created.");
      setCreateOrgName("");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create organisation.");
    },
  });

  const inviteMemberMutation = useMutation({
    mutationFn: () =>
      inviteMember({ data: { githubUsername: inviteUsername.trim(), orgId: org!.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orgKeys.all });
      toast.success(`Invite sent to @${inviteUsername.trim()}.`);
      setInviteUsername("");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to send invite.");
    },
  });

  const acceptInviteMutation = useMutation({
    mutationFn: (inviteId: string) => acceptInvite({ data: { inviteId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orgKeys.all });
      toast.success("Joined organisation.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to accept invite.");
    },
  });

  const declineInviteMutation = useMutation({
    mutationFn: (inviteId: string) => declineInvite({ data: { inviteId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orgKeys.myInvites(user.id) });
      toast.success("Invite declined.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to decline invite.");
    },
  });

  const acceptProjectInviteMutation = useMutation({
    mutationFn: (inviteId: string) => acceptProjectInvite({ data: { inviteId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: collaboratorKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await projectInvitesQuery.refetch();
      toast.success("Joined project.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to accept invite.");
    },
  });

  const declineProjectInviteMutation = useMutation({
    mutationFn: (inviteId: string) => declineProjectInvite({ data: { inviteId } }),
    onSuccess: async () => {
      await projectInvitesQuery.refetch();
      toast.success("Invite declined.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to decline invite.");
    },
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (inviteId: string) => cancelInvite({ data: { inviteId, orgId: org!.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orgKeys.all });
      toast.success("Invite cancelled.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to cancel invite.");
    },
  });

  const kickMemberMutation = useMutation({
    mutationFn: (targetUserId: string) => kickMember({ data: { targetUserId, orgId: org!.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orgKeys.all });
      toast.success("Member removed.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to remove member.");
    },
  });

  const promoteMemberMutation = useMutation({
    mutationFn: (targetUserId: string) => promoteMember({ data: { targetUserId, orgId: org!.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orgKeys.all });
      toast.success("Member promoted to owner.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to promote member.");
    },
  });

  const saveProvidersMutation = useMutation({
    mutationFn: () =>
      saveProviders({
        data: {
          providers: providerDrafts.map((provider) => ({
            ...provider,
            scope: "organisation" as const,
          })),
        },
      }),
    onSuccess: async () => {
      setDraftProviders(null);
      await queryClient.invalidateQueries(userLlmProvidersQueryOptions());
      toast.success("Organisation providers saved.");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to save organisation providers.",
      );
    },
  });

  const updateProvider = (providerId: string, patch: Partial<(typeof providerDrafts)[number]>) => {
    setDraftProviders((current) => {
      const source = current ?? organisationProviders;
      return source.map((provider) =>
        provider.id === providerId ? { ...provider, ...patch } : provider,
      );
    });
  };

  const addProvider = () => {
    setDraftProviders((current) => {
      const source = current ?? organisationProviders;
      return [
        ...source,
        {
          canManage: true,
          id: crypto.randomUUID(),
          isDefault: false,
          name: `Organisation provider ${source.length + 1}`,
          providerApiKey: "",
          providerBaseUrl: "https://api.openai.com/v1",
          providerId: "openai",
          providerModel: "",
          scope: "organisation",
        },
      ];
    });
  };

  const removeProvider = (providerId: string) => {
    setDraftProviders((current) => {
      const source = current ?? organisationProviders;
      return source.filter((provider) => provider.id !== providerId);
    });
  };

  const pageHeader = (
    <div className="flex h-14 shrink-0 items-center border-b border-border/60 px-6">
      <h1 className="text-base font-medium text-foreground">Organisation</h1>
    </div>
  );

  if (orgQuery.isPending || invitesQuery.isPending || projectInvitesQuery.isPending) {
    return (
      <>
        {pageHeader}
        <main className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </main>
      </>
    );
  }

  // User is in an org — show org settings
  if (org) {
    const isOwner = org.currentUserRole === "owner";

    return (
      <>
        {pageHeader}
        <main className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-10">
          <div className="w-full max-w-2xl space-y-4">
            {/* Header */}
            <div className="mb-6">
              <p className="text-sm tracking-[0.24em] text-muted-foreground/55 uppercase">
                Organisation
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                {org.name}
              </h1>
            </div>

            {/* Members */}
            <section className="rounded-2xl border border-border/70 bg-card px-6 py-6 shadow-xs">
              <h2 className="mb-4 text-sm font-semibold text-foreground">Members</h2>
              <div className="space-y-2">
                {org.members.map((member) => {
                  const isSelf = member.userId === user.id;
                  const isOwnerMember = member.role === "owner";
                  const canAct = isOwner && !isSelf;
                  return (
                    <div key={member.userId} className="flex items-center gap-3">
                      <Avatar className="size-8 border border-border">
                        {member.user.image ? (
                          <AvatarImage src={member.user.image} alt={member.user.name} />
                        ) : null}
                        <AvatarFallback>
                          {member.user.name.slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex-1 text-sm text-foreground">{member.user.name}</span>
                      {isOwnerMember && (
                        <CrownIcon className="size-3.5 text-amber-500" aria-label="Owner" />
                      )}
                      {canAct && !isOwnerMember && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                          disabled={
                            promoteMemberMutation.isPending &&
                            promoteMemberMutation.variables === member.userId
                          }
                          onClick={() => promoteMemberMutation.mutate(member.userId)}
                        >
                          <ShieldIcon className="size-3.5" />
                          Promote
                        </Button>
                      )}
                      {canAct && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          disabled={
                            kickMemberMutation.isPending &&
                            kickMemberMutation.variables === member.userId
                          }
                          onClick={() => kickMemberMutation.mutate(member.userId)}
                        >
                          <XIcon className="size-3.5" />
                          Kick
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Pending invites — owners only */}
            {isOwner && org.pendingInvites.length > 0 && (
              <section className="rounded-2xl border border-border/70 bg-card px-6 py-6 shadow-xs">
                <h2 className="mb-4 text-sm font-semibold text-foreground">Pending invites</h2>
                <div className="space-y-2">
                  {org.pendingInvites.map((invite) => (
                    <div key={invite.id} className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-full bg-muted">
                        <UserPlusIcon className="size-4 text-muted-foreground" />
                      </div>
                      <span className="flex-1 text-sm text-foreground">
                        @{invite.githubUsername}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        Pending
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        disabled={
                          cancelInviteMutation.isPending &&
                          cancelInviteMutation.variables === invite.id
                        }
                        onClick={() => cancelInviteMutation.mutate(invite.id)}
                      >
                        <XIcon className="size-3.5" />
                        Cancel
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {isOwner && (
              <section className="rounded-2xl border border-border/70 bg-card px-6 py-6 shadow-xs">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      Organisation providers
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Providers added here are available to every member of {org.name}.
                    </p>
                  </div>
                  <Button onClick={addProvider}>
                    <PlusIcon aria-hidden="true" />
                    Add provider
                  </Button>
                </div>

                <div className="mt-6 space-y-4">
                  {isProvidersLoading && providerDrafts.length === 0 ? (
                    <div className="rounded-xl border border-border/60 bg-card px-4 py-5 text-sm text-muted-foreground">
                      Loading organisation providers...
                    </div>
                  ) : null}

                  {!isProvidersLoading && providerDrafts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 bg-card/60 px-4 py-5 text-sm text-muted-foreground">
                      No organisation providers yet.
                    </div>
                  ) : null}

                  {providerDrafts.map((provider) => (
                    <section
                      key={provider.id}
                      className="rounded-2xl border border-border/70 bg-card px-5 py-5 shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-semibold">
                              {provider.name || "Untitled provider"}
                            </h3>
                            <Badge variant="outline" className="text-xs">
                              Organisation
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Every organisation member can select this provider from the composer.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => removeProvider(provider.id)}
                        >
                          <XIcon className="size-4" />
                          Remove
                        </Button>
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`org-provider-name-${provider.id}`}>Display name</Label>
                          <Input
                            id={`org-provider-name-${provider.id}`}
                            value={provider.name}
                            onChange={(event) =>
                              updateProvider(provider.id, { name: event.target.value })
                            }
                            placeholder="OpenAI team"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`org-provider-id-${provider.id}`}>Provider ID</Label>
                          <Input
                            id={`org-provider-id-${provider.id}`}
                            value={provider.providerId}
                            onChange={(event) =>
                              updateProvider(provider.id, {
                                providerId: event.target.value.trim().toLowerCase(),
                              })
                            }
                            placeholder="openai"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5 md:col-span-2">
                          <Label htmlFor={`org-provider-base-url-${provider.id}`}>
                            API Base URL
                          </Label>
                          <Input
                            id={`org-provider-base-url-${provider.id}`}
                            value={provider.providerBaseUrl}
                            onChange={(event) =>
                              updateProvider(provider.id, {
                                providerBaseUrl: event.target.value,
                              })
                            }
                            placeholder="https://api.openai.com/v1"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`org-provider-model-${provider.id}`}>Default model</Label>
                          <Input
                            id={`org-provider-model-${provider.id}`}
                            value={provider.providerModel}
                            onChange={(event) =>
                              updateProvider(provider.id, { providerModel: event.target.value })
                            }
                            placeholder="gpt-4o"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`org-provider-api-key-${provider.id}`}>API key</Label>
                          <Input
                            id={`org-provider-api-key-${provider.id}`}
                            type="password"
                            autoComplete="off"
                            value={provider.providerApiKey}
                            onChange={(event) =>
                              updateProvider(provider.id, { providerApiKey: event.target.value })
                            }
                            placeholder="sk-..."
                          />
                        </div>
                      </div>
                    </section>
                  ))}
                </div>

                <div className="mt-6 flex justify-end">
                  <Button
                    disabled={saveProvidersMutation.isPending || draftProviders === null}
                    onClick={() => saveProvidersMutation.mutate()}
                  >
                    {saveProvidersMutation.isPending ? "Saving..." : "Save organisation providers"}
                  </Button>
                </div>
              </section>
            )}

            {/* Project invites */}
            {projectInvites.length > 0 && (
              <section className="rounded-2xl border border-border/70 bg-card px-6 py-6 shadow-xs">
                <h2 className="mb-4 text-sm font-semibold text-foreground">Project invites</h2>
                <div className="space-y-3">
                  {projectInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3"
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                        <UserPlusIcon className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {invite.project.name}
                        </p>
                        <p className="text-xs text-muted-foreground">Invited to collaborate</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            declineProjectInviteMutation.isPending &&
                            declineProjectInviteMutation.variables === invite.id
                          }
                          onClick={() => declineProjectInviteMutation.mutate(invite.id)}
                        >
                          <XIcon aria-hidden="true" />
                          Decline
                        </Button>
                        <Button
                          size="sm"
                          disabled={
                            acceptProjectInviteMutation.isPending &&
                            acceptProjectInviteMutation.variables === invite.id
                          }
                          onClick={() => acceptProjectInviteMutation.mutate(invite.id)}
                        >
                          <CheckIcon aria-hidden="true" />
                          Accept
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Invite member — owners only */}
            {isOwner && (
              <section className="rounded-2xl border border-border/70 bg-card px-6 py-6 shadow-xs">
                <h2 className="mb-4 text-sm font-semibold text-foreground">Invite member</h2>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                      @
                    </span>
                    <Input
                      className="pl-7"
                      placeholder="GitHub username"
                      value={inviteUsername}
                      onChange={(e) => setInviteUsername(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && inviteUsername.trim()) {
                          inviteMemberMutation.mutate();
                        }
                      }}
                    />
                  </div>
                  <Button
                    disabled={!inviteUsername.trim() || inviteMemberMutation.isPending}
                    onClick={() => inviteMemberMutation.mutate()}
                  >
                    {inviteMemberMutation.isPending ? (
                      "Inviting..."
                    ) : (
                      <>
                        <PlusIcon aria-hidden="true" />
                        Invite
                      </>
                    )}
                  </Button>
                </div>
              </section>
            )}
          </div>
        </main>
      </>
    );
  }

  // User is NOT in an org — show create or accept invites
  return (
    <>
      {pageHeader}
      <main className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-10">
        <div className="w-full max-w-2xl space-y-4">
          <div className="mb-6">
            <p className="text-sm tracking-[0.24em] text-muted-foreground/55 uppercase">
              Organisation
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
              Get started
            </h1>
          </div>

          {/* Pending invites */}
          {invites.length > 0 && (
            <section className="rounded-2xl border border-border/70 bg-card px-6 py-6 shadow-xs">
              <h2 className="mb-4 text-sm font-semibold text-foreground">Pending invites</h2>
              <div className="space-y-3">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3"
                  >
                    <BuildingIcon className="size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {invite.org.name}
                      </p>
                      <p className="text-xs text-muted-foreground">You've been invited to join</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          declineInviteMutation.isPending &&
                          declineInviteMutation.variables === invite.id
                        }
                        onClick={() => declineInviteMutation.mutate(invite.id)}
                      >
                        <XIcon aria-hidden="true" />
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        disabled={
                          acceptInviteMutation.isPending &&
                          acceptInviteMutation.variables === invite.id
                        }
                        onClick={() => acceptInviteMutation.mutate(invite.id)}
                      >
                        <CheckIcon aria-hidden="true" />
                        Accept
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Project invites */}
          {projectInvites.length > 0 && (
            <section className="rounded-2xl border border-border/70 bg-card px-6 py-6 shadow-xs">
              <h2 className="mb-4 text-sm font-semibold text-foreground">Project invites</h2>
              <div className="space-y-3">
                {projectInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      <UserPlusIcon className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {invite.project.name}
                      </p>
                      <p className="text-xs text-muted-foreground">Invited to collaborate</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          declineProjectInviteMutation.isPending &&
                          declineProjectInviteMutation.variables === invite.id
                        }
                        onClick={() => declineProjectInviteMutation.mutate(invite.id)}
                      >
                        <XIcon aria-hidden="true" />
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        disabled={
                          acceptProjectInviteMutation.isPending &&
                          acceptProjectInviteMutation.variables === invite.id
                        }
                        onClick={() => acceptProjectInviteMutation.mutate(invite.id)}
                      >
                        <CheckIcon aria-hidden="true" />
                        Accept
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Create org */}
          <section className="rounded-2xl border border-border/70 bg-card px-6 py-6 shadow-xs">
            <div className="mb-4 space-y-1">
              <h2 className="text-sm font-semibold text-foreground">Create an organisation</h2>
              <p className="text-sm text-muted-foreground">
                Set up a shared workspace and invite your team.
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="org-name">Organisation name</Label>
                <Input
                  id="org-name"
                  placeholder="My Organisation"
                  value={createOrgName}
                  onChange={(e) => setCreateOrgName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && createOrgName.trim()) {
                      createOrgMutation.mutate();
                    }
                  }}
                />
              </div>
              <Button
                className="w-full"
                disabled={!createOrgName.trim() || createOrgMutation.isPending}
                onClick={() => createOrgMutation.mutate()}
              >
                {createOrgMutation.isPending ? (
                  "Creating..."
                ) : (
                  <>
                    <PlusIcon aria-hidden="true" />
                    Create organisation
                  </>
                )}
              </Button>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
