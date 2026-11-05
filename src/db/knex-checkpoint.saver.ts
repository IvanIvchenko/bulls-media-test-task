import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from '@langchain/langgraph';
import {
  WRITES_IDX_MAP,
  compareWritesSortKeys,
  writesSortKey,
  type ChannelVersions,
  type CheckpointListOptions,
  type CheckpointPendingWrite,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';

import { TABLE } from './constants.js';
import type { Database } from './typedef.js';

type Config = Parameters<BaseCheckpointSaver['getTuple']>[0];

interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint_type: string;
  metadata_type: string;
  checkpoint: Uint8Array;
  metadata: Uint8Array;
}

interface WriteRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  task_id: string;
  idx: number;
  channel: string;
  value_type: string;
  value: Uint8Array;
  task_path: string;
}

const WRITE_KEY = ['thread_id', 'checkpoint_ns', 'checkpoint_id', 'task_id', 'idx'];
const CHECKPOINT_KEY = ['thread_id', 'checkpoint_ns', 'checkpoint_id'];

/**
 * LangGraph's checkpoint store on the application's own Knex handle, so a paused run lives in the same database as
 * everything else that decides correctness, so it survives a restart. It follows the
 * `BaseCheckpointSaver` contract (the in-memory saver is the reference) and nothing more.
 *
 * The ready-made SQLite and Postgres savers each open their own driver connection. Here that would break two rules: one
 * SQLite connection per process (a second can deadlock the synchronous driver), and no driver types outside `db/`.
 */
export class KnexCheckpointSaver extends BaseCheckpointSaver {
  public constructor(private readonly database: Database) {
    super();
  }

  public async getTuple(config: Config): Promise<CheckpointTuple | undefined> {
    const { threadId, namespace, checkpointId } = this.keyOf(config);
    const query = this.database<CheckpointRow>(TABLE.GRAPH_CHECKPOINTS).where({
      thread_id: threadId,
      checkpoint_ns: namespace,
    });
    const row = await (
      checkpointId ? query.where({ checkpoint_id: checkpointId }) : query.orderBy('checkpoint_id', 'desc')
    ).first();
    if (!row) return undefined;
    return this.toTuple(row, checkpointId ? config : undefined);
  }

  public async *list(config: Config, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const namespace = config.configurable?.checkpoint_ns as string | undefined;
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    const before = options?.before?.configurable?.checkpoint_id as string | undefined;

    const query = this.database<CheckpointRow>(TABLE.GRAPH_CHECKPOINTS).orderBy('checkpoint_id', 'desc');
    if (threadId !== undefined) query.where({ thread_id: threadId });
    if (namespace !== undefined) query.where({ checkpoint_ns: namespace });
    if (checkpointId) query.where({ checkpoint_id: checkpointId });
    if (before) query.where('checkpoint_id', '<', before);
    if (options?.limit !== undefined && !options.filter) query.limit(Math.max(options.limit, 0));

    let remaining = options?.limit;
    for (const row of await query) {
      if (remaining !== undefined && remaining <= 0) return;
      const tuple = await this.toTuple(row);
      const { filter } = options ?? {};
      if (
        filter &&
        !Object.entries(filter).every(([key, value]) => (tuple.metadata as Record<string, unknown>)[key] === value)
      ) {
        continue;
      }
      if (remaining !== undefined) remaining -= 1;
      yield tuple;
    }
  }

  /** The channel versions are already inside the checkpoint, so the separate argument has nothing to add. */
  public async put(
    config: Config,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions?: ChannelVersions,
  ): Promise<Config> {
    const threadId = this.threadOf(config);
    const namespace = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const [checkpointType, checkpointBytes] = await this.serde.dumpsTyped(checkpoint);
    const [metadataType, metadataBytes] = await this.serde.dumpsTyped(metadata);
    const row: CheckpointRow = {
      thread_id: threadId,
      checkpoint_ns: namespace,
      checkpoint_id: checkpoint.id,
      parent_checkpoint_id: (config.configurable?.checkpoint_id as string | undefined) ?? null,
      checkpoint_type: checkpointType,
      metadata_type: metadataType,
      checkpoint: Buffer.from(checkpointBytes),
      metadata: Buffer.from(metadataBytes),
    };
    await this.database(TABLE.GRAPH_CHECKPOINTS).insert(row).onConflict(CHECKPOINT_KEY).merge();
    return { configurable: { thread_id: threadId, checkpoint_ns: namespace, checkpoint_id: checkpoint.id } };
  }

  /**
   * An ordinary write is kept once: the same task writing again (a retry) does not overwrite it. The special channels
   * (errors, interrupts, resume values) have fixed negative positions and do replace what was there.
   */
  public async putWrites(config: Config, writes: PendingWrite[], taskId: string, taskPath?: string): Promise<void> {
    const threadId = this.threadOf(config);
    const namespace = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (checkpointId === undefined) throw new TypeError('Cannot store writes without a checkpoint_id.');

    await this.database.transaction(async (trx) => {
      for (const [position, [channel, value]] of writes.entries()) {
        const idx = WRITES_IDX_MAP[channel] ?? position;
        const [valueType, valueBytes] = await this.serde.dumpsTyped(value);
        const row: WriteRow = {
          thread_id: threadId,
          checkpoint_ns: namespace,
          checkpoint_id: checkpointId,
          task_id: taskId,
          idx,
          channel,
          value_type: valueType,
          value: Buffer.from(valueBytes),
          task_path: taskPath ?? '',
        };
        const insert = trx(TABLE.GRAPH_WRITES).insert(row).onConflict(WRITE_KEY);
        await (idx >= 0 ? insert.ignore() : insert.merge());
      }
    });
  }

  public async deleteThread(threadId: string): Promise<void> {
    await this.database.transaction(async (trx) => {
      await trx(TABLE.GRAPH_WRITES).where({ thread_id: threadId }).del();
      await trx(TABLE.GRAPH_CHECKPOINTS).where({ thread_id: threadId }).del();
    });
  }

  private async toTuple(row: CheckpointRow, givenConfig?: Config): Promise<CheckpointTuple> {
    const location = { thread_id: row.thread_id, checkpoint_ns: row.checkpoint_ns };
    const tuple: CheckpointTuple = {
      config: givenConfig ?? { configurable: { ...location, checkpoint_id: row.checkpoint_id } },
      checkpoint: (await this.serde.loadsTyped(row.checkpoint_type, row.checkpoint)) as Checkpoint,
      metadata: (await this.serde.loadsTyped(row.metadata_type, row.metadata)) as CheckpointMetadata,
      pendingWrites: await this.pendingWrites(row),
    };
    if (row.parent_checkpoint_id !== null) {
      tuple.parentConfig = { configurable: { ...location, checkpoint_id: row.parent_checkpoint_id } };
    }
    return tuple;
  }

  /** In the order live execution applied them: by task path, task id, then position. */
  private async pendingWrites(row: CheckpointRow): Promise<CheckpointPendingWrite[]> {
    const rows = await this.database<WriteRow>(TABLE.GRAPH_WRITES).where({
      thread_id: row.thread_id,
      checkpoint_ns: row.checkpoint_ns,
      checkpoint_id: row.checkpoint_id,
    });
    rows.sort((a, b) =>
      compareWritesSortKeys(writesSortKey(a.task_path, a.task_id, a.idx), writesSortKey(b.task_path, b.task_id, b.idx)),
    );
    return Promise.all(
      rows.map(async (write): Promise<CheckpointPendingWrite> => [
        write.task_id,
        write.channel,
        await this.serde.loadsTyped(write.value_type, write.value),
      ]),
    );
  }

  private keyOf(config: Config) {
    return {
      threadId: this.threadOf(config),
      namespace: (config.configurable?.checkpoint_ns as string | undefined) ?? '',
      checkpointId: config.configurable?.checkpoint_id as string | undefined,
    };
  }

  private threadOf(config: Config): string {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) throw new TypeError('A checkpointer needs a thread_id in the run configuration.');
    return threadId;
  }
}
