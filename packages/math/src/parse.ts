/**
 * Locale-safe parsing of a learner's typed numeric answer.
 *
 * Accepted: optional sign ("-", "+", or the Unicode minus U+2212 "−"), digits, optional "." decimal part.
 *   "3.5", "-3.5", "−3.5", "+3.5", ".5", "5.", "  42  "
 * Rejected with a helpful message: "3,5" / "1,234" (comma), "1 234" (inner space),
 *   "1e3" (exponent), "50%", "", "abc", "Infinity", "NaN".
 */

export type ParseResult = { ok: true; value: number; normalised: string } | { ok: false; message: string };

/** Learner input longer than this is rejected before any regex work. */
export const MAX_ANSWER_LENGTH = 32;

const UNICODE_MINUS = /[−‒–﹣－]/g; // minus, figure dash, en dash, small/full-width hyphen-minus
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export function parseNumericAnswer(input: string): ParseResult {
  if (typeof input !== "string") return { ok: false, message: "Enter a number." };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, message: "Enter a number, for example 162.5." };
  if (trimmed.length > MAX_ANSWER_LENGTH) {
    return { ok: false, message: `That answer is too long. Use at most ${MAX_ANSWER_LENGTH} characters.` };
  }

  const normalised = trimmed.replace(UNICODE_MINUS, "-");

  if (normalised.includes(",")) {
    return {
      ok: false,
      message:
        'Use a dot for decimals and no thousands separators. For example, type 3.5 (not 3,5) and 1234 (not 1,234).',
    };
  }
  if (/\s/.test(normalised)) {
    return { ok: false, message: "Remove the spaces inside the number. For example, type 1234 (not 1 234)." };
  }
  if (normalised.endsWith("%")) {
    return { ok: false, message: "Type the number without the % sign." };
  }
  if (/^[+-]?\d*\.?\d*e[+-]?\d+$/i.test(normalised)) {
    return { ok: false, message: "Type the number in full, without scientific notation (e)." };
  }
  if (!NUMBER_PATTERN.test(normalised)) {
    return { ok: false, message: "That is not a number. Use digits, an optional minus sign and a dot for decimals." };
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return { ok: false, message: "That number is too large." };
  return { ok: true, value: Object.is(value, -0) ? 0 : value, normalised };
}
