import { pino } from "pino";
import { config } from "./config.js";

/** Structured JSON logger. Credentials and cookies are redacted. */
export const logger = pino({
  level: config.isTest ? "silent" : config.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.secret",
    ],
    censor: "[redacted]",
  },
});
