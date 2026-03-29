import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import { db } from "@/lib/db";
import { account } from "@/lib/db/schema/schema";
import { Github } from "@/lib/github";
import { fromPromise } from "@/lib/result";

import {
  deleteProjectMember,
  findOwnedProject,
  findProjectInviteById,
  findProjectMember,
  insertProjectInvite,
  insertProjectMember,
  listProjectCollaborators,
  listProjectInvites,
  listUserProjectInvites,
  updateProjectInvite,
  type ProjectCollaborator,
  type ProjectInviteRecord,
  type ProjectInviteWithProject,
} from "./data";
import { projectInvite } from "./project.sql";

export namespace ProjectMembers {
  export type Collaborator = ProjectCollaborator;
  export type InviteRecord = ProjectInviteRecord;
  export type InviteWithProject = ProjectInviteWithProject;

  const requireOwner = (projectId: string, userId: string) =>
    fromPromise(findOwnedProject(projectId, userId)).andThen((value) =>
      value ? okAsync(value) : errAsync(new Error("Only the project owner can do this.")),
    );

  const getGithubAccountId = (userId: string): ResultAsync<string, Error> =>
    fromPromise(
      db.query.account
        .findFirst({
          where: and(eq(account.userId, userId), eq(account.providerId, "github")),
        })
        .then((row) => {
          if (!row?.accountId) throw new Error("No GitHub account linked.");
          return row.accountId;
        }),
    );

  export const getCollaborators = (projectId: string): ResultAsync<Collaborator[], Error> =>
    fromPromise(listProjectCollaborators(projectId));

  export const getPendingInvites = (projectId: string): ResultAsync<InviteRecord[], Error> =>
    fromPromise(listProjectInvites(projectId));

  export const getMyInvites = (userId: string): ResultAsync<InviteWithProject[], Error> =>
    getGithubAccountId(userId).andThen((githubUserId) =>
      fromPromise(listUserProjectInvites(githubUserId)),
    );

  export const inviteMember = (input: {
    githubUsername: string;
    projectId: string;
    userId: string;
  }): ResultAsync<InviteRecord, Error> =>
    requireOwner(input.projectId, input.userId).andThen(() =>
      Github.lookupUserByUsername(input.githubUsername)
        .andThen((ghUser) =>
          ghUser
            ? okAsync(ghUser)
            : errAsync(new Error(`GitHub user "${input.githubUsername}" not found.`)),
        )
        .andThen((ghUser) =>
          fromPromise(
            (async () => {
              // Check not already a member
              const existingAccount = await db.query.account.findFirst({
                where: and(eq(account.accountId, ghUser.id), eq(account.providerId, "github")),
              });

              if (existingAccount) {
                const existingMember = await findProjectMember(
                  input.projectId,
                  existingAccount.userId,
                );
                if (existingMember) throw new Error("This user is already a collaborator.");

                // Also check if they are the owner
                const project = await findOwnedProject(input.projectId, existingAccount.userId);
                if (project) throw new Error("This user is already the project owner.");
              }

              // Check no pending invite already
              const existingInvite = await db.query.projectInvite.findFirst({
                where: and(
                  eq(projectInvite.projectId, input.projectId),
                  eq(projectInvite.githubUserId, ghUser.id),
                  eq(projectInvite.status, "pending"),
                ),
              });
              if (existingInvite) throw new Error("A pending invite already exists for this user.");

              return insertProjectInvite({
                id: crypto.randomUUID(),
                projectId: input.projectId,
                githubUsername: ghUser.login,
                githubUserId: ghUser.id,
                invitedByUserId: input.userId,
              });
            })(),
          ),
        ),
    );

  export const cancelInvite = (input: {
    inviteId: string;
    projectId: string;
    userId: string;
  }): ResultAsync<void, Error> =>
    requireOwner(input.projectId, input.userId).andThen(() =>
      fromPromise(
        updateProjectInvite(input.inviteId, { status: "cancelled" }).then(() => undefined),
      ),
    );

  export const acceptInvite = (input: {
    inviteId: string;
    userId: string;
  }): ResultAsync<void, Error> =>
    getGithubAccountId(input.userId).andThen((githubUserId) =>
      fromPromise(
        (async () => {
          const invite = await findProjectInviteById(input.inviteId);
          if (!invite) throw new Error("Invite not found.");
          if (invite.githubUserId !== githubUserId) throw new Error("Invite not found.");
          if (invite.status !== "pending") throw new Error("Invite is no longer pending.");

          await updateProjectInvite(input.inviteId, { status: "accepted" });
          await insertProjectMember({ projectId: invite.projectId, userId: input.userId });
        })(),
      ),
    );

  export const declineInvite = (input: {
    inviteId: string;
    userId: string;
  }): ResultAsync<void, Error> =>
    getGithubAccountId(input.userId).andThen((githubUserId) =>
      fromPromise(
        (async () => {
          const invite = await findProjectInviteById(input.inviteId);
          if (!invite) throw new Error("Invite not found.");
          if (invite.githubUserId !== githubUserId) throw new Error("Invite not found.");
          if (invite.status !== "pending") throw new Error("Invite is no longer pending.");
          await updateProjectInvite(input.inviteId, { status: "declined" });
        })(),
      ),
    );

  export const kickMember = (input: {
    targetUserId: string;
    projectId: string;
    userId: string;
  }): ResultAsync<void, Error> =>
    requireOwner(input.projectId, input.userId).andThen(() => {
      if (input.targetUserId === input.userId) {
        return errAsync(new Error("You cannot remove yourself as owner."));
      }

      return fromPromise(
        deleteProjectMember(input.projectId, input.targetUserId).then(() => undefined),
      );
    });

  export const leaveProject = (input: {
    projectId: string;
    userId: string;
  }): ResultAsync<void, Error> =>
    fromPromise(findProjectMember(input.projectId, input.userId)).andThen((member) => {
      if (!member) return errAsync(new Error("You are not a member of this project."));
      return fromPromise(deleteProjectMember(input.projectId, input.userId).then(() => undefined));
    });
}
