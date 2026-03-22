export type SandboxCommandOptions = {
  cwd?: string;
  envVars?: Record<string, string>;
  timeoutSeconds?: number;
};

export type SandboxCommandResult = {
  exitCode: number;
  output: string;
};

export type CloneRepositoryOptions = {
  accessToken: string;
  branch: string;
  ownerLogin: string;
  targetPath: string;
  url: string;
};

export interface SandboxSession {
  id: string;
  name: string;
  cloneRepository(options: CloneRepositoryOptions): Promise<void>;
  delete(timeoutSeconds?: number): Promise<void>;
  executeCommand(command: string, options?: SandboxCommandOptions): Promise<SandboxCommandResult>;
  getWorkspaceRoot(): Promise<string>;
  stop(timeoutSeconds?: number): Promise<void>;
}

export interface SandboxProvider {
  createWorkspace(repoName: string): Promise<SandboxSession>;
  destroyWorkspace(id: string): Promise<void>;
  formatError(error: unknown): string;
  getWorkspace(id: string): Promise<SandboxSession>;
}
