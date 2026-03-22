import * as z from "zod";

import { Log } from "@/lib/log";

const log = Log.create({ ns: "fn" });

export function fn<T extends z.ZodType, Result>(schema: T, cb: (input: z.infer<T>) => Result) {
  const result = (input: z.infer<T>) => {
    const parsed = schema.safeParse(input);

    if (!parsed.success) {
      log.warn("schema validation failed", { issues: parsed.error.issues });
      throw parsed.error;
    }

    return cb(parsed.data);
  };
  result.force = (input: z.infer<T>) => cb(input);
  result.schema = schema;
  return result;
}
