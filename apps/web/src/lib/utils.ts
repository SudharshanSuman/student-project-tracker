import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatAmount } from "@iic/shared";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateFmt.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateTimeFmt.format(new Date(value));
}

export function relativeTime(value: string | Date): string {
  const diff = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86400_000) return rtf.format(Math.round(diff / 3600_000), "hour");
  return rtf.format(Math.round(diff / 86400_000), "day");
}

/** Money arrives as exact decimal strings; Intl formats numeric strings without float rounding. */
export function formatMoney(amount: string | number, currency: string): string {
  try {
    const nf = new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return nf.format(amount as number);
  } catch {
    return formatAmount(String(amount), currency);
  }
}

export function humanize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_.]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function initials(name: string): string {
  return name
    .replace(/\[.*?\]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
