import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckResult, Conversation, DriverId, Id, Seq, TaskContract, TimelineItem } from '@baocut/protocol';
import { readJson, writeJsonAtomic } from './json-file.ts';

/**
 * 会话的持久形态（Runtime Store，架构设计 §3.10）。
 *
 * `agent.persistence` 是 Driver 给出的原生恢复句柄（例如 Codex 的 threadId）；
 * Runtime 只保存、不解释它。
 */
export interface ConversationRecord {
  schemaVersion: 1;
  conversation: Conversation;
  items: TimelineItem[];
  seq: Seq;
  agent: { driverId: DriverId; persistence: unknown };
  /**
   * 任务合同（架构设计 §3.2），按任务：全部修订（旧的在前，只追加）与验收检查的结果。0.x 早先写下的记录没有，
   * 读入时为它的任务补上默认合同，不升记录版本。
   */
  tasks?: Record<Id, TaskContractLog>;
}

/** 一个任务的合同修订与检查结果。 */
export interface TaskContractLog {
  revisions: TaskContract[];
  checkResults: CheckResult[];
}

const SAVE_DELAY_MS = 150;

/**
 * 内存为主、写后落盘。每个会话一个文件，写入走原子替换；
 * 停止时 `flush()` 等所有挂起的写入完成（架构设计 §2.4「持久化任务…」一步）。
 */
export class ConversationStore {
  readonly #dir: string;
  readonly #records = new Map<Id, ConversationRecord>();
  readonly #timers = new Map<Id, ReturnType<typeof setTimeout>>();
  readonly #writes = new Map<Id, Promise<void>>();

  constructor(dir: string) {
    this.#dir = dir;
  }

  async load(): Promise<ConversationRecord[]> {
    await fs.mkdir(this.#dir, { recursive: true });
    for (const name of await fs.readdir(this.#dir)) {
      if (!name.endsWith('.json')) continue;
      const record = await readJson<ConversationRecord>(path.join(this.#dir, name));
      if (record?.schemaVersion === 1) this.#records.set(record.conversation.id, record);
    }
    return [...this.#records.values()];
  }

  list(): ConversationRecord[] {
    return [...this.#records.values()];
  }

  get(id: Id): ConversationRecord | undefined {
    return this.#records.get(id);
  }

  put(record: ConversationRecord): void {
    this.#records.set(record.conversation.id, record);
    this.markDirty(record.conversation.id);
  }

  markDirty(id: Id): void {
    if (this.#timers.has(id)) return;
    this.#timers.set(
      id,
      setTimeout(() => {
        this.#timers.delete(id);
        void this.#save(id);
      }, SAVE_DELAY_MS),
    );
  }

  async delete(id: Id): Promise<void> {
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
    this.#records.delete(id);
    await this.#writes.get(id);
    await fs.rm(this.#file(id), { force: true });
  }

  async flush(): Promise<void> {
    for (const [id, timer] of this.#timers) {
      clearTimeout(timer);
      this.#timers.delete(id);
      void this.#save(id);
    }
    await Promise.all(this.#writes.values());
  }

  #file(id: Id): string {
    return path.join(this.#dir, `${id}.json`);
  }

  async #save(id: Id): Promise<void> {
    const previous = this.#writes.get(id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const record = this.#records.get(id);
        if (record) await writeJsonAtomic(this.#file(id), record);
      });
    this.#writes.set(id, next);
    try {
      await next;
    } finally {
      if (this.#writes.get(id) === next) this.#writes.delete(id);
    }
  }
}
