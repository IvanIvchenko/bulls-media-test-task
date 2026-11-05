import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Dependency rules, enforced.
 *
 *   domain  <-  shared, config, guardrails, db  <-  orders, policies, audit, llm, health, tickets  <-  agent
 *                                                                                                       <- entry points
 *
 * Features never import each other's internals, and the inner layers know nothing about SQLite, Fastify, the
 * model SDK or the graph library. That is what lets the agent and the HTTP layer run against plain fakes.
 * Entry points (src/*.ts, cli/) are the only code allowed to wire concrete classes together.
 * If this test fails, a dependency went the wrong way.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

interface Import {
  from: string; // path relative to src, e.g. "agent/nodes/gather.node.ts"
  spec: string; // as written
  target?: string; // resolved path relative to src, without extension; undefined for packages
}

function importsOf(file: string): Import[] {
  const text = readFileSync(file, 'utf8');
  const from = relative(SRC, file);
  const specs = [...text.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (match) => (match[1] ?? match[2])!,
  );
  return specs.map((spec) => ({
    from,
    spec,
    target: spec.startsWith('.') ? relative(SRC, resolve(dirname(file), spec)).replace(/\.js$/, '') : undefined,
  }));
}

const all = listFiles(SRC).flatMap(importsOf);

/** The folder a file lives in, or "(root)" for files directly under src. */
const layerOf = (path: string) => (path.includes('/') ? path.split('/')[0]! : '(root)');

/** Entry points wire everything together and may import anything. */
const ENTRY_LAYERS = new Set(['(root)', 'cli']);
const isEntryPoint = (file: string) => ENTRY_LAYERS.has(layerOf(file));

/** Which other layers each layer may import from. A layer missing here may not be imported from at all. */
const ALLOWED_LAYERS: Record<string, string[]> = {
  domain: [],
  shared: [],
  config: ['shared'],
  guardrails: ['domain'],
  db: ['domain'],
  orders: ['domain', 'db', 'shared'],
  policies: ['domain', 'db', 'shared'],
  audit: ['domain', 'db', 'shared'],
  claims: ['domain', 'db', 'shared'],
  retention: ['db'],
  llm: ['domain', 'guardrails', 'config', 'shared'],
  health: ['shared'],
  tickets: ['domain', 'shared'],
  agent: ['domain', 'guardrails', 'llm', 'shared'],
};

/** Third-party packages each layer may use. `node:*` built-ins are listed as "node:". */
const ALLOWED_PACKAGES: Record<string, string[]> = {
  domain: ['zod'],
  shared: ['pino', 'fastify', 'node:'],
  config: ['zod'],
  guardrails: [],
  db: ['knex', 'zod', 'node:'],
  orders: [],
  policies: [],
  audit: [],
  claims: ['node:'],
  retention: [],
  llm: ['@anthropic-ai/sdk'],
  health: ['fastify'],
  tickets: ['fastify', 'node:'],
  agent: ['@langchain/langgraph'],
};

/** Imports that break the layer rules, as readable strings. */
function layerViolations(imports: Import[]): string[] {
  return imports
    .filter((imp) => imp.target && !isEntryPoint(imp.from))
    .filter((imp) => {
      const layer = layerOf(imp.from);
      const targetLayer = layerOf(imp.target!);
      if (targetLayer === layer) return false;
      return !(ALLOWED_LAYERS[layer] ?? []).includes(targetLayer);
    })
    .map((imp) => `${imp.from} imports ${imp.spec}`);
}

const packageName = (spec: string) =>
  spec.startsWith('node:')
    ? 'node:'
    : spec.startsWith('@')
      ? spec.split('/').slice(0, 2).join('/')
      : spec.split('/')[0]!;

/** Package imports a layer is not allowed to make, as readable strings. */
function packageViolations(imports: Import[]): string[] {
  return imports
    .filter((imp) => !imp.target && !isEntryPoint(imp.from))
    .filter((imp) => !(ALLOWED_PACKAGES[layerOf(imp.from)] ?? []).includes(packageName(imp.spec)))
    .map((imp) => `${imp.from} imports package ${imp.spec}`);
}

describe('architecture: layers only depend inward', () => {
  it('every layer imports only from the layers it is allowed to', () => {
    expect(layerViolations(all)).toEqual([]);
  });

  it('every folder under src has rules, so a new feature cannot slip through unchecked', () => {
    const folders = new Set(listFiles(SRC).map((file) => layerOf(relative(SRC, file))));
    const unruled = [...folders].filter((folder) => !ENTRY_LAYERS.has(folder) && !(folder in ALLOWED_LAYERS));
    expect(unruled).toEqual([]);
  });

  it('features do not reach into each other: the agent and the tickets feature see no concrete repository or service', () => {
    const concrete = all.filter(
      (imp) =>
        (layerOf(imp.from) === 'agent' || layerOf(imp.from) === 'tickets') &&
        /\.(repository|service|mapper)$/.test(imp.target ?? '') &&
        layerOf(imp.target!) !== layerOf(imp.from), // inside a feature, using its own service is fine
    );
    expect(concrete.map((imp) => `${imp.from} imports ${imp.spec}`)).toEqual([]);
  });
});

describe('architecture: infrastructure stays where it belongs', () => {
  it('each layer uses only the third-party packages it is allowed to', () => {
    expect(packageViolations(all)).toEqual([]);
  });

  it('only the db layer imports the database library, only llm the model SDK, only agent the graph library', () => {
    const users = (pkg: string) => [...new Set(all.filter((imp) => imp.spec === pkg).map((imp) => layerOf(imp.from)))];
    expect(users('knex').filter((layer) => !ENTRY_LAYERS.has(layer))).toEqual(['db']);
    expect(users('@anthropic-ai/sdk')).toEqual(['llm']);
    expect(users('@langchain/langgraph')).toEqual(['agent']);
  });

  it('services never read process.env: only the config entry reads it', () => {
    const offenders = listFiles(SRC)
      .filter((file) => !isEntryPoint(relative(SRC, file)))
      .filter((file) => relative(SRC, file) !== 'config/config.service.ts')
      .filter((file) => /process\.env/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});

describe('architecture: code conventions', () => {
  const files = listFiles(SRC).map((file) => ({ path: relative(SRC, file), text: readFileSync(file, 'utf8') }));

  it('only the domain package has a barrel index.ts', () => {
    expect(files.filter((file) => file.path.endsWith('/index.ts')).map((file) => file.path)).toEqual([
      'domain/index.ts',
    ]);
  });

  it('files are named [feature].[type].ts or typedef.ts / constants.ts, in kebab-case', () => {
    const bad = files
      .map((file) => file.path.split('/').pop()!)
      .filter((name) => !/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)?\.ts$/.test(name));
    expect(bad).toEqual([]);
  });

  it('no raw `new Error(...)` is thrown from services: use BusinessLogicError', () => {
    const offenders = files.filter((file) => /throw new Error\(/.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('injected dependencies are never public or mutable (private readonly)', () => {
    const publicInjected = files
      .filter((file) => /constructor\([^)]*\bpublic (?!readonly)/.test(file.text))
      .map((file) => file.path);
    expect(publicInjected).toEqual([]);
  });

  it('Zod schemas are named nameSchema', () => {
    const bad = files.flatMap((file) =>
      [...file.text.matchAll(/export const (\w+) = z\./g)]
        .map((match) => match[1]!)
        .filter((name) => !/Schema$/.test(name) || /^[A-Z]/.test(name))
        .map((name) => `${file.path}: ${name}`),
    );
    expect(bad).toEqual([]);
  });
});

describe('architecture: the checker itself works', () => {
  const fake = (from: string, spec: string, target?: string): Import => ({ from, spec, target });

  it('sees the real project (guards against an always-passing test)', () => {
    expect(listFiles(SRC).length).toBeGreaterThan(50);
    expect(all.filter((imp) => imp.target?.startsWith('domain/')).length).toBeGreaterThan(20);
    expect(all.some((imp) => imp.spec === 'knex')).toBe(true);
  });

  it('flags a layer that reaches the wrong way', () => {
    expect(layerViolations([fake('domain/x.ts', '../db/database.client.js', 'db/database.client')])).toHaveLength(1);
    expect(layerViolations([fake('agent/x.ts', '../orders/orders.service.js', 'orders/orders.service')])).toHaveLength(
      1,
    );
    expect(
      layerViolations([fake('orders/x.ts', '../policies/policies.service.js', 'policies/policies.service')]),
    ).toHaveLength(1);
    expect(layerViolations([fake('db/x.ts', '../agent/agent.service.js', 'agent/agent.service')])).toHaveLength(1);
    expect(layerViolations([fake('tickets/x.ts', '../db/database.client.js', 'db/database.client')])).toHaveLength(1);
  });
});
