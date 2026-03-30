import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileIcon, Settings2Icon, UploadCloudIcon, UserPlusIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEventHandler,
} from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { myOrgQueryOptions } from "@/lib/org/queries";
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

type Tab = "environment" | "collaborators";

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
  const [activeTab, setActiveTab] = useState<Tab>("environment");
  const [manualEntries, setManualEntries] = useState<ProjectEnvDraftEntry[]>([createDraftEntry()]);
  const [shareWithOrganisation, setShareWithOrganisation] = useState(false);
  const [uploadPreview, setUploadPreview] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");

  const title = projectName ? `${projectName}` : "Project Settings";

  const projectQuery = useQuery({
    ...projectDetailQueryOptions(projectId ?? ""),
    enabled: open && Boolean(projectId),
  });

  const orgQuery = useQuery({
    ...myOrgQueryOptions(currentUserId ?? ""),
    enabled: open && Boolean(currentUserId),
  });

  const collaboratorsQuery = useQuery({
    ...projectCollaboratorsQueryOptions(projectId ?? ""),
    enabled: open && activeTab === "collaborators" && Boolean(projectId),
  });

  const invitesQuery = useQuery({
    ...projectInvitesQueryOptions(projectId ?? ""),
    enabled: open && activeTab === "collaborators" && Boolean(projectId),
  });

  const isOwner = projectQuery.data?.userId === currentUserId;

  useEffect(() => {
    if (!open) return;
    const envEntries = projectQuery.data?.envEntries ?? [];
    setActiveTab("environment");
    setManualEntries(
      envEntries.length > 0
        ? envEntries.map((entry) => createDraftEntry(entry))
        : [createDraftEntry()],
    );
    setShareWithOrganisation(Boolean(projectQuery.data?.sharedWithOrgId));
    setUploadPreview("");
  }, [open, projectQuery.data?.envEntries, projectQuery.data?.sharedWithOrgId]);

  const saveMutation = useMutation({
    mutationFn: (envEntries: ProjectEnvEntry[]) => {
      if (!projectId) throw new Error("Project not found.");
      return updateProjectSettings({ data: { envEntries, projectId, shareWithOrganisation } });
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

  const processEnvFile = async (file: File) => {
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
    }
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await processEnvFile(file);
    event.target.value = "";
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await processEnvFile(file);
  };

  const handleSave = () => {
    saveMutation.mutate(manualEntries.map(({ key, value }) => ({ key, value })));
  };

  const currentOrg = orgQuery.data;
  const sharedOrgLabel =
    currentOrg && currentOrg.id === projectQuery.data?.sharedWithOrgId
      ? currentOrg.name
      : "your organisation";

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

  const tabs: { id: Tab; label: string }[] = [
    { id: "environment", label: "Environment" },
    { id: "collaborators", label: "Collaborators" },
  ];

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

      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* Header */}
        <DialogHeader className="border-b border-border px-6 pt-6 pb-0">
          <DialogTitle className="text-base font-semibold">{title} — Settings</DialogTitle>

          {/* Tab bar */}
          <div className="mt-4 flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-3 pt-1 pb-3 text-sm font-medium transition-colors focus-visible:outline-none ${
                  activeTab === tab.id
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                {activeTab === tab.id ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-foreground" />
                ) : null}
              </button>
            ))}
          </div>
        </DialogHeader>

        {/* Tab content */}
        <div className="min-h-0 overflow-y-auto px-6 py-5" style={{ maxHeight: "60vh" }}>
          {activeTab === "environment" ? (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                These variables are injected into every sandbox started from this project.
              </p>

              {/* Drop zone */}
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                accept=".env,text/plain"
                className="sr-only"
                onChange={handleFileUpload}
              />
              <button
                type="button"
                disabled={!isOwner}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 ${
                  isDragging
                    ? "border-foreground/40 bg-muted/60"
                    : "border-border hover:border-foreground/25 hover:bg-muted/30"
                }`}
              >
                {uploadPreview ? (
                  <>
                    <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                      <FileIcon className="size-5 text-foreground/70" aria-hidden="true" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">{uploadPreview}</p>
                      <p className="text-xs text-muted-foreground">
                        Click or drop a file to replace
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      className={`flex size-10 items-center justify-center rounded-full transition-colors ${isDragging ? "bg-foreground/10" : "bg-muted"}`}
                    >
                      <UploadCloudIcon
                        className={`size-5 transition-colors ${isDragging ? "text-foreground" : "text-muted-foreground"}`}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">
                        {isDragging ? "Drop to load" : "Drop a .env file here"}
                      </p>
                      <p className="text-xs text-muted-foreground">Or click to browse</p>
                    </div>
                  </>
                )}
              </button>

              {/* OR divider */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-medium text-muted-foreground">OR</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Manual entries */}
              <div className="space-y-3">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Add variables manually
                </p>

                {/* Column headers */}
                <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 px-0.5">
                  <span className="text-xs text-muted-foreground">Variable</span>
                  <span className="text-xs text-muted-foreground">Value</span>
                  <span className="w-7" />
                </div>

                <div className="space-y-2">
                  {manualEntries.map((entry) => (
                    <div key={entry.id} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
                      <Input
                        value={entry.key}
                        disabled={!isOwner}
                        onChange={(event) => updateEntry(entry.id, { key: event.target.value })}
                        placeholder="API_TOKEN"
                        className="font-mono text-sm"
                      />
                      <Textarea
                        value={entry.value}
                        disabled={!isOwner}
                        onChange={(event) => updateEntry(entry.id, { value: event.target.value })}
                        placeholder="Value"
                        className="min-h-9 resize-none font-mono text-sm"
                        rows={1}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="mt-0.5 text-muted-foreground/60 hover:text-foreground"
                        disabled={!isOwner}
                        onClick={() => removeEntry(entry.id)}
                      >
                        <XIcon className="size-4" aria-hidden="true" />
                        <span className="sr-only">Remove variable</span>
                      </Button>
                    </div>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isOwner}
                  onClick={() => setManualEntries((current) => [...current, createDraftEntry()])}
                >
                  Add variable
                </Button>
              </div>

              {!isOwner ? (
                <p className="text-xs text-muted-foreground">
                  Only the project owner can edit environment variables.
                </p>
              ) : null}
            </div>
          ) : null}

          {activeTab === "collaborators" ? (
            <div className="space-y-5">
              {/* Org sharing */}
              {isOwner ? (
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/40 ${!currentOrg ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <Checkbox
                    checked={shareWithOrganisation}
                    disabled={!currentOrg}
                    onCheckedChange={(checked) => setShareWithOrganisation(checked === true)}
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Share with organisation</p>
                    <p className="text-sm text-muted-foreground">
                      {currentOrg
                        ? `Everyone in ${sharedOrgLabel} can open this project and its sessions.`
                        : "Join an organisation to share this project more broadly."}
                    </p>
                  </div>
                </label>
              ) : projectQuery.data?.sharedWithOrgId ? (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                  <Badge variant="secondary" className="text-xs">
                    Organisation
                  </Badge>
                  Shared with {sharedOrgLabel}.
                </div>
              ) : null}

              {/* Member list */}
              {collaboratorsQuery.data && collaboratorsQuery.data.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="px-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Members
                  </p>
                  <div className="overflow-hidden rounded-xl border border-border">
                    {collaboratorsQuery.data.map((collaborator, i) => {
                      const initials = (collaborator.user.name ?? "?").slice(0, 1).toUpperCase();
                      const isCurrentUser = collaborator.userId === currentUserId;

                      return (
                        <div
                          key={collaborator.userId}
                          className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                            i !== 0 ? "border-t border-border" : ""
                          }`}
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
                            <p className="text-sm font-medium">
                              {collaborator.user.name}
                              {isCurrentUser ? (
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                  You
                                </span>
                              ) : null}
                            </p>
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
                                className="text-muted-foreground/60 hover:text-destructive"
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
                </div>
              ) : null}

              {/* Pending invites */}
              {invitesQuery.data && invitesQuery.data.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="px-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Pending invitations
                  </p>
                  <div className="overflow-hidden rounded-xl border border-dashed border-border">
                    {invitesQuery.data.map((invite, i) => (
                      <div
                        key={invite.id}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                          i !== 0 ? "border-t border-dashed border-border" : ""
                        }`}
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
                            className="text-muted-foreground/60 hover:text-destructive"
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
                </div>
              ) : null}

              {/* Invite form */}
              {isOwner ? (
                <div className="space-y-2">
                  <p className="px-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Invite by GitHub username
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Username"
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
                      {inviteMutation.isPending ? "Inviting…" : "Invite"}
                    </Button>
                  </div>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Invited members must have access to the GitHub repository to start tasks.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!isOwner || saveMutation.isPending} onClick={handleSave}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
