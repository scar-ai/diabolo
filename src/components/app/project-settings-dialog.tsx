import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDownIcon, Settings2Icon, UploadIcon, UserPlusIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEventHandler,
} from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseDotEnvText, type ProjectEnvEntry } from "@/lib/project/env";
import {
  $cancelProjectInvite,
  $inviteProjectMember,
  $kickProjectMember,
  $updateProjectSettings,
} from "@/lib/project/functions";
import { projectDetailQueryOptions, projectKeys } from "@/lib/project/queries";
import {
  collaboratorKeys,
  projectCollaboratorsQueryOptions,
  projectInvitesQueryOptions,
} from "@/lib/project/queries";

type ProjectEnvDraftEntry = ProjectEnvEntry & {
  id: string;
};

const createDraftEntry = (entry?: Partial<ProjectEnvEntry>): ProjectEnvDraftEntry => ({
  id: crypto.randomUUID(),
  key: entry?.key ?? "",
  value: entry?.value ?? "",
});

export function ProjectSettingsDialog({
  currentUserId,
  disabled = false,
  onTriggerClick,
  projectId,
  projectName,
}: {
  currentUserId?: string;
  disabled?: boolean;
  onTriggerClick?: MouseEventHandler<HTMLButtonElement>;
  projectId: string | null;
  projectName: string | null;
}) {
  const queryClient = useQueryClient();
  const updateProjectSettings = useServerFn($updateProjectSettings);
  const inviteMember = useServerFn($inviteProjectMember);
  const cancelInvite = useServerFn($cancelProjectInvite);
  const kickMember = useServerFn($kickProjectMember);
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [environmentOpen, setEnvironmentOpen] = useState(true);
  const [membersOpen, setMembersOpen] = useState(false);
  const [manualEntries, setManualEntries] = useState<ProjectEnvDraftEntry[]>([createDraftEntry()]);
  const [uploadPreview, setUploadPreview] = useState("");
  const [inviteUsername, setInviteUsername] = useState("");

  const title = projectName ? `Project Settings — ${projectName}` : "Project Settings";

  const projectQuery = useQuery({
    ...projectDetailQueryOptions(projectId ?? ""),
    enabled: open && Boolean(projectId),
  });

  const collaboratorsQuery = useQuery({
    ...projectCollaboratorsQueryOptions(projectId ?? ""),
    enabled: open && membersOpen && Boolean(projectId),
  });

  const invitesQuery = useQuery({
    ...projectInvitesQueryOptions(projectId ?? ""),
    enabled: open && membersOpen && Boolean(projectId),
  });

  const isOwner = collaboratorsQuery.data?.some(
    (c) => c.userId === currentUserId && c.role === "owner",
  );

  useEffect(() => {
    if (!open) return;
    const envEntries = projectQuery.data?.envEntries ?? [];
    setEnvironmentOpen(true);
    setManualEntries(
      envEntries.length > 0
        ? envEntries.map((entry) => createDraftEntry(entry))
        : [createDraftEntry()],
    );
    setUploadPreview("");
  }, [open, projectQuery.data?.envEntries]);

  const saveMutation = useMutation({
    mutationFn: (envEntries: ProjectEnvEntry[]) => {
      if (!projectId) throw new Error("Project not found.");
      return updateProjectSettings({ data: { envEntries, projectId } });
    },
    onSuccess: async () => {
      if (projectId) {
        await queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      }
      toast.success("Project settings saved.");
      setOpen(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save project settings.");
    },
  });

  const inviteMutation = useMutation({
    mutationFn: (githubUsername: string) => {
      if (!projectId) throw new Error("Project not found.");
      return inviteMember({ data: { githubUsername, projectId } });
    },
    onSuccess: async () => {
      if (projectId) {
        await queryClient.invalidateQueries({
          queryKey: collaboratorKeys.invitesForProject(projectId),
        });
      }
      toast.success("Invitation sent.");
      setInviteUsername("");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to send invitation.");
    },
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (inviteId: string) => {
      if (!projectId) throw new Error("Project not found.");
      return cancelInvite({ data: { inviteId, projectId } });
    },
    onSuccess: async () => {
      if (projectId) {
        await queryClient.invalidateQueries({
          queryKey: collaboratorKeys.invitesForProject(projectId),
        });
      }
      toast.success("Invitation cancelled.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to cancel invitation.");
    },
  });

  const kickMutation = useMutation({
    mutationFn: (targetUserId: string) => {
      if (!projectId) throw new Error("Project not found.");
      return kickMember({ data: { targetUserId, projectId } });
    },
    onSuccess: async () => {
      if (projectId) {
        await queryClient.invalidateQueries({
          queryKey: collaboratorKeys.forProject(projectId),
        });
      }
      toast.success("Member removed.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to remove member.");
    },
  });

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const parsed = parseDotEnvText(content);
      setManualEntries(
        parsed.length > 0 ? parsed.map((entry) => createDraftEntry(entry)) : [createDraftEntry()],
      );
      setUploadPreview(file.name);
      toast.success(".env file loaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to parse .env file.");
    } finally {
      event.target.value = "";
    }
  };

  const handleSave = () => {
    saveMutation.mutate(manualEntries.map(({ key, value }) => ({ key, value })));
  };

  const updateEntry = (id: string, patch: Partial<ProjectEnvEntry>) => {
    setManualEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  };

  const removeEntry = (id: string) => {
    setManualEntries((current) => {
      const next = current.filter((entry) => entry.id !== id);
      return next.length > 0 ? next : [createDraftEntry()];
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground/72 hover:text-foreground"
            aria-label={title}
            disabled={disabled || !projectId}
            onClick={onTriggerClick}
          />
        }
      >
        <Settings2Icon className="size-4" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="max-w-2xl gap-5 p-5 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Environment section */}
          <section className="rounded-2xl border border-border">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
              onClick={() => setEnvironmentOpen((current) => !current)}
            >
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">Environment</h3>
                <p className="text-sm text-muted-foreground">
                  These variables are copied into every sandbox started from this project.
                </p>
              </div>
              <ChevronDownIcon
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                  environmentOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            {environmentOpen ? (
              <div className="space-y-4 border-t border-border px-4 py-4">
                <div className="rounded-2xl border border-border p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      ref={fileInputRef}
                      id={fileInputId}
                      type="file"
                      accept=".env,text/plain"
                      className="sr-only"
                      onChange={handleFileUpload}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <UploadIcon className="size-4" aria-hidden="true" />
                      Upload .env
                    </Button>
                    {uploadPreview ? (
                      <span className="text-xs text-muted-foreground">{uploadPreview}</span>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-3">
                  {manualEntries.map((entry, index) => (
                    <div key={entry.id} className="rounded-2xl border border-border p-4">
                      <div className="mb-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="grid gap-2">
                          <Label htmlFor={`project-env-key-${index}`}>Variable name</Label>
                          <Input
                            id={`project-env-key-${index}`}
                            value={entry.key}
                            onChange={(event) => updateEntry(entry.id, { key: event.target.value })}
                            placeholder="API_TOKEN"
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground/70 hover:text-foreground"
                            onClick={() => removeEntry(entry.id)}
                          >
                            <XIcon className="size-4" aria-hidden="true" />
                            <span className="sr-only">Remove environment variable</span>
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`project-env-value-${index}`}>Value</Label>
                        <Textarea
                          id={`project-env-value-${index}`}
                          value={entry.value}
                          onChange={(event) => updateEntry(entry.id, { value: event.target.value })}
                          placeholder="secret"
                          className="min-h-24"
                        />
                      </div>
                    </div>
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setManualEntries((current) => [...current, createDraftEntry()])}
                  >
                    Add variable
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          {/* Members section */}
          <section className="rounded-2xl border border-border">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
              onClick={() => setMembersOpen((current) => !current)}
            >
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">Collaborators</h3>
                <p className="text-sm text-muted-foreground">
                  Invite others to view sessions and run tasks in this project.
                </p>
              </div>
              <ChevronDownIcon
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                  membersOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            {membersOpen ? (
              <div className="space-y-4 border-t border-border px-4 py-4">
                {/* Current members */}
                {collaboratorsQuery.data && collaboratorsQuery.data.length > 0 ? (
                  <div className="space-y-2">
                    {collaboratorsQuery.data.map((collaborator) => {
                      const initials = (collaborator.user.name ?? "?").slice(0, 1).toUpperCase();
                      const isCurrentUser = collaborator.userId === currentUserId;

                      return (
                        <div
                          key={collaborator.userId}
                          className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="size-7 border border-border">
                              {collaborator.user.image ? (
                                <AvatarImage
                                  src={collaborator.user.image}
                                  alt={collaborator.user.name}
                                />
                              ) : null}
                              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-sm leading-none font-medium">
                                {collaborator.user.name}
                                {isCurrentUser ? (
                                  <span className="ml-1.5 text-xs text-muted-foreground">
                                    (you)
                                  </span>
                                ) : null}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={collaborator.role === "owner" ? "default" : "secondary"}
                              className="text-xs"
                            >
                              {collaborator.role}
                            </Badge>
                            {isOwner && collaborator.role !== "owner" ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground/70 hover:text-destructive"
                                disabled={kickMutation.isPending}
                                onClick={() => kickMutation.mutate(collaborator.userId)}
                              >
                                <XIcon className="size-4" aria-hidden="true" />
                                <span className="sr-only">Remove collaborator</span>
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {/* Pending invites */}
                {invitesQuery.data && invitesQuery.data.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Pending invitations
                    </p>
                    {invitesQuery.data.map((invite) => (
                      <div
                        key={invite.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border px-3 py-2.5"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="size-7 border border-border">
                            <AvatarFallback className="text-xs">
                              {invite.githubUsername.slice(0, 1).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <p className="text-sm text-muted-foreground">@{invite.githubUsername}</p>
                        </div>
                        {isOwner ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground/70 hover:text-destructive"
                            disabled={cancelInviteMutation.isPending}
                            onClick={() => cancelInviteMutation.mutate(invite.id)}
                          >
                            <XIcon className="size-4" aria-hidden="true" />
                            <span className="sr-only">Cancel invitation</span>
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Invite form (owner only) */}
                {isOwner ? (
                  <div className="flex gap-2">
                    <Input
                      placeholder="GitHub username"
                      value={inviteUsername}
                      onChange={(e) => setInviteUsername(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && inviteUsername.trim()) {
                          inviteMutation.mutate(inviteUsername.trim());
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!inviteUsername.trim() || inviteMutation.isPending}
                      onClick={() => inviteMutation.mutate(inviteUsername.trim())}
                    >
                      <UserPlusIcon className="size-4" aria-hidden="true" />
                      {inviteMutation.isPending ? "Inviting..." : "Invite"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={saveMutation.isPending} onClick={handleSave}>
            {saveMutation.isPending ? "Saving..." : "Save settings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
