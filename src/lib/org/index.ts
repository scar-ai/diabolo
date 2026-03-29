import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import { db } from "@/lib/db";
import { account } from "@/lib/db/schema/schema";
import { Github } from "@/lib/github";
import { fromPromise } from "@/lib/result";

import { organisation, organisationInvite, organisationMember } from "./org.sql";

export namespace Org {
  export type OrgRecord = typeof organisation.$inferSelect;
  export type MemberRecord = typeof organisationMember.$inferSelect;
  export type InviteRecord = typeof organisationInvite.$inferSelect;

  export type OrgDetail = OrgRecord & {
    members: Array<MemberRecord & { user: { id: string; name: string; image: string | null } }>;
    pendingInvites: InviteRecord[];
    currentUserRole: "owner" | "member";
  };

  export type PendingInvite = InviteRecord & {
    org: { id: string; name: string };
  };

  // Get the GitHub account ID for a user
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

  export const createOrg = (input: {
    name: string;
    userId: string;
  }): ResultAsync<OrgRecord, Error> =>
    fromPromise(
      (async () => {
        const id = crypto.randomUUID();
        const [org] = await db
          .insert(organisation)
          .values({ id, name: input.name, ownerId: input.userId })
          .returning();

        await db.insert(organisationMember).values({
          orgId: id,
          userId: input.userId,
          role: "owner",
        });

        return org;
      })(),
    );

  export const getOrgForUser = (userId: string): ResultAsync<OrgDetail | null, Error> =>
    fromPromise(
      (async () => {
        const membership = await db.query.organisationMember.findFirst({
          where: eq(organisationMember.userId, userId),
          with: {
            org: {
              with: {
                members: {
                  with: { user: { columns: { id: true, name: true, image: true } } },
                },
                invites: true,
              },
            },
          },
        });

        if (!membership) return null;

        const { org } = membership;
        const pendingInvites = org.invites.filter((i) => i.status === "pending");

        return {
          ...org,
          members: org.members,
          pendingInvites,
          currentUserRole: membership.role as "owner" | "member",
        };
      })(),
    );

  export const getPendingInvitesForUser = (userId: string): ResultAsync<PendingInvite[], Error> =>
    getGithubAccountId(userId).andThen((githubUserId) =>
      fromPromise(
        db.query.organisationInvite
          .findMany({
            where: and(
              eq(organisationInvite.githubUserId, githubUserId),
              eq(organisationInvite.status, "pending"),
            ),
            with: { org: { columns: { id: true, name: true } } },
          })
          .then((rows) => rows as PendingInvite[]),
      ),
    );

  export const inviteMember = (input: {
    githubUsername: string;
    orgId: string;
    userId: string;
  }): ResultAsync<InviteRecord, Error> => {
    // Verify the current user is an owner
    const checkOwner = fromPromise(
      db.query.organisationMember
        .findFirst({
          where: and(
            eq(organisationMember.orgId, input.orgId),
            eq(organisationMember.userId, input.userId),
          ),
        })
        .then((member) => {
          if (!member || member.role !== "owner")
            throw new Error("Only owners can invite members.");
          return member;
        }),
    );

    const lookupGithubUser = Github.lookupUserByUsername(input.githubUsername).andThen((ghUser) =>
      ghUser
        ? okAsync(ghUser)
        : errAsync(new Error(`GitHub user "${input.githubUsername}" not found.`)),
    );

    return checkOwner.andThen(() =>
      lookupGithubUser.andThen((ghUser) =>
        fromPromise(
          (async () => {
            // Check not already a member via GitHub ID
            const existingAccount = await db.query.account.findFirst({
              where: and(eq(account.accountId, ghUser.id), eq(account.providerId, "github")),
            });

            if (existingAccount) {
              const existingMember = await db.query.organisationMember.findFirst({
                where: and(
                  eq(organisationMember.orgId, input.orgId),
                  eq(organisationMember.userId, existingAccount.userId),
                ),
              });
              if (existingMember) throw new Error("This user is already a member.");
            }

            // Check no pending invite already
            const existingInvite = await db.query.organisationInvite.findFirst({
              where: and(
                eq(organisationInvite.orgId, input.orgId),
                eq(organisationInvite.githubUserId, ghUser.id),
                eq(organisationInvite.status, "pending"),
              ),
            });
            if (existingInvite) throw new Error("An invite for this user already exists.");

            const [invite] = await db
              .insert(organisationInvite)
              .values({
                id: crypto.randomUUID(),
                orgId: input.orgId,
                githubUsername: ghUser.login,
                githubUserId: ghUser.id,
                invitedByUserId: input.userId,
                status: "pending",
              })
              .returning();

            return invite;
          })(),
        ),
      ),
    );
  };

  export const acceptInvite = (input: {
    inviteId: string;
    userId: string;
  }): ResultAsync<void, Error> =>
    getGithubAccountId(input.userId).andThen((githubUserId) =>
      fromPromise(
        (async () => {
          const invite = await db.query.organisationInvite.findFirst({
            where: and(
              eq(organisationInvite.id, input.inviteId),
              eq(organisationInvite.githubUserId, githubUserId),
              eq(organisationInvite.status, "pending"),
            ),
          });

          if (!invite) throw new Error("Invite not found.");

          await db
            .update(organisationInvite)
            .set({ status: "accepted" })
            .where(eq(organisationInvite.id, input.inviteId));

          await db.insert(organisationMember).values({
            orgId: invite.orgId,
            userId: input.userId,
            role: "member",
          });
        })(),
      ),
    );

  export const declineInvite = (input: {
    inviteId: string;
    userId: string;
  }): ResultAsync<void, Error> =>
    getGithubAccountId(input.userId).andThen((githubUserId) =>
      fromPromise(
        db
          .update(organisationInvite)
          .set({ status: "declined" })
          .where(
            and(
              eq(organisationInvite.id, input.inviteId),
              eq(organisationInvite.githubUserId, githubUserId),
              eq(organisationInvite.status, "pending"),
            ),
          )
          .then(() => undefined),
      ),
    );

  export const cancelInvite = (input: {
    inviteId: string;
    orgId: string;
    userId: string;
  }): ResultAsync<void, Error> =>
    fromPromise(
      (async () => {
        const member = await db.query.organisationMember.findFirst({
          where: and(
            eq(organisationMember.orgId, input.orgId),
            eq(organisationMember.userId, input.userId),
          ),
        });
        if (!member || member.role !== "owner") throw new Error("Only owners can cancel invites.");

        await db
          .update(organisationInvite)
          .set({ status: "declined" })
          .where(
            and(
              eq(organisationInvite.id, input.inviteId),
              eq(organisationInvite.orgId, input.orgId),
              eq(organisationInvite.status, "pending"),
            ),
          );
      })(),
    );

  export const kickMember = (input: {
    targetUserId: string;
    orgId: string;
    userId: string;
  }): ResultAsync<void, Error> =>
    fromPromise(
      (async () => {
        const member = await db.query.organisationMember.findFirst({
          where: and(
            eq(organisationMember.orgId, input.orgId),
            eq(organisationMember.userId, input.userId),
          ),
        });
        if (!member || member.role !== "owner") throw new Error("Only owners can kick members.");
        if (input.targetUserId === input.userId) throw new Error("You cannot kick yourself.");

        await db
          .delete(organisationMember)
          .where(
            and(
              eq(organisationMember.orgId, input.orgId),
              eq(organisationMember.userId, input.targetUserId),
            ),
          );
      })(),
    );

  export const promoteMember = (input: {
    targetUserId: string;
    orgId: string;
    userId: string;
  }): ResultAsync<void, Error> =>
    fromPromise(
      (async () => {
        const member = await db.query.organisationMember.findFirst({
          where: and(
            eq(organisationMember.orgId, input.orgId),
            eq(organisationMember.userId, input.userId),
          ),
        });
        if (!member || member.role !== "owner") throw new Error("Only owners can promote members.");
        if (input.targetUserId === input.userId) throw new Error("You are already an owner.");

        await db
          .update(organisationMember)
          .set({ role: "owner" })
          .where(
            and(
              eq(organisationMember.orgId, input.orgId),
              eq(organisationMember.userId, input.targetUserId),
            ),
          );
      })(),
    );
}
