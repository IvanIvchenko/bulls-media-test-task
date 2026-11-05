import { orderIdsIn, withoutOrderIds } from '../domain/index.js';

const MAX_REPLY_CHARS = 1500;
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?/g;
const AMOUNT_TOLERANCE = 0.005;

/**
 * Ways a reply can promise money. Only checked when the decision is NOT an approval. A heuristic: a clever
 * paraphrase can slip past it, which is why the number rule below also applies, and why the decision itself
 * never comes from the model.
 */
const MONEY_PROMISES: readonly RegExp[] = [
  /\b(?:will|'ll|going to|shall|gonna)\s+(?:(?:\w+ly|now|also|then|soon)\s+)?(?:refund|reimburse|credit|pay)\b/i,
  /\b(?:will|'ll)\s+be\s+(?:\w+ly\s+)?(?:refunded|reimbursed|credited|paid)\b/i,
  /\b(?:refund|reimbursement|credit)\b[^.!?\n]{0,30}\b(?:is|has been|was|have been|will be)\b[^.!?\n]{0,15}\b(?:approved|issued|processed|granted|completed|sent|on (?:its|the) way|coming)\b/i,
  /\bwe(?:'ve| have)\s+(?:approved|refunded|reimbursed|credited|processed)\b/i,
  /\byou(?:'ll| will)\s+(?:receive|get)\b[^.!?\n]{0,30}\b(?:refund|money|payment|credit)\b/i,
  /\b(?:money|funds|payment)\b[^.!?\n]{0,30}\b(?:on (?:its|the) way|back to you|returned|refunded)\b/i,
];

/** Frequent English words. The promise patterns below are English, so a reply in another language is not checked by them. */
const COMMON_ENGLISH_WORDS = new Set(
  'the a an and or but is are was were be been your you we our us it this that to of for in on with as at by from not no have has will can may if so do does order request refund thank hello'.split(
    ' ',
  ),
);
const MIN_WORDS_TO_JUDGE_LANGUAGE = 8;
const MIN_ENGLISH_WORD_SHARE = 0.2;

function looksEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < MIN_WORDS_TO_JUDGE_LANGUAGE) return true;
  const share = words.filter((word) => COMMON_ENGLISH_WORDS.has(word)).length / words.length;
  return share >= MIN_ENGLISH_WORD_SHARE;
}

export interface ReplyCheckContext {
  decision: string;
  /** Order ids the reply may mention. */
  orderIds: readonly string[];
  refundAmount: number;
  /** The facts and policy excerpts the reply was written from. Every number in the reply must come from here. */
  allowedText: readonly string[];
}

const numbersIn = (text: string): number[] =>
  (withoutOrderIds(text).match(NUMBER) ?? []).map((token) =>
    Number(token.replace(/,(?=\d{3}\b)/g, '').replace(',', '.')),
  );

/**
 * Output guard for LLM-drafted replies. Returns problems; an empty array means safe to send.
 *
 * - No links, e-mail addresses or web addresses.
 * - No order id other than the customer's own.
 * - Every number must appear in the facts or policy excerpts the reply was written from (or be the refund
 *   amount). That stops an invented amount ("5000.00"), an invented deadline ("within 3 days") and a phone number.
 * - Unless the refund was approved, no promise of money.
 * - English only: the promise check is English, so a reply in another language is rejected (the template is sent).
 */
export function checkReply(reply: string, ctx: ReplyCheckContext): string[] {
  const problems: string[] = [];
  if (!reply.trim()) problems.push('empty reply');
  if (reply.length > MAX_REPLY_CHARS) problems.push('reply too long');

  if (!looksEnglish(reply)) problems.push('reply is not in English, so it cannot be checked for promises');

  if (/\bhttps?:\/\/|\bwww\./i.test(reply)) problems.push('reply contains a URL');
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(reply)) problems.push('reply contains an email address');
  if (/\b[a-z0-9-]+\.(?:com|net|org|io|co|app|dev|ai|info|biz|me)\b/i.test(reply)) {
    problems.push('reply contains a web address');
  }

  for (const id of orderIdsIn(reply)) {
    if (!ctx.orderIds.includes(id)) problems.push(`reply mentions unrelated order ${id}`);
  }

  const allowed = [ctx.refundAmount, ...ctx.allowedText.flatMap(numbersIn)];
  for (const value of numbersIn(reply)) {
    if (!allowed.some((candidate) => Math.abs(candidate - value) < AMOUNT_TOLERANCE)) {
      problems.push(`reply contains a number that is not in the facts: ${value}`);
    }
  }

  if (ctx.decision !== 'approve' && MONEY_PROMISES.some((pattern) => pattern.test(reply))) {
    problems.push('reply promises money that was not approved');
  }
  return problems;
}
