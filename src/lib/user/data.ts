import { and, asc, desc, eq, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { organisationMember, userLlmProvider } from "@/lib/db/schema";

const getMembership = (userId: string) =>
  db.query.organisationMember.findFirst({
    where: eq(organisationMember.userId, userId),
  });

export const listUserLlmProviders = (userId: string) =>
  getMembership(userId).then((membership) =>
    db.query.userLlmProvider.findMany({
      orderBy: [
        desc(userLlmProvider.isDefault),
        asc(userLlmProvider.name),
        asc(userLlmProvider.id),
      ],
      where: or(
        eq(userLlmProvider.userId, userId),
        membership ? eq(userLlmProvider.orgId, membership.orgId) : undefined,
      ),
    }),
  );

export const findUserLlmProvider = (userId: string, providerId: string) =>
  getMembership(userId).then((membership) =>
    db.query.userLlmProvider.findFirst({
      where: and(
        eq(userLlmProvider.id, providerId),
        or(
          eq(userLlmProvider.userId, userId),
          membership ? eq(userLlmProvider.orgId, membership.orgId) : undefined,
        ),
      ),
    }),
  );
