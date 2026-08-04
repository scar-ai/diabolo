import type { JsonObject } from "@/lib/json";
import type { Project } from "@/lib/project";

type ParsedAgentMessage = { text: string; timestamp: number };
type ParsedTaskEvent = {
  createdAt: Date | string;
  id: string;
  messageId: string | null;
  payload: JsonObject;
  sequence: number;
  type: string;
};

type ParsedTaskArtifact = {
  createdAt: Date | string;
  id: string;
  messageId: string | null;
  metadata: JsonObject | null;
  type: string;
  url: string;
};

type ParsedConversationMessage = {
  artifacts: ParsedTaskArtifact[];
  completedAt?: Date | string | null;
  createdByUserId?: string | null;
  error?: string | null;
  id: string;
  kind: string;
  logs?: string | null;
  prompt: string;
  responseMessages: ParsedAgentMessage[];
  runtimeEvents: ParsedTaskEvent[];
  sequence: number;
  stage: string;
  startedAt: Date | string;
  status: string;
};

type ParsedLegacyFollowUp = {
  completedAt?: string;
  error?: string;
  id: string;
  logs?: string;
  prompt: string;
  responseMessages: ParsedAgentMessage[];
  stage: string;
  startedAt: string;
  status: string;
};

const parseAgentMessages = (raw: string | null | undefined): ParsedAgentMessage[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseFollowUpHistory = (raw: string | null | undefined): ParsedLegacyFollowUp[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is ParsedLegacyFollowUp =>
            typeof entry?.id === "string" &&
            typeof entry?.prompt === "string" &&
            typeof entry?.stage === "string" &&
            typeof entry?.startedAt === "string" &&
            Array.isArray(entry?.responseMessages) &&
            typeof entry?.status === "string",
        )
      : [];
  } catch {
    return [];
  }
};

const selectParsedTaskDetail = (task: Project.TaskDetailRecord) => {
  const events: ParsedTaskEvent[] = task.events.map((event) => ({
    createdAt: event.createdAt,
    id: event.id,
    messageId: event.messageId,
    payload: event.parsedPayload,
    sequence: event.sequence,
    type: event.type,
  }));
  const artifacts: ParsedTaskArtifact[] = task.artifacts.map((artifact) => ({
    createdAt: artifact.createdAt,
    id: artifact.id,
    messageId: artifact.messageId,
    metadata: artifact.parsedMetadata,
    type: artifact.type,
    url: artifact.url,
  }));

  const conversation: ParsedConversationMessage[] =
    task.messages.length > 0
      ? task.messages.map((message) => ({
          artifacts: artifacts.filter((artifact) => artifact.messageId === message.id),
          completedAt: message.completedAt,
          createdByUserId: message.createdByUserId,
          error: message.error,
          id: message.id,
          kind: message.kind,
          logs: message.logs,
          prompt: message.prompt,
          // The agent's text is streamed into the message record itself rather
          // than into event rows, so this is its single source of truth.
          responseMessages: parseAgentMessages(message.responseMessages),
          runtimeEvents: events.filter((event) => event.messageId === message.id),
          sequence: message.sequence,
          stage: message.stage,
          startedAt: message.startedAt,
          status: message.status,
        }))
      : [];

  const initialMessage = conversation[0] ?? null;
  const pullRequestArtifact =
    artifacts.find((artifact) => artifact.type === "pull_request") ?? null;
  const branchArtifact = artifacts.find((artifact) => artifact.type === "branch") ?? null;
  const derivedPrUrl =
    task.prUrl ||
    (typeof pullRequestArtifact?.metadata?.prUrl === "string"
      ? pullRequestArtifact.metadata.prUrl
      : (pullRequestArtifact?.url ?? null));
  const derivedPrNumber =
    task.prNumber ??
    (typeof pullRequestArtifact?.metadata?.prNumber === "number"
      ? pullRequestArtifact.metadata.prNumber
      : null);
  const derivedBranchName =
    task.branchName ||
    (typeof branchArtifact?.metadata?.branchName === "string"
      ? branchArtifact.metadata.branchName
      : (branchArtifact?.url ?? null));
  const parsedAgentMessages = initialMessage?.responseMessages.length
    ? initialMessage.responseMessages
    : parseAgentMessages(task.agentMessages);
  const followUps =
    conversation.length > 0
      ? conversation.slice(1)
      : parseFollowUpHistory(task.followUpHistory).map((entry, index) => ({
          artifacts: [],
          completedAt: entry.completedAt,
          createdByUserId: null,
          error: entry.error,
          id: entry.id,
          kind: "follow_up",
          logs: entry.logs,
          prompt: entry.prompt,
          responseMessages: entry.responseMessages,
          runtimeEvents: [],
          sequence: index + 1,
          stage: entry.stage,
          startedAt: entry.startedAt,
          status: entry.status,
        }));

  return {
    ...task,
    branchName: derivedBranchName,
    events,
    artifacts,
    logs: initialMessage?.logs ?? task.logs ?? null,
    parsedAgentMessages,
    parsedConversation: conversation,
    parsedFollowUpHistory: followUps,
    prNumber: derivedPrNumber,
    prUrl: derivedPrUrl,
  };
};

export type TaskDetailResult = ReturnType<typeof selectParsedTaskDetail>;
export { selectParsedTaskDetail };
export type { ParsedAgentMessage, ParsedTaskArtifact, ParsedTaskEvent };
