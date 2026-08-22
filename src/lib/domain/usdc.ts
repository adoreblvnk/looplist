import { z } from "zod";

export const USDC_DECIMALS = 6;
export const MAX_USDC_WHOLE_DIGITS = 12;
export const MAX_USDC_ATOMIC_DIGITS = MAX_USDC_WHOLE_DIGITS + USDC_DECIMALS;

const canonicalAtomicPattern = /^(0|[1-9]\d*)$/;
const canonicalDecimalPattern = new RegExp(
  `^(0|[1-9]\\d{0,${MAX_USDC_WHOLE_DIGITS - 1}})(?:\\.(\\d{1,${USDC_DECIMALS}}))?$`
);

export const UsdcAtomicAmountSchema = z
  .string()
  .max(MAX_USDC_ATOMIC_DIGITS, "USDC atomic amount exceeds the marketplace limit")
  .regex(canonicalAtomicPattern, "USDC atomic amount must be a canonical non-negative integer string");

export type UsdcAtomicAmount = z.infer<typeof UsdcAtomicAmountSchema>;

/** Converts a canonical decimal USDC string into its six-decimal atomic representation. */
export function parseUsdcAmount(input: unknown): UsdcAtomicAmount {
  if (typeof input !== "string") {
    throw new TypeError("USDC amount must be provided as a decimal string");
  }

  const match = canonicalDecimalPattern.exec(input);
  if (!match) {
    throw new Error(
      `Invalid USDC amount: use canonical decimal notation with at most ${USDC_DECIMALS} decimals and ${MAX_USDC_WHOLE_DIGITS} whole-number digits`
    );
  }

  const [, whole, fractional = ""] = match;
  const atomic = `${whole}${fractional.padEnd(USDC_DECIMALS, "0")}`.replace(/^0+(?=\d)/, "");
  return UsdcAtomicAmountSchema.parse(atomic);
}

/** Formats a canonical atomic USDC string with exactly six decimal places. */
export function formatUsdcAmount(input: unknown): string {
  const atomic = UsdcAtomicAmountSchema.parse(input);
  const padded = atomic.padStart(USDC_DECIMALS + 1, "0");
  const whole = padded.slice(0, -USDC_DECIMALS);
  const fractional = padded.slice(-USDC_DECIMALS);
  return `${whole}.${fractional}`;
}
