const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Digit runs with separators, e.g. phone numbers or card numbers. */
const LONG_NUMBER = /\+?\d[\d\s().-]{6,}\d/g;
const MIN_DIGITS_TO_REDACT = 9; // keeps ISO dates (8 digits) and amounts readable

/** Mask emails and phone/card-like numbers. Used for everything that is logged or traced. */
export function redactPii(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(LONG_NUMBER, (match) => (match.replace(/\D/g, '').length >= MIN_DIGITS_TO_REDACT ? '[number]' : match));
}
