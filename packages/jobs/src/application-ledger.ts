import type { ApplicationRecord, Id } from '@baocut/protocol';
import { readJson, writeJsonAtomic } from '@baocut/runtime-storage';

/**
 * 应用账本（架构设计 §7.2）：`<runtime-home>/store/applications.json`，与任务账本分开。执行的结果（产物）与「应用到视频」
 * 是两条记录：一个任务可以有多次应用（重启后的补做、用户的 `jobs.reconcile apply`），每次都先落账再提交事务。
 *
 * 这里是应用状态的权威；任务记录里的 `applications` 是它的投影。每次写入都要等落盘（崩溃安全的顺序靠它），
 * 写入串行，后发起的写一定落在后面。
 */

/**
 * 重新打开视频要的位置（Runtime 给出、原样交回，JobManager 不解读）。重启之后视频都没有打开，补做应用之前
 * 按它重新打开；目录不见了或里面换成了别的视频就是 `stale-input`。
 */
export type VideoPlace = Record<string, unknown>;

/** 账本里的一条：公开记录，加上恢复时要的位置与已经提交过几次（下一个 `commandId` 的序号）。 */
export interface StoredApplication {
  record: ApplicationRecord;
  place: VideoPlace | null;
  submissions: number;
}

interface ApplicationsFile {
  formatVersion: 1;
  applications: StoredApplication[];
}

export class ApplicationLedger {
  readonly file: string;
  readonly #items = new Map<Id, StoredApplication>();
  #chain: Promise<void> = Promise.resolve();
  #frozen = false;

  constructor(file: string) {
    this.file = file;
  }

  async load(): Promise<void> {
    const data = await readJson<ApplicationsFile>(this.file).catch(() => null);
    this.#items.clear();
    if (!data || data.formatVersion !== 1 || !Array.isArray(data.applications)) return;
    for (const item of data.applications) {
      if (item && typeof item.record?.applicationId === 'string') this.#items.set(item.record.applicationId, item);
    }
  }

  get(applicationId: Id): StoredApplication | undefined {
    return this.#items.get(applicationId);
  }

  /** 一个任务的各次应用，旧的在前。 */
  forJob(jobId: Id): StoredApplication[] {
    return [...this.#items.values()].filter((item) => item.record.jobId === jobId);
  }

  /** 一个任务最近的一次应用；没有时 undefined。 */
  latest(jobId: Id): StoredApplication | undefined {
    return this.forJob(jobId).at(-1);
  }

  all(): StoredApplication[] {
    return [...this.#items.values()];
  }

  /** 写入一条并等它落盘。 */
  put(item: StoredApplication): Promise<void> {
    item.record.updatedAt = new Date().toISOString();
    this.#items.delete(item.record.applicationId);
    this.#items.set(item.record.applicationId, item);
    return this.#write();
  }

  /** 删掉这些任务的应用（任务被淘汰时）。 */
  remove(jobIds: ReadonlySet<Id>): Promise<void> {
    let changed = false;
    for (const [id, item] of this.#items) {
      if (!jobIds.has(item.record.jobId)) continue;
      this.#items.delete(id);
      changed = true;
    }
    return changed ? this.#write() : Promise.resolve();
  }

  /** 故障注入：模拟进程在这一刻崩溃，之后的写入都不落盘。 */
  freeze(): void {
    this.#frozen = true;
  }

  flush(): Promise<void> {
    return this.#chain;
  }

  #write(): Promise<void> {
    if (this.#frozen) return Promise.resolve();
    const data: ApplicationsFile = { formatVersion: 1, applications: structuredClone([...this.#items.values()]) };
    const next = this.#chain.then(() => (this.#frozen ? undefined : writeJsonAtomic(this.file, data, { durable: true })));
    this.#chain = next.catch(() => {});
    return next;
  }
}
