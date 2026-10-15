// Money is handled as decimal strings end to end (DB: Decimal(14,2)). Never floats.

/** Up to 12 integer digits and 2 decimals, matching Decimal(14,2). */
export const AMOUNT_RE = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;

const FALLBACK_CURRENCIES = ["INR", "USD", "EUR", "GBP", "SGD", "AED", "JPY", "AUD", "CAD", "CHF", "CNY"];

let currencyCache: Set<string> | null = null;
/** ISO 4217 codes known to the runtime's Intl data. */
export function isIsoCurrency(code: string): boolean {
  if (!currencyCache) {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    currencyCache = new Set(intl.supportedValuesOf ? intl.supportedValuesOf("currency") : FALLBACK_CURRENCIES);
  }
  return currencyCache.has(code);
}

/** Normalises a validated amount string to exactly two decimals ("12.5" → "12.50"). */
export function normalizeAmount(value: string): string {
  const [int = "0", frac = ""] = value.split(".");
  return `${int}.${(frac + "00").slice(0, 2)}`;
}

/** Formats a decimal string with thousands separators, without converting to a float. */
export function formatAmount(value: string, currency: string): string {
  const negative = value.startsWith("-");
  const [int = "0", frac = ""] = (negative ? value.slice(1) : value).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${currency} ${grouped}.${(frac + "00").slice(0, 2)}`;
}
