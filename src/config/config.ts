import { env as client } from "@/env/client";
import { env as server } from "@/env/server";

export namespace Config {
  export const clientEnv = client;
  export const serverEnv = server;
}
