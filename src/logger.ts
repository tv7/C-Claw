import pinoModule from "pino";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pino = (pinoModule as any).default ?? pinoModule;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
