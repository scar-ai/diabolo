/** Standard JSON error response for API routes. */
export const badRequest = (error: string, status = 400) => Response.json({ error }, { status });

/** Extract a trimmed string field from FormData. */
export const getFormString = (formData: FormData, field: string) => {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
};

/**
 * Authenticate request via BetterAuth session.
 * Returns the user or null if not authenticated.
 */
export const requireApiUser = async (request: Request) => {
  const { auth } = await import("@/lib/auth/auth");
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
};
