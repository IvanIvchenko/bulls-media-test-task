import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resultSchema } from '../../src/domain/index.js';
import { run } from '../support/helpers.js';

describe('e2e: every sample ticket produces the expected decision', () => {
  const dir = new URL('../../samples/', import.meta.url);
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.json'))
    .sort()) {
    const sample = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    it(`${f}: ${sample.description}`, async () => {
      const r = await run(sample.input);
      expect(resultSchema.safeParse(r).success).toBe(true);
      expect(r.decision).toBe(sample.expected.decision);
      expect(r.summary.length).toBeGreaterThan(0);
      expect(r.reply.length).toBeGreaterThan(0);
      expect(r.trace.length).toBeGreaterThan(0);
    });

    it(`${f}: the reply reads as written to the customer`, async () => {
      const { reply, decision } = await run(sample.input);
      // The reviewer's wording and the company's internal numbers stay out of it.
      expect(reply).not.toMatch(/\bthe customer\b|auto-approval|\bhuman\b|email_mismatch|not_found/i);
      expect(reply).not.toMatch(/Hello, [A-Z]/); // a sentence that starts after a comma starts in lower case
      if (decision === 'escalate') expect(reply.match(/team member/gi) ?? []).toHaveLength(1);
    });
  }
});
