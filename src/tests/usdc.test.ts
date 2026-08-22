import { describe, expect, it } from "vitest";
import {
  UsdcAtomicAmountSchema,
  formatUsdcAmount,
  parseUsdcAmount,
} from "../lib/domain/usdc";

describe("exact USDC helpers", () => {
  it.each([
    ["0", "0", "0.000000"],
    ["0.000001", "1", "0.000001"],
    ["1", "1000000", "1.000000"],
    ["1.2", "1200000", "1.200000"],
    ["999999999999.999999", "999999999999999999", "999999999999.999999"],
  ])("round trips %s exactly", (decimal, atomic, formatted) => {
    expect(parseUsdcAmount(decimal)).toBe(atomic);
    expect(formatUsdcAmount(atomic)).toBe(formatted);
    expect(parseUsdcAmount(formatUsdcAmount(atomic))).toBe(atomic);
  });

  it.each([
    ["negative", "-1"],
    ["exponent notation", "1e6"],
    ["excessive precision", "1.0000001"],
    ["leading decimal point", ".5"],
    ["trailing decimal point", "1."],
    ["noncanonical leading zero", "01.00"],
    ["whitespace", " 1.00"],
    ["ridiculous magnitude", "1000000000000"],
  ])("rejects %s instead of rounding or coercing", (_branch, value) => {
    expect(() => parseUsdcAmount(value)).toThrow(/Invalid USDC amount/);
  });

  it.each([Number.MAX_SAFE_INTEGER, 1.25, BigInt(1), null, undefined])(
    "rejects unsafe non-string input %s",
    (value) => {
      expect(() => parseUsdcAmount(value)).toThrow(TypeError);
    }
  );

  it.each(["00", "01", "+1", "-1", "1.0", "1e6", " 1", "9999999999999999999"])(
    "rejects noncanonical atomic string %s",
    (atomic) => {
      const result = UsdcAtomicAmountSchema.safeParse(atomic);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual([]);
      }
      expect(() => formatUsdcAmount(atomic)).toThrow();
    }
  );
});
