import { relations } from "drizzle-orm";
import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "@/lib/db/schema/schema";

export const organisation = pgTable("organisation", {
  id: text().primaryKey(),
  name: text().notNull(),
  ownerId: text()
    .notNull()
    .references(() => user.id),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const organisationMember = pgTable(
  "organisation_member",
  {
    orgId: text()
      .notNull()
      .references(() => organisation.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().notNull().default("member"),
    joinedAt: timestamp().defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    index("org_member_userId_idx").on(table.userId),
  ],
);

export const organisationInvite = pgTable(
  "organisation_invite",
  {
    id: text().primaryKey(),
    orgId: text()
      .notNull()
      .references(() => organisation.id, { onDelete: "cascade" }),
    githubUsername: text().notNull(),
    githubUserId: text().notNull(),
    invitedByUserId: text()
      .notNull()
      .references(() => user.id),
    status: text().notNull().default("pending"),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("org_invite_orgId_idx").on(table.orgId),
    index("org_invite_githubUserId_idx").on(table.githubUserId),
  ],
);

export const organisationRelations = relations(organisation, ({ many, one }) => ({
  invites: many(organisationInvite),
  members: many(organisationMember),
  owner: one(user, { fields: [organisation.ownerId], references: [user.id] }),
}));

export const organisationMemberRelations = relations(organisationMember, ({ one }) => ({
  org: one(organisation, { fields: [organisationMember.orgId], references: [organisation.id] }),
  user: one(user, { fields: [organisationMember.userId], references: [user.id] }),
}));

export const organisationInviteRelations = relations(organisationInvite, ({ one }) => ({
  invitedBy: one(user, {
    fields: [organisationInvite.invitedByUserId],
    references: [user.id],
  }),
  org: one(organisation, {
    fields: [organisationInvite.orgId],
    references: [organisation.id],
  }),
}));
