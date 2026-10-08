import {
  clampOutput,
  nowIso,
  type Conversation,
  type ConversationEvent,
  type ConversationSnapshot,
  type Id,
  type Seq,
  type SequencedEvent,
  type TimelineItem,
} from '@baocut/protocol';
import type { ConversationRecord } from '@baocut/runtime-storage';
import { TopicLog, type TopicSubscription } from './topic-log.ts';

/** 流式文本增量的默认合并窗口（毫秒）。 */
export const DEFAULT_APPEND_WINDOW_MS = 60;

/** 某个 `itemId + field` 的合并状态：上次发布时间与窗口内待发的增量。 */
interface PendingAppend {
  itemId: Id;
  field: 'text' | 'output';
  delta: string;
  lastPublishedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * 一个会话的内存状态：持久记录 + 条目索引 + 事件流。
 * 每次修改都同步标脏，序号随记录一起落盘。
 *
 * 流式文本增量按 `itemId + field` 合并（架构设计 §11.3）：记录里的文本同步追加，
 * 事件则「前沿立即发、窗口内合并、到期发一次」。任何非 append 事件、订阅与快照读取之前
 * 先 `flush()`，所以客户端看到终态事件或拿到快照时，之前的文本增量都已按序发布。
 */
export class ConversationState {
  readonly record: ConversationRecord;
  readonly log: TopicLog<ConversationSnapshot, ConversationEvent>;
  readonly #index = new Map<Id, number>();
  readonly #dirty: () => void;
  readonly #onConversationChanged: (conversation: Conversation, previous: Conversation) => void;
  readonly #onTaskChanged: (task: Extract<TimelineItem, { kind: 'task' }>) => void;
  readonly #appendWindowMs: number;
  readonly #appends = new Map<string, PendingAppend>();

  constructor(
    record: ConversationRecord,
    hooks: {
      dirty: () => void;
      conversationChanged: (conversation: Conversation, previous: Conversation) => void;
      taskChanged: (task: Extract<TimelineItem, { kind: 'task' }>) => void;
    },
    options: { appendWindowMs?: number } = {},
  ) {
    this.#appendWindowMs = Math.max(0, options.appendWindowMs ?? DEFAULT_APPEND_WINDOW_MS);
    this.record = record;
    this.#dirty = hooks.dirty;
    this.#onConversationChanged = hooks.conversationChanged;
    this.#onTaskChanged = hooks.taskChanged;
    record.items.forEach((item, i) => this.#index.set(item.id, i));
    this.log = new TopicLog(() => this.snapshot(), record.seq);
  }

  get conversation(): Conversation {
    return this.record.conversation;
  }

  get id(): Id {
    return this.record.conversation.id;
  }

  snapshot(): ConversationSnapshot {
    return { conversation: this.record.conversation, items: this.record.items };
  }

  item(id: Id): TimelineItem | undefined {
    const i = this.#index.get(id);
    return i === undefined ? undefined : this.record.items[i];
  }

  items(): readonly TimelineItem[] {
    return this.record.items;
  }

  upsert(item: TimelineItem): void {
    const i = this.#index.get(item.id);
    if (i === undefined) {
      this.#index.set(item.id, this.record.items.length);
      this.record.items.push(item);
    } else {
      this.record.items[i] = item;
    }
    this.#publishOrdered({ type: 'item.upsert', item });
    if (item.kind === 'task') this.#onTaskChanged(item);
  }

  tasks(): Extract<TimelineItem, { kind: 'task' }>[] {
    return this.record.items.filter((item): item is Extract<TimelineItem, { kind: 'task' }> => item.kind === 'task');
  }

  /** 追加流式文本。`output` 超过上限时只保留末尾。 */
  append(id: Id, field: 'text' | 'output', delta: string): void {
    const item = this.item(id);
    if (!item || !delta) return;
    if (field === 'text' && (item.kind === 'agent-message' || item.kind === 'reasoning')) {
      item.text += delta;
    } else if (field === 'output' && item.kind === 'tool-call') {
      item.output = clampOutput(item.output + delta);
    } else {
      return;
    }
    this.#dirty();
    this.#queueAppend(id, field, delta);
  }

  /** 把所有待发的文本增量立即按序发布。 */
  flush(): void {
    for (const entry of this.#appends.values()) this.#publishPending(entry);
  }

  /** 订阅前先 flush：快照里已含待发增量，不 flush 的话订阅者会再收到一遍同一段文本。 */
  subscribe(
    afterSeq: Seq | undefined,
    listener: (event: SequencedEvent<ConversationEvent>) => void,
  ): TopicSubscription<ConversationSnapshot, ConversationEvent> {
    this.flush();
    return this.log.subscribe(afterSeq, listener);
  }

  /** 会话被丢弃：清掉定时器，未发的增量不再发布（订阅者随后被断开）。 */
  dispose(): void {
    for (const entry of this.#appends.values()) if (entry.timer) clearTimeout(entry.timer);
    this.#appends.clear();
  }

  /** `touch: false`：置顶、已读这类整理动作不算活动，不改变「最近活动」的排序。 */
  updateConversation(patch: Partial<Omit<Conversation, 'id'>>, options: { touch?: boolean } = {}): Conversation {
    const previous = this.record.conversation;
    const next = { ...previous, ...patch, updatedAt: options.touch === false ? previous.updatedAt : nowIso() };
    this.record.conversation = next;
    this.#publishOrdered({ type: 'conversation.updated', conversation: next });
    this.#onConversationChanged(next, previous);
    return next;
  }

  #queueAppend(itemId: Id, field: 'text' | 'output', delta: string): void {
    const key = `${itemId}\0${field}`;
    const now = Date.now();
    let entry = this.#appends.get(key);
    if (!entry) {
      this.#prune(now);
      entry = { itemId, field, delta: '', lastPublishedAt: Number.NEGATIVE_INFINITY, timer: null };
      this.#appends.set(key, entry);
    }
    entry.delta += delta;
    if (entry.timer) return; // 窗口内已有待发定时器：只合并
    const wait = entry.lastPublishedAt + this.#appendWindowMs - now;
    if (wait <= 0) {
      this.#publishPending(entry);
      return;
    }
    entry.timer = setTimeout(() => this.#publishPending(entry), wait);
    entry.timer.unref?.();
  }

  #publishPending(entry: PendingAppend): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (!entry.delta) return;
    const delta = entry.delta;
    entry.delta = '';
    entry.lastPublishedAt = Date.now();
    this.#publish({ type: 'item.append', itemId: entry.itemId, field: entry.field, delta });
  }

  /** 丢掉窗口早已过去、没有待发内容的条目，避免长会话里 Map 一直增长。 */
  #prune(now: number): void {
    if (this.#appends.size < 64) return;
    for (const [key, entry] of this.#appends) {
      if (!entry.timer && !entry.delta && now - entry.lastPublishedAt >= this.#appendWindowMs) this.#appends.delete(key);
    }
  }

  /** 非 append 事件：完成边界，先刷出待发增量。 */
  #publishOrdered(event: ConversationEvent): void {
    this.flush();
    this.#publish(event);
  }

  #publish(event: ConversationEvent): void {
    this.record.seq = this.log.publish(event);
    this.#dirty();
  }
}
