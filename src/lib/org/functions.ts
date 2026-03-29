import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { Org } from "@/lib/org";
import { unwrap } from "@/lib/result";

const createOrgInputSchema = z.object({
  name: z.string().min(1).max(80),
});

const inviteMemberInputSchema = z.object({
  githubUsername: z.string().min(1),
  orgId: z.string().min(1),
});

const inviteIdInputSchema = z.object({
  inviteId: z.string().min(1),
});

const cancelInviteInputSchema = z.object({
  inviteId: z.string().min(1),
  orgId: z.string().min(1),
});

const memberActionInputSchema = z.object({
  targetUserId: z.string().min(1),
  orgId: z.string().min(1),
});

export const $createOrg = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => createOrgInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Org.createOrg({ name: data.name, userId: context.user.id })),
  );

export const $getMyOrg = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => unwrap(Org.getOrgForUser(context.user.id)));

export const $getMyInvites = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => unwrap(Org.getPendingInvitesForUser(context.user.id)));

export const $inviteMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => inviteMemberInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      Org.inviteMember({
        githubUsername: data.githubUsername,
        orgId: data.orgId,
        userId: context.user.id,
      }),
    ),
  );

export const $acceptInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => inviteIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Org.acceptInvite({ inviteId: data.inviteId, userId: context.user.id })),
  );

export const $declineInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => inviteIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Org.declineInvite({ inviteId: data.inviteId, userId: context.user.id })),
  );

export const $cancelInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => cancelInviteInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      Org.cancelInvite({ inviteId: data.inviteId, orgId: data.orgId, userId: context.user.id }),
    ),
  );

export const $kickMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => memberActionInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      Org.kickMember({
        targetUserId: data.targetUserId,
        orgId: data.orgId,
        userId: context.user.id,
      }),
    ),
  );

export const $promoteMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => memberActionInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      Org.promoteMember({
        targetUserId: data.targetUserId,
        orgId: data.orgId,
        userId: context.user.id,
      }),
    ),
  );
