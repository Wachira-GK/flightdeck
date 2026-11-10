import { assertFinite, MathInputError } from "./validate";

/**
 * Deterministic number formatting. We deliberately do NOT use toLocaleString / Intl here:
 * output must be identical on server and client and in every learner locale.
 */

/** Round half away from zero to `decimals` places (avoids the 1.005 -> 1.00 binary trap). */
export function roundTo(value: number, decimals: number): number {
  assertFinite(value, "Value");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) {
    throw new MathInputError("INVALID_ARGUMENT", "Decimals must be an integer from 0 to 10.");
  }
  // Beyond 2^53 every double is already an integer; shifting the exponent would only lose precision.
  if (Math.abs(value) >= 2 ** 53) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  let shifted = Number(`${abs}e${decimals}`);
  if (!Number.isFinite(shifted)) shifted = abs * 10 ** decimals;
  let rounded = Number(`${Math.round(shifted)}e-${decimals}`);
  if (!Number.isFinite(rounded)) rounded = Math.round(shifted) / 10 ** decimals;
  const result = sign * rounded;
  return Object.is(result, -0) ? 0 : result;
}

/**
 * Format with at most `maxDecimals` places, trimming trailing zeros: 162.50 -> "162.5", 147.00 -> "147".
 * Uses "." as the decimal separator and no thousands separator.
 */
export function formatNumber(value: number, maxDecimals = 2): string {
  const r = roundTo(value, maxDecimals);
  let text = r.toFixed(maxDecimals);
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" ? "0" : text;
}

/** Same as formatNumber but always shows exactly `decimals` places: 147 -> "147.0". */
export function formatFixed(value: number, decimals: number): string {
  const text = roundTo(value, decimals).toFixed(decimals);
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}
