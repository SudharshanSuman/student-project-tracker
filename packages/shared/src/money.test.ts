import { describe, expect, it } from "vitest";
import { formatAmount, normalizeAmount } from "./money";
import { amountSchema, currencySchema, updateFundingAwardSchema } from "./schemas";

describe("money", () => {
  it("accepts decimal strings up to Decimal(14,2) and normalises them", () => {
    expect(amountSchema.parse("1500")).toBe("1500.00");
    expect(amountSchema.parse("0.1")).toBe("0.10");
    expect(amountSchema.parse("999999999999.99")).toBe("999999999999.99");
  });
  it("rejects zero, negatives, 3+ decimals, overflow and numbers", () => {
    for (const bad of ["0", "0.00", "-5", "1.005", "1e5", "1000000000000", "abc", ""]) expect(amountSchema.safeParse(bad).success, bad).toBe(false);
    expect(amountSchema.safeParse(10.5).success).toBe(false);
  });
  it("validates ISO 4217 currency codes", () => {
    expect(currencySchema.parse("inr")).toBe("INR");
    expect(currencySchema.safeParse("XYZ").success).toBe(false);
    expect(currencySchema.safeParse("US").success).toBe(false);
  });
  it("formats without float conversion", () => {
    expect(formatAmount("1234567890123.45", "USD")).toBe("USD 1,234,567,890,123.45");
    expect(formatAmount("0.1", "INR")).toBe("INR 0.10");
    expect(normalizeAmount("7")).toBe("7.00");
  });
  it("partial updates leave omitted fields undefined", () => {
    expect(updateFundingAwardSchema.parse({ title: "x" })).toEqual({ title: "x" });
  });
});
