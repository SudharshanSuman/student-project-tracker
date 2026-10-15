import { config } from "../config.js";

/** Institutional email check. An empty allowlist (dev only) accepts any domain. */
export function isInstitutionalEmail(email: string): boolean {
  if (config.emailDomains.length === 0) return !config.isProd;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return config.emailDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}
