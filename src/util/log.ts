import pino, { type Logger as PinoLogger } from "pino";

type Tags = Record<string, unknown>;
type Extra = Record<string, unknown>;

const root = pino({
  base: undefined,
  level: process.env.LOG_LEVEL ?? "info",
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

const wrap = (log: PinoLogger) => {
  const clone = () => wrap(log.child({}));

  return {
    child(tags: Tags) {
      return wrap(log.child(tags));
    },
    clone,
    debug(message: string, extra?: Extra) {
      write(log, "debug", message, extra);
    },
    error(message: string, extra?: Extra) {
      write(log, "error", message, extra);
    },
    info(message: string, extra?: Extra) {
      write(log, "info", message, extra);
    },
    tag(key: string, value: string) {
      return wrap(log.child({ [key]: value }));
    },
    time(message: string, extra?: Extra) {
      const startedAt = Date.now();

      log.info({ ...(extra ?? {}), status: "started" }, message);

      let done = false;

      const stop = () => {
        if (done) {
          return;
        }

        done = true;
        log.info(
          { ...(extra ?? {}), duration: Date.now() - startedAt, status: "completed" },
          message,
        );
      };

      return {
        [Symbol.dispose]() {
          stop();
        },
        stop,
      };
    },
    warn(message: string, extra?: Extra) {
      write(log, "warn", message, extra);
    },
  };
};

export namespace Log {
  export type Logger = ReturnType<typeof wrap>;

  export const create = (tags: Tags = {}) => wrap(root.child(tags));
  export const Default = create({ service: "default" });
}
