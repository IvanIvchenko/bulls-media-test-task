import { Annotation, Command, END, interrupt, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import {
  INTERRUPT,
  type BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
} from '@langchain/langgraph-checkpoint';

import { describe, expect, it } from 'vitest';

import { KnexCheckpointSaver } from './knex-checkpoint.saver.js';
import { openTestDatabase } from '../../test/support/database.js';

const saver = async () => new KnexCheckpointSaver(await openTestDatabase());

const at = (threadId: string, checkpointId?: string) => ({
  configurable: { thread_id: threadId, checkpoint_ns: '', ...(checkpointId ? { checkpoint_id: checkpointId } : {}) },
});
const checkpoint = (id: string, over: Partial<Checkpoint> = {}): Checkpoint => ({
  v: 4,
  id,
  ts: new Date().toISOString(),
  channel_values: { text: 'héllo', nested: { a: [1, 2, 3] } },
  channel_versions: { text: 1 },
  versions_seen: {},
  ...over,
});
const meta = (step: number, extra: object = {}): CheckpointMetadata =>
  ({ source: 'loop', step, parents: {}, ...extra }) as CheckpointMetadata;
const all = async (stream: AsyncGenerator<{ config: { configurable?: Record<string, unknown> } }>) => {
  const ids: unknown[] = [];
  for await (const tuple of stream) ids.push(tuple.config.configurable?.checkpoint_id);
  return ids;
};

describe('KnexCheckpointSaver: the checkpoint store contract', () => {
  it('stores a checkpoint and returns it, with its metadata, by id or as the latest', async () => {
    const store = await saver();
    const first = await store.put(at('T'), checkpoint('0001'), meta(0), {});
    await store.put(first, checkpoint('0002'), meta(1), {});

    const latest = await store.getTuple(at('T'));
    expect(latest?.config.configurable?.checkpoint_id).toBe('0002');
    expect(latest?.checkpoint.channel_values).toEqual({ text: 'héllo', nested: { a: [1, 2, 3] } });
    expect(latest?.metadata).toMatchObject({ step: 1 });
    expect(latest?.parentConfig?.configurable?.checkpoint_id).toBe('0001');

    const earlier = await store.getTuple(at('T', '0001'));
    expect(earlier?.metadata).toMatchObject({ step: 0 });
    expect(earlier?.parentConfig).toBeUndefined(); // the first checkpoint has no parent
  });

  it('knows nothing about an unknown thread or checkpoint', async () => {
    const store = await saver();
    await store.put(at('T'), checkpoint('0001'), meta(0), {});
    expect(await store.getTuple(at('other'))).toBeUndefined();
    expect(await store.getTuple(at('T', 'nope'))).toBeUndefined();
  });

  it('keeps threads apart', async () => {
    const store = await saver();
    await store.put(at('A'), checkpoint('0001', { channel_values: { who: 'A' } }), meta(0), {});
    await store.put(at('B'), checkpoint('0001', { channel_values: { who: 'B' } }), meta(0), {});
    expect((await store.getTuple(at('A')))?.checkpoint.channel_values).toEqual({ who: 'A' });
    expect((await store.getTuple(at('B')))?.checkpoint.channel_values).toEqual({ who: 'B' });
  });

  it('putting the same checkpoint again replaces it', async () => {
    const store = await saver();
    await store.put(at('T'), checkpoint('0001', { channel_values: { v: 1 } }), meta(0), {});
    await store.put(at('T'), checkpoint('0001', { channel_values: { v: 2 } }), meta(0), {});
    expect((await store.getTuple(at('T')))?.checkpoint.channel_values).toEqual({ v: 2 });
  });

  it('lists newest first, and honours before, limit and a metadata filter', async () => {
    const store = await saver();
    let config: Awaited<ReturnType<typeof store.put>> = at('T');
    for (const [index, id] of ['0001', '0002', '0003', '0004'].entries()) {
      config = await store.put(config, checkpoint(id), meta(index, { tag: index % 2 ? 'odd' : 'even' }), {});
    }
    expect(await all(store.list(at('T')))).toEqual(['0004', '0003', '0002', '0001']);
    expect(await all(store.list(at('T'), { limit: 2 }))).toEqual(['0004', '0003']);
    expect(await all(store.list(at('T'), { before: at('T', '0003') }))).toEqual(['0002', '0001']);
    expect(await all(store.list(at('T'), { filter: { tag: 'odd' } }))).toEqual(['0004', '0002']);
    expect(await all(store.list(at('T'), { filter: { tag: 'odd' }, limit: 1 }))).toEqual(['0004']);
    expect(await all(store.list(at('nobody')))).toEqual([]);
  });

  it('stores writes against a checkpoint, in task order, and returns them with it', async () => {
    const store = await saver();
    const config = await store.put(at('T'), checkpoint('0001'), meta(0), {});
    await store.putWrites(config, [['b', { n: 2 }]], 'task-b', 'path-b');
    await store.putWrites(
      config,
      [
        ['a', 'x'],
        ['a', 'y'],
      ],
      'task-a',
      'path-a',
    );

    const writes = (await store.getTuple(config))?.pendingWrites;
    expect(writes).toEqual([
      ['task-a', 'a', 'x'],
      ['task-a', 'a', 'y'],
      ['task-b', 'b', { n: 2 }],
    ]);
  });

  it('keeps an ordinary write once, but lets the special channels replace what was there', async () => {
    const store = await saver();
    const config = await store.put(at('T'), checkpoint('0001'), meta(0), {});
    await store.putWrites(config, [['out', 'first']], 'task', '');
    await store.putWrites(config, [['out', 'second']], 'task', ''); // a retried task: the first stands
    await store.putWrites(config, [[INTERRUPT, 'asked']], 'task', '');
    await store.putWrites(config, [[INTERRUPT, 'asked again']], 'task', '');

    const writes = (await store.getTuple(config))?.pendingWrites ?? [];
    expect(writes.filter(([, channel]) => channel === 'out')).toEqual([['task', 'out', 'first']]);
    expect(writes.filter(([, channel]) => channel === INTERRUPT)).toEqual([['task', INTERRUPT, 'asked again']]);
  });

  it('keeps binary-looking and unicode content intact', async () => {
    const store = await saver();
    const config = await store.put(
      at('T'),
      checkpoint('0001', { channel_values: { s: 'żółć 🐂', n: null } }),
      meta(0),
      {},
    );
    await store.putWrites(config, [['c', { bytes: new Uint8Array([0, 255, 128]) }]], 'task');
    const tuple = await store.getTuple(config);
    expect(tuple?.checkpoint.channel_values).toEqual({ s: 'żółć 🐂', n: null });
    expect(tuple?.pendingWrites?.[0]?.[2]).toEqual({ bytes: new Uint8Array([0, 255, 128]) });
  });

  it('deletes one thread completely and leaves the others', async () => {
    const store = await saver();
    for (const thread of ['A', 'B']) {
      const config = await store.put(at(thread), checkpoint('0001'), meta(0), {});
      await store.putWrites(config, [['c', 1]], 'task');
    }
    await store.deleteThread('A');
    expect(await store.getTuple(at('A'))).toBeUndefined();
    expect((await store.getTuple(at('B')))?.pendingWrites).toHaveLength(1);
  });

  it('needs a thread id and, for writes, a checkpoint id', async () => {
    const store = await saver();
    await expect(store.getTuple({ configurable: {} })).rejects.toThrow(/thread_id/);
    await expect(store.put({ configurable: {} }, checkpoint('0001'), meta(0), {})).rejects.toThrow(/thread_id/);
    await expect(store.putWrites(at('T'), [['c', 1]], 'task')).rejects.toThrow(/checkpoint_id/);
  });
});

/** The same graph, paused and resumed, must behave the same on this saver as on the library's own. */
describe('KnexCheckpointSaver: running a real graph', () => {
  const State = Annotation.Root({
    log: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
    answer: Annotation<string | undefined>,
  });

  const build = (checkpointer: BaseCheckpointSaver) =>
    new StateGraph(State)
      .addNode('before', () => ({ log: ['before'] }))
      .addNode('ask', () => ({ answer: interrupt('what is your answer?') as string, log: ['asked'] }))
      .addNode('after', (state) => ({ log: [`after:${state.answer}`] }))
      .addEdge(START, 'before')
      .addEdge('before', 'ask')
      .addEdge('ask', 'after')
      .addEdge('after', END)
      .compile({ checkpointer });

  const play = async (checkpointer: BaseCheckpointSaver) => {
    const config = { configurable: { thread_id: 'run' } };
    const graph = build(checkpointer);
    await graph.invoke({}, config);
    const waiting = await graph.getState(config);
    // A second graph object on the same saver: what another instance would have.
    const finished = await build(checkpointer).invoke(new Command({ resume: 'yes' }), config);
    return { waiting: { next: waiting.next, values: waiting.values }, finished };
  };

  it('pauses at the interrupt and resumes to the same result as the library’s in-memory saver', async () => {
    const reference = await play(new MemorySaver());
    const ours = await play(await saver());
    expect(ours).toEqual(reference);
    expect(ours.waiting).toEqual({ next: ['ask'], values: { log: ['before'] } });
    expect(ours.finished).toEqual({ log: ['before', 'asked', 'after:yes'], answer: 'yes' });
  });

  it('carries a paused run over to a new saver on the same database', async () => {
    const database = await openTestDatabase();
    const config = { configurable: { thread_id: 'run' } };
    await build(new KnexCheckpointSaver(database)).invoke({}, config);

    const resumed = await build(new KnexCheckpointSaver(database)).invoke(new Command({ resume: 'later' }), config);
    expect(resumed).toEqual({ log: ['before', 'asked', 'after:later'], answer: 'later' });
  });
});
