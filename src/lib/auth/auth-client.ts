import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient({
  basePath: "/api/auth",
});

export default authClient;
