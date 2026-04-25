import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangleIcon,
  FileIcon,
  LoaderIcon,
  SearchIcon,
  Trash2Icon,
  UploadCloudIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  startTransition,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { myOrgQueryOptions } from "@/lib/org/queries";
import { parseDotEnvText, type ProjectEnvEntry } from "@/lib/project/env";
import {
  $cancelProjectInvite,
  $deleteProject,
  $inviteProjectMember,
  $kickProjectMember,
  $searchSkills,
  $updateProjectSettings,
} from "@/lib/project/functions";
import {
  collaboratorKeys,
  projectCollaboratorsQueryOptions,
  projectDetailQueryOptions,
  projectInvitesQueryOptions,
  projectKeys,
} from "@/lib/project/queries";
import type { ProjectSkillEntry } from "@/lib/project/skills";
import type { DetectedRepoSkillEntry } from "@/lib/skills/repository";

type ProjectEnvDraftEntry = ProjectEnvEntry & { id: string };
type SkillSearchResult = ProjectSkillEntry & { installsLabel: string };
type Tab = "environment" | "skills" | "collaborators" | "danger";

type ProjectSettingsSearch = { projectId?: string };

export const Route = createFileRoute("/_auth/app/project-settings")({
  validateSearch: (search): ProjectSettingsSearch => ({
    projectId: typeof search.projectId === "string" ? search.projectId : undefined,
  }),
  component: ProjectSettingsPage,
});

const skillToProjectSkill = (skill: DetectedRepoSkillEntry): ProjectSkillEntry => ({
  installSpec: skill.installSpec ?? "",
  name: skill.name,
  source: skill.source,
  url: skill.url,
});

const createDraftEntry = (entry?: Partial<ProjectEnvEntry>): ProjectEnvDraftEntry => ({
  id: crypto.randomUUID(),
  key: entry?.key ?? "",
  value: entry?.value ?? "",
});

function ProjectSettingsPage() {
  const { user } = Route.useRouteContext();
  const { projectId } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const updateProjectSettings = useServerFn($updateProjectSettings);
  const deleteProject = useServerFn($deleteProject);
  const inviteMember = useServerFn($inviteProjectMember);
  const cancelInvite = useServerFn($cancelProjectInvite);
  const kickMember = useServerFn($kickProjectMember);
  const searchSkills = useServerFn($searchSkills);

  const fileInputId = useId();
  const orgShareCheckboxId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<Tab>("environment");
  const [manualEntries, setManualEntries] = useState<ProjectEnvDraftEntry[]>([createDraftEntry()]);
  const [selectedSkills, setSelectedSkills] = useState<ProjectSkillEntry[]>([]);
  const [skillSearch, setSkillSearch] = useState("");
  const [hasSearchedSkills, setHasSearchedSkills] = useState(false);
  const [shareWithOrganisation, setShareWithOrganisation] = useState(false);
  const [uploadPreview, setUploadPreview] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [skillSearchResults, setSkillSearchResults] = useState<SkillSearchResult[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmationStep, setDeleteConfirmationStep] = useState<"confirm" | "type-name">(
    "confirm",
  );
  const [deleteProjectNameConfirmation, setDeleteProjectNameConfirmation] = useState("");

  const projectQuery = useQuery({
    ...projectDetailQueryOptions(projectId ?? ""),
    enabled: Boolean(projectId),
  });

  const orgQuery = useQuery({
    ...myOrgQueryOptions(user.id),
    enabled: Boolean(user.id),
  });

  const collaboratorsQuery = useQuery({
    ...projectCollaboratorsQueryOptions(projectId ?? ""),
    enabled: activeTab === "collaborators" && Boolean(projectId),
  });

  const invitesQuery = useQuery({
    ...projectInvitesQueryOptions(projectId ?? ""),
    enabled: activeTab === "collaborators" && Boolean(projectId),
  });

  const isOwner = projectQuery.data?.userId === user.id;
  const currentOrg = orgQuery.data;
  const sharedOrgLabel =
    currentOrg && currentOrg.id === projectQuery.data?.sharedWithOrgId
      ? currentOrg.name
      : "your organisation";
  const isOrgOwnerForSharedProject =
    currentOrg?.id === projectQuery.data?.sharedWithOrgId &&
    currentOrg?.currentUserRole === "owner";
  const canDeleteProject = Boolean(projectQuery.data && (isOwner || isOrgOwnerForSharedProject));

  // Initialise form state from project data.
  useEffect(() => {
    if (!projectQuery.data) return;
    const envEntries = projectQuery.data.envEntries ?? [];
    startTransition(() => {
      setManualEntries(
        envEntries.length > 0
          ? envEntries.map((entry) => createDraftEntry(entry))
          : [createDraftEntry()],
      );
      setSelectedSkills(projectQuery.data.skills ?? []);
      setShareWithOrganisation(Boolean(projectQuery.data.sharedWithOrgId));
      setDeleteDialogOpen(false);
      setDeleteConfirmationStep("confirm");
      setDeleteProjectNameConfirmation("");
    });
  }, [projectQuery.data]);

  const { isPending: isSearchingSkills, mutate: runSkillSearch } = useMutation({
    mutationFn: (query: string) => searchSkills({ data: { query } }),
    onSuccess: (results) => {
      setHasSearchedSkills(true);
      setSkillSearchResults(results);
    },
    onError: (error) => {
      setHasSearchedSkills(true);
      toast.error(error instanceof Error ? error.message : "Failed to search skills.");
    },
  });

  useEffect(() => {
    if (activeTab !== "skills" || !isOwner) return;
    const trimmedQuery = skillSearch.trim();
    if (trimmedQuery.length < 2 || hasSearchedSkills) return;
    const timeoutId = window.setTimeout(() => {
      runSkillSearch(trimmedQuery);
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [activeTab, hasSearchedSkills, isOwner, runSkillSearch, skillSearch]);

  const saveMutation = useMutation({
    mutationFn: (envEntries: ProjectEnvEntry[]) => {
      if (!projectId) throw new Error("Project not found.");
      return updateProjectSettings({
        data: { envEntries, projectId, shareWithOrganisation, skills: selectedSkills },
      });
    },
    onSuccess: async () => {
      if (projectId) {
        await queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      }
      toast.success("Project settings saved.");
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

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!projectId || !projectQuery.data?.name) throw new Error("Project not found.");

      return deleteProject({
        data: {
          projectId,
          projectName: deleteProjectNameConfirmation,
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      toast.success("Project deleted.");
      navigate({ to: "/app", search: {} });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete project.");
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

  const handleSkillSearch = () => {
    if (skillSearch.trim().length < 2) {
      setHasSearchedSkills(false);
      setSkillSearchResults([]);
      return;
    }
    runSkillSearch(skillSearch.trim());
  };

  const addSkill = (skill: ProjectSkillEntry) => {
    setSelectedSkills((current) =>
      current.some((entry) => entry.installSpec === skill.installSpec)
        ? current
        : [...current, skill],
    );
  };

  const removeSkill = (installSpec: string) => {
    setSelectedSkills((current) => current.filter((skill) => skill.installSpec !== installSpec));
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

  const selectedSkillSpecs = useMemo(
    () => new Set(selectedSkills.map((skill) => skill.installSpec)),
    [selectedSkills],
  );
  const detectedRepoSkills = useMemo(
    () => projectQuery.data?.repoSkills ?? [],
    [projectQuery.data?.repoSkills],
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: "environment", label: "Environment" },
    { id: "skills", label: "Skills" },
    { id: "collaborators", label: "Collaborators" },
    { id: "danger", label: "Danger" },
  ];

  const projectName = projectQuery.data?.name ?? "Project";

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No project selected.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center border-b border-border/60 px-6">
        <h1 className="text-base font-medium text-foreground">{projectName} — Settings</h1>
      </div>

      {/* Tab bar */}
      <div className="mt-2 flex gap-1 border-b border-border/60 px-6">
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

      {/* Tab content */}
      <div className="flex-1 px-6 py-6">
        <div className="mx-auto w-full max-w-2xl space-y-5">
          {activeTab === "environment" ? (
            <>
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
            </>
          ) : null}

          {activeTab === "collaborators" ? (
            <>
              {/* Org sharing */}
              {isOwner ? (
                <div
                  className={`flex items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/40 ${!currentOrg ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <Checkbox
                    id={orgShareCheckboxId}
                    checked={shareWithOrganisation}
                    disabled={!currentOrg}
                    onCheckedChange={(checked) => setShareWithOrganisation(checked === true)}
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor={orgShareCheckboxId} className="text-sm font-medium">
                      Share with organisation
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {currentOrg
                        ? `Everyone in ${sharedOrgLabel} can open this project and its sessions.`
                        : "Join an organisation to share this project more broadly."}
                    </p>
                  </div>
                </div>
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
                      const isCurrentUser = collaborator.userId === user.id;

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
                              {collaborator.role === "owner" ? "Owner" : collaborator.role}
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

                  {isOwner && projectQuery.data?.sharedWithOrgId ? (
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                      <Badge variant="secondary" className="text-xs">
                        Organisation
                      </Badge>
                      Shared with organisation {sharedOrgLabel}
                    </div>
                  ) : null}
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
            </>
          ) : null}

          {activeTab === "skills" ? (
            <>
              <p className="text-sm text-muted-foreground">
                Selected skills are installed into `.agents/skills` in every sandbox for this
                project before OpenCode runs.
              </p>

              {isOwner ? (
                <div className="space-y-3 rounded-xl border border-border p-4">
                  <div className="space-y-2">
                    <Label htmlFor="skill-search">Search skills</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/60" />
                        <Input
                          id="skill-search"
                          value={skillSearch}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setSkillSearch(nextValue);
                            setHasSearchedSkills(false);
                            setSkillSearchResults([]);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              handleSkillSearch();
                            }
                          }}
                          placeholder="Search skills.sh"
                          className="pl-9"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-background">
                    {isSearchingSkills ? (
                      <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
                        <LoaderIcon className="size-4 animate-spin" />
                        Searching skills…
                      </div>
                    ) : skillSearch.length < 2 && skillSearchResults.length === 0 ? (
                      <div className="px-4 py-6 text-sm text-muted-foreground">
                        Search by keyword to add skills from skills.sh.
                      </div>
                    ) : hasSearchedSkills && skillSearchResults.length === 0 ? (
                      <div className="px-4 py-6 text-sm text-muted-foreground">
                        No skills matched that search.
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {skillSearchResults.map((skill) => {
                          const isSelected = selectedSkillSpecs.has(skill.installSpec);
                          return (
                            <div
                              key={skill.installSpec}
                              className="flex items-start justify-between gap-3 px-4 py-3"
                            >
                              <div className="min-w-0 space-y-1">
                                <p className="text-sm font-medium">{skill.name}</p>
                                <p className="text-xs text-muted-foreground">{skill.source}</p>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <Badge variant="secondary" className="text-[11px]">
                                    {skill.installsLabel}
                                  </Badge>
                                  <a
                                    href={skill.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-4"
                                  >
                                    View listing
                                  </a>
                                </div>
                              </div>
                              <Button
                                variant={isSelected ? "secondary" : "outline"}
                                size="sm"
                                disabled={isSelected}
                                onClick={() => addSkill(skill)}
                              >
                                {isSelected ? "Added" : "Add"}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="px-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Detected in repository
                </p>
                <div className="overflow-hidden rounded-xl border border-border">
                  {detectedRepoSkills.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      No installed repo skills were detected.
                    </div>
                  ) : (
                    detectedRepoSkills.map((skill, index) => {
                      const installSpec = skill.installSpec;
                      const isSelected = installSpec ? selectedSkillSpecs.has(installSpec) : false;
                      return (
                        <div
                          key={`${skill.name}:${skill.source}:${skill.detectedFrom}`}
                          className={`flex items-start justify-between gap-3 px-4 py-3 ${
                            index !== 0 ? "border-t border-border" : ""
                          }`}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">{skill.name}</p>
                              <Badge variant="secondary" className="text-[11px]">
                                {skill.detectedFrom === "skills_lock"
                                  ? "skills-lock.json"
                                  : ".agents/skills"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{skill.source}</p>
                            {skill.url ? (
                              <a
                                href={skill.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-muted-foreground underline underline-offset-4"
                              >
                                View source
                              </a>
                            ) : null}
                          </div>
                          {isOwner ? (
                            installSpec ? (
                              <Button
                                variant={isSelected ? "secondary" : "outline"}
                                size="sm"
                                disabled={isSelected}
                                onClick={() => addSkill(skillToProjectSkill(skill))}
                              >
                                {isSelected ? "Added" : "Add"}
                              </Button>
                            ) : (
                              <Badge variant="outline" className="shrink-0 text-[11px]">
                                Repo only
                              </Badge>
                            )
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="px-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Selected for this project
                </p>
                <div className="overflow-hidden rounded-xl border border-border">
                  {selectedSkills.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      No project skills selected.
                    </div>
                  ) : (
                    selectedSkills.map((skill, index) => (
                      <div
                        key={skill.installSpec}
                        className={`flex items-start justify-between gap-3 px-4 py-3 ${
                          index !== 0 ? "border-t border-border" : ""
                        }`}
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium">{skill.name}</p>
                          <p className="text-xs text-muted-foreground">{skill.source}</p>
                        </div>
                        {isOwner ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground/60 hover:text-foreground"
                            onClick={() => removeSkill(skill.installSpec)}
                          >
                            <XIcon className="size-4" aria-hidden="true" />
                            <span className="sr-only">Remove skill</span>
                          </Button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {!isOwner ? (
                <p className="text-xs text-muted-foreground">
                  Only the project owner can change which skills are installed for this project.
                </p>
              ) : null}
            </>
          ) : null}

          {activeTab === "danger" ? (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                Destructive actions for this project live here.
              </p>

              {canDeleteProject && projectQuery.data ? (
                <div className="space-y-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Delete project</p>
                    <p className="text-sm text-muted-foreground">
                      Permanently removes this project and every session inside it.
                    </p>
                    {projectQuery.data.sharedWithOrgId && !isOwner ? (
                      <p className="text-xs text-muted-foreground">
                        Allowed because you are a promoted organisation member.
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2Icon className="size-4" aria-hidden="true" />
                    Delete project
                  </Button>
                </div>
              ) : (
                <div className="rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
                  You do not have permission to delete this project.
                </div>
              )}
            </div>
          ) : null}

          {/* Save bar */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() =>
                navigate({ to: "/app", search: { projectId: projectId ?? undefined } })
              }
            >
              Cancel
            </Button>
            <Button disabled={!isOwner || saveMutation.isPending} onClick={handleSave}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(nextOpen) => {
          setDeleteDialogOpen(nextOpen);
          if (!nextOpen) {
            setDeleteConfirmationStep("confirm");
            setDeleteProjectNameConfirmation("");
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <AlertTriangleIcon aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {deleteConfirmationStep === "confirm"
                ? "Delete project?"
                : `Type “${projectQuery.data?.name ?? "project"}” to confirm`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmationStep === "confirm"
                ? `This permanently removes ${projectQuery.data?.name ?? "this project"} and its sessions.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteConfirmationStep === "type-name" ? (
            <div className="space-y-2">
              <Label htmlFor="delete-project-name-confirmation-page" className="text-sm">
                Project name
              </Label>
              <Input
                id="delete-project-name-confirmation-page"
                value={deleteProjectNameConfirmation}
                onChange={(event) => setDeleteProjectNameConfirmation(event.target.value)}
                placeholder={projectQuery.data?.name ?? ""}
                autoComplete="off"
              />
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            {deleteConfirmationStep === "confirm" ? (
              <AlertDialogAction
                variant="destructive"
                onClick={() => setDeleteConfirmationStep("type-name")}
              >
                Continue
              </AlertDialogAction>
            ) : (
              <Button
                variant="destructive"
                disabled={
                  deleteMutation.isPending ||
                  deleteProjectNameConfirmation !== (projectQuery.data?.name ?? "")
                }
                onClick={() => deleteMutation.mutate()}
              >
                {deleteMutation.isPending ? (
                  <LoaderIcon className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  "Delete project"
                )}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
