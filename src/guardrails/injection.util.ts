interface InjectionSignal {
  name: string;
  pattern: RegExp;
  /** "strong": clearly an attempt to command the agent. "weak": suspicious wording that is also common in honest tickets. */
  strength: 'strong' | 'weak';
}

const SIGNALS: InjectionSignal[] = [
  {
    name: 'ignore_instructions',
    strength: 'strong',
    pattern: /\b(ignore|disregard|forget)\b[^.\n]{0,30}\b(instructions|rules|polic(y|ies)|guidelines)\b/i,
  },
  {
    name: 'role_reassignment',
    strength: 'strong',
    pattern:
      /\byou are now (a|an|the|in)\b[^.\n]{0,30}\b(admin|administrator|manager|system|developer|unrestricted|jailbroken)\b/i,
  },
  { name: 'override_policy', strength: 'strong', pattern: /\boverride\b[^.\n]{0,20}\b(policy|limit|rules|checks)\b/i },
  {
    name: 'forced_approval',
    strength: 'strong',
    pattern:
      /\b(approve|process|issue)\b[^.\n]{0,20}\brefund\b[^.\n]{0,20}\b(regardless|no matter|without (any )?checks?)\b/i,
  },
  { name: 'role_markup', strength: 'strong', pattern: /<\/?\s*(system|assistant|instructions?)\s*>/i },
  { name: 'prompt_mention', strength: 'weak', pattern: /\b(system|developer) (prompt|message|instructions?)\b/i },
  { name: 'role_play', strength: 'weak', pattern: /\bact as\b[^.\n]{0,30}\b(admin|manager|agent|system)\b/i },
  { name: 'you_are_now', strength: 'weak', pattern: /\byou are now\b/i },
  { name: 'privileged_mode', strength: 'weak', pattern: /\b(admin|developer|debug|god) mode\b/i },
  { name: 'new_instructions', strength: 'weak', pattern: /\bnew instructions?\b/i },
];

/**
 * Returns the names of the signals that justify flagging the text, or [] if it looks fine.
 * Flag when ANY strong signal matches, or when TWO OR MORE weak signals match: one weak phrase
 * alone ("I got a system message that my payment failed") is common in honest tickets.
 * Defence-in-depth only: the real protection is that the LLM can't decide money.
 */
export function detectInjection(text: string): string[] {
  const matched = SIGNALS.filter((signal) => signal.pattern.test(text));
  const strong = matched.filter((signal) => signal.strength === 'strong');
  const weak = matched.filter((signal) => signal.strength === 'weak');
  return strong.length > 0 || weak.length >= 2 ? matched.map((signal) => signal.name) : [];
}

/**
 * Wrap untrusted text so the model sees it as data.
 *
 * Every `<` and `>` in the text is escaped, so it cannot contain a tag at all, whatever it spells. (Stripping
 * `<untrusted>` tags instead is not safe: removing one can splice its neighbours into a new one, as in
 * `<untrus<untrusted>ted>`.)
 */
export function fence(label: string, text: string): string {
  const escaped = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<untrusted source="${label}">\n${escaped}\n</untrusted>`;
}
