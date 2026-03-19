export type GithubRepo = {
  id: string;
  name: string;
  fullName: string;
  description: string | null;
  cloneUrl: string;
  htmlUrl: string;
  ownerLogin: string;
  visibility: "public" | "private";
  defaultBranch: string;
  updatedAt: string;
};
