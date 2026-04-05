import { db } from "@/lib/db";

export const findUserProviderSettings = (userId: string) =>
  db.query.userProviderSettings.findFirst({
    where: (table, { eq }) => eq(table.userId, userId),
  });
