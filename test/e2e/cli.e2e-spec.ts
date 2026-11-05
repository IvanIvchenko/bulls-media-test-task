import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const CLI = resolve(import.meta.dirname, '../../src/cli/triage.cli.ts');
const sample = (name: string) => resolve(import.meta.dirname, '../../samples', name);
const runCli = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, ANTHROPIC_API_KEY: '', LOG_LEVEL: 'silent' },
  });

describe('triage CLI', () => {
  it('prints the decision for one ticket and exits by itself', () => {
    const run = runCli('--file', sample('01-refund-approved.json'));
    expect(run.error).toBeUndefined(); // a hung process would have been killed by the timeout
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Ticket T-001: APPROVE');
  });

  it('exits non-zero with usage when it is given nothing to do', () => {
    const run = runCli();
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('Usage:');
  });
});
