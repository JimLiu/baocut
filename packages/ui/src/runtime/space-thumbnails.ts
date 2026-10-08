import { RpcError, type Id, type SpaceEntryKind, type SpaceThumbnail } from '@baocut/protocol';
import { NO_THUMBNAIL, toThumbnail, type Thumbnail } from '../model/space-thumbnail.ts';

export interface SpaceThumbnailCacheOptions {
  now?: () => number;
  /** 延后执行（失败重试、视频复查、合并通知）。 */
  schedule?: (run: () => void, ms: number) => void;
  /** 同时在路上的请求。 */
  concurrency?: number;
  /** 最多记住多少个条目的缩略图（data URL，一张几十 KB）。 */
  maxEntries?: number;
  /** 排队最多这么多：再多就丢掉最早排进来的（还看得见的话版本变了或重新挂上时再排）。 */
  maxQueue?: number;
}

interface Slot {
  kind: SpaceEntryKind;
  /** 现在要的版本（`thumbnailVersion`）。 */
  version: string;
  /** 最近拿到的缩略图；版本变了、新的还没到时先画旧的，不闪回占位。 */
  value: Thumbnail | null;
  phase: 'idle' | 'queued' | 'loading' | 'done' | 'failed';
  failures: number;
  /** 视频答了 `none` 之后复查过几次。 */
  rechecks: number;
  /** 挂着的卡片或行有几个；为 0 时排队的不再发。 */
  interest: number;
}

/** 失败一次立刻再要一次（多半是超时：Runtime 照样算完并缓存，再要一次就命中）；之后隔这么久，每次翻倍。 */
const RETRY_MS = 15_000;
/** 连续失败这么多次就不再要，直到条目变了。 */
const DEAD_AFTER = 4;
/** 视频的内容索引还没追平时 Runtime 答 `none`，追平了也不一定有 `entry.upsert`：隔一阵复查，最多这么多次。 */
const VIDEO_RECHECK_MS = 20_000;
const VIDEO_RECHECKS = 2;
/** 合并通知：一批缩略图到了只重画一次。 */
const NOTIFY_MS = 30;

/**
 * Space 条目缩略图的缓存（`space.thumbnail`；网格的卡片与列表的名称列）。按条目记住，条目的版本变了就重取。
 *
 * - 卡片或行挂上时 `retain`，卸下时放掉；只为挂着的取（列表虚拟化，挂着约等于看得见）。滚走了还在排队的不再发。
 * - 后排进来的先取（刚滚到的那几行），同时只发几个请求，排队的条数有上限；记住的条目有上限，最久没用的先丢。
 * - `not-found`、`forbidden` 当作没有，不重试；其余的失败立刻再要一次，之后退避，几次都不行就放弃。
 */
export class SpaceThumbnailCache {
  readonly #request: (entryId: Id) => Promise<SpaceThumbnail>;
  readonly #schedule: (run: () => void, ms: number) => void;
  readonly #concurrency: number;
  readonly #maxEntries: number;
  readonly #maxQueue: number;
  readonly #slots = new Map<Id, Slot>();
  readonly #queue: Id[] = [];
  readonly #listeners = new Set<() => void>();
  #running = 0;
  #generation = 0;
  #version = 0;
  #notifying = false;

  constructor(request: (entryId: Id) => Promise<SpaceThumbnail>, options: SpaceThumbnailCacheOptions = {}) {
    this.#request = request;
    this.#schedule = options.schedule ?? ((run, ms) => void setTimeout(run, ms));
    this.#concurrency = options.concurrency ?? 4;
    this.#maxEntries = options.maxEntries ?? 300;
    this.#maxQueue = options.maxQueue ?? 120;
  }

  /** 条目现在能画的缩略图（可能是上一版的）；还没有时 null。不发请求，同一份结果返回同一个对象。 */
  peek(entryId: Id): Thumbnail | null {
    return this.#slots.get(entryId)?.value ?? null;
  }

  /** 卡片或行挂上：要这个版本的缩略图。返回放掉的函数。 */
  retain(entryId: Id, kind: SpaceEntryKind, version: string): () => void {
    let slot = this.#slots.get(entryId);
    if (slot) {
      // 最近用过的挪到最后，超出上限时从前面丢。
      this.#slots.delete(entryId);
      this.#slots.set(entryId, slot);
    } else {
      slot = {
        kind,
        version,
        value: null,
        phase: 'idle',
        failures: 0,
        rechecks: 0,
        interest: 0,
      };
      this.#slots.set(entryId, slot);
    }
    slot.interest++;
    if (slot.version !== version) {
      slot.kind = kind;
      slot.version = version;
      slot.failures = 0;
      slot.rechecks = 0;
      if (slot.phase !== 'loading' && slot.phase !== 'queued') slot.phase = 'idle';
    }
    if (slot.phase === 'idle') this.#enqueue(entryId, slot);
    else if (slot.phase === 'queued') this.#prioritise(entryId);
    this.#evict();
    const held = slot;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      held.interest = Math.max(0, held.interest - 1);
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** 每次通知加一（给 `useSyncExternalStore`）。 */
  version = (): number => this.#version;

  /**
   * 重新连上 Runtime：断开期间的失败不算数（请求在发出之前就被拒了），放弃了的也重新要。
   * 已经拿到的照旧画，不重取；还挂着的立刻排上，不挂着的等下次挂上。
   */
  revive(): void {
    for (const [entryId, slot] of this.#slots) {
      if (slot.phase !== 'failed') continue;
      slot.failures = 0;
      this.#requeue(entryId, slot);
    }
  }

  /** 断开会话：都丢掉，路上的请求回来也不收。 */
  clear(): void {
    this.#generation++;
    this.#slots.clear();
    this.#queue.length = 0;
  }

  #enqueue(entryId: Id, slot: Slot): void {
    slot.phase = 'queued';
    this.#queue.push(entryId);
    while (this.#queue.length > this.#maxQueue) {
      const dropped = this.#slots.get(this.#queue.shift()!);
      if (dropped?.phase === 'queued') dropped.phase = 'idle';
    }
    // 一次渲染挂上的一批排完再发，后挂上的先取。
    queueMicrotask(() => this.#pump());
  }

  #prioritise(entryId: Id): void {
    const at = this.#queue.lastIndexOf(entryId);
    if (at >= 0) this.#queue.splice(at, 1);
    this.#queue.push(entryId);
  }

  #pump(): void {
    while (this.#running < this.#concurrency && this.#queue.length) {
      const entryId = this.#queue.pop()!;
      const slot = this.#slots.get(entryId);
      if (slot?.phase !== 'queued') continue;
      if (slot.interest === 0) {
        // 已经滚走了：不发，重新挂上时再排。
        slot.phase = 'idle';
        continue;
      }
      this.#load(entryId, slot);
    }
  }

  #load(entryId: Id, slot: Slot): void {
    const generation = this.#generation;
    const version = slot.version;
    slot.phase = 'loading';
    this.#running++;
    this.#request(entryId)
      .then(
        (result) => {
          if (generation !== this.#generation) return;
          slot.value = toThumbnail(result);
          if (slot.version !== version) return this.#requeue(entryId, slot);
          slot.phase = 'done';
          slot.failures = 0;
          if (slot.value.kind === 'none' && slot.kind === 'video' && slot.rechecks < VIDEO_RECHECKS) {
            slot.rechecks++;
            this.#later(entryId, slot, version, VIDEO_RECHECK_MS);
          }
        },
        (error: unknown) => {
          if (generation !== this.#generation) return;
          if (slot.version !== version) return this.#requeue(entryId, slot);
          if (error instanceof RpcError && (error.code === 'not-found' || error.code === 'forbidden')) {
            slot.value = NO_THUMBNAIL;
            slot.phase = 'done';
            return;
          }
          slot.failures++;
          slot.phase = 'failed';
          if (slot.failures === 1) this.#requeue(entryId, slot);
          else if (slot.failures < DEAD_AFTER) this.#later(entryId, slot, version, RETRY_MS * 2 ** (slot.failures - 2));
        },
      )
      .finally(() => {
        this.#running--;
        if (generation === this.#generation) this.#notify();
        this.#evict();
        this.#pump();
      });
  }

  /** 版本在路上变了，或失败后立刻再要：还挂着就重新排，不挂着就等下次挂上。 */
  #requeue(entryId: Id, slot: Slot): void {
    if (slot.interest > 0) this.#enqueue(entryId, slot);
    else slot.phase = 'idle';
  }

  /** 过一阵再要（退避与视频复查）：到时候条目没变、还在缓存里才排。 */
  #later(entryId: Id, slot: Slot, version: string, ms: number): void {
    const generation = this.#generation;
    this.#schedule(() => {
      if (generation !== this.#generation || this.#slots.get(entryId) !== slot || slot.version !== version) return;
      if (slot.phase !== 'done' && slot.phase !== 'failed') return;
      this.#requeue(entryId, slot);
    }, ms);
  }

  #evict(): void {
    if (this.#slots.size <= this.#maxEntries) return;
    for (const [entryId, slot] of this.#slots) {
      if (this.#slots.size <= this.#maxEntries) break;
      if (slot.interest === 0 && slot.phase !== 'loading' && slot.phase !== 'queued') this.#slots.delete(entryId);
    }
  }

  #notify(): void {
    if (this.#notifying) return;
    this.#notifying = true;
    this.#schedule(() => {
      this.#notifying = false;
      this.#version++;
      for (const listener of this.#listeners) listener();
    }, NOTIFY_MS);
  }
}
