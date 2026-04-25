import pino, { type Logger as PinoLogger } from "pino";

type Tags = Record<string, unknown>;
type Extra = Record<string, unknown>;

const root = pino({
  base: undefined,
  level: process.env.LOG_LEVEL ?? "warn",
  redact: {
    censor: "[redacted]",
    paths: [
      "*.accessToken",
      "*.apiKey",
      "*.Authorization",
      "*.authorization",
      "accessToken",
      "apiKey",
      "token",
      "OPENROUTER_API_KEY",
      "DAYTONA_API_KEY",
    ],
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

const write = (
  log: PinoLogger,
  level: "debug" | "error" | "info" | "warn",
  message: string,
  extra?: Extra,
) => {
  if (!extra) {
    log[level](message);
    return;
  }

  const data =
    extra.error instanceof Error ? { ...extra, err: extra.error, error: undefined } : extra;

  log[level](data, message);
};

export namespace Log {
  export type Logger = {
    child(tags: Tags): Logger;
    debug(message: string, extra?: Extra): void;
    error(message: string, extra?: Extra): void;
    info(message: string, extra?: Extra): void;
    warn(message: string, extra?: Extra): void;
  };

  const wrap = (log: PinoLogger): Logger => ({
    child(tags) {
      return wrap(log.child(tags));
    },
    debug(message, extra) {
      write(log, "debug", message, extra);
    },
    error(message, extra) {
      write(log, "error", message, extra);
    },
    info(message, extra) {
      write(log, "info", message, extra);
    },
    warn(message, extra) {
      write(log, "warn", message, extra);
    },
  });

  export const create = (tags: Tags = {}) => wrap(root.child(tags));
}
