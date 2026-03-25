import { createMiddleware } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";

import { AuthServer } from "@/auth/server";

export namespace AuthMiddleware {
  export const auth = createMiddleware().server(async ({ next }) => {
    const user = await AuthServer.getUser();

    if (!user) {
      setResponseStatus(401);
      throw new Error("Unauthorized");
    }

    return next({ context: { user } });
  });

  export const fresh = createMiddleware().server(async ({ next }) => {
    const user = await AuthServer.getUser({
      disableCookieCache: true,
    });

    if (!user) {
      setResponseStatus(401);
      throw new Error("Unauthorized");
    }

    return next({ context: { user } });
  });
}

export const authMiddleware = AuthMiddleware.auth;
export const freshAuthMiddleware = AuthMiddleware.fresh;
