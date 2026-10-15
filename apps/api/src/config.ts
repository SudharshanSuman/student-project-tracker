import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  API_PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.string().default("info"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  APP_URL: z.string().default("http://localhost:3000"),
  INSTITUTION_EMAIL_DOMAINS: z.string().default(""),
  INSTITUTION_ID: z.string().default("IIC"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(72),
  QR_TOKEN_SECRET: z.string().min(32, "QR_TOKEN_SECRET must be at least 32 characters"),
  STORAGE_DIR: z.string().default("./storage"),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().default("IIC Platform <no-reply@example.edu>"),
  DISCORD_BOT_TOKEN: z.string().optional().default(""),
  DISCORD_GUILD_ID: z.string().optional().default(""),
  GITHUB_TOKEN: z.string().optional().default(""),
  REDIS_URL: z.string().optional().default(""),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast on misconfiguration; never print secret values.
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
  throw new Error(`Invalid environment configuration:\n  ${issues}`);
}

const env = parsed.data;

export const config = {
  ...env,
  isProd: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  webOrigins: env.WEB_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
  emailDomains: env.INSTITUTION_EMAIL_DOMAINS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  sessionCookie: "iic_session",
  integrations: {
    discordConfigured: Boolean(env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID),
    githubConfigured: Boolean(env.GITHUB_TOKEN),
    redisConfigured: Boolean(env.REDIS_URL),
    smtpConfigured: Boolean(env.SMTP_HOST),
  },
};

export type AppConfig = typeof config;
