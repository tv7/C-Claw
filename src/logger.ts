import pino from "pino";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pinoFn = (pino as any).default ?? pino;

export const logger = pinoFn({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
