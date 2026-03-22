export type SandboxTaskInput = {
  prompt: string;
  quickTask: boolean;
  repoId: string;
  sourceBranch: string;
};

export type SandboxTaskStatus = "queued" | "running" | "succeeded" | "failed";

export type AgentMessage = {
  text: string;
  timestamp: number;
};

export type FollowUpEntry = {
  completedAt?: string;
  error?: string;
  id: string;
  logs?: string;
  prompt: string;
  responseMessages: AgentMessage[];
  stage: string;
  startedAt: string;
  status: SandboxTaskStatus;
};

export type SandboxTaskJob = {
  agentMessages: AgentMessage[];
  branchName?: string;
  sandboxPath?: string;
  completedAt?: string;
  error?: string;
  followUpHistory: FollowUpEntry[];
  id: string;
  logs?: string;
  prNumber?: number;
  prUrl?: string;
  prompt: string;
  quickTask: boolean;
  repoId: string;
  repoName?: string;
  repoUrl?: string;
  sourceBranch: string;
  userId: string;
  sandboxId?: string;
  sandboxName?: string;
  stage: string;
  startedAt: string;
  status: SandboxTaskStatus;
};

const FRONTEND_TASK_PATTERN =
  /\b(frontend|ui|ux|browser|screenshot|screen shot|visual|css|tailwind|layout|responsive|component|shadcn|page|modal|dialog|dropdown|form|button|input|navbar|sidebar|header|footer|computer use|computer-use|desktop|gui|click|type|typing|keyboard|mouse|preview|daytona mcp|use daytona|daytona tool|sandbox browser|open the browser|open browser|checkout the file|check out the file)\b/i;

export const isFrontendTaskPrompt = (prompt: string) => FRONTEND_TASK_PATTERN.test(prompt);
