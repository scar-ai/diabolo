import * as z from "zod";

const PREFIXES = {
  account: "acc",
  project: "prj",
  session: "ses",
  task: "tsk",
  taskMessage: "tmsg",
  user: "usr",
} as const;

type Prefix = keyof typeof PREFIXES;

const random = () => crypto.randomUUID().replaceAll("-", "").slice(0, 10);
const encodeTime = (value: number) => value.toString(36).padStart(10, "0");
const invertTime = (value: number) => Number.MAX_SAFE_INTEGER - value;

export namespace Identifier {
  export const prefixes = PREFIXES;

  export function ascending(prefix: Prefix, given?: string) {
    if (given) {
      return given;
    }

    return `${PREFIXES[prefix]}_${encodeTime(Date.now())}${random()}`;
  }

  export function descending(prefix: Prefix, given?: string) {
    if (given) {
      return given;
    }

    return `${PREFIXES[prefix]}_${encodeTime(invertTime(Date.now()))}${random()}`;
  }

  export function timestamp(id: string) {
    const [, raw] = id.split("_");

    if (!raw) {
      return Date.now();
    }

    const encoded = raw.slice(0, 10);
    const decoded = Number.parseInt(encoded, 36);

    if (Number.isNaN(decoded)) {
      return Date.now();
    }

    const descendingThreshold = Number.parseInt("zzzzzzzzzz", 36) / 2;

    return decoded > descendingThreshold ? invertTime(decoded) : decoded;
  }

  export function schema(prefix: Prefix) {
    return z
      .string()
      .min(1)
      .regex(new RegExp(`^${PREFIXES[prefix]}_[a-z0-9]+$`, "i"))
      .or(z.string().min(1));
  }
}
