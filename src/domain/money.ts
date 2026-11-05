/**
 * Money is stored as a decimal with two places, but SQLite hands it back as a binary float and other drivers as a
 * string. Everything that enters the domain goes through here, so comparisons and refunds work on whole cents.
 */
export const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
