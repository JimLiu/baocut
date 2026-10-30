import {
  clampOutput,
  nowIso,
  type Conversation,
  type ConversationEvent,
  type ConversationPage,
  type ConversationSearch,
  type ConversationSearchHit,
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
 * 在会话之外留下作用的条目（产品设计 §6.1）：新建或改过视频、幻灯片、设计稿、设计系统，改过文件，或请求过审批。
 * 任务有过这样的条目才进后台任务表；只检索、问答（命令、MCP 读取、联网搜索）不算。审批只算要问的（等用户、用户或
 * 「总是允许」规则答的）：按访问模式自动答的连读取也会留卡片，自动放行的写入另有修改条目算上；来时已取消的也不算。
 */
export function isSideEffect(item: TimelineItem): boolean {
  switch (item.kind) {
    case 'approval':
      return item.decidedBy !== 'auto' && item.status !== 'cancelled';
    case 'video-change':
    case 'video-created':
    case 'slides-created':
    case 'design-created':
    case 'design-system-created':
      return true;
    case 'tool-call':
      return item.tool === 'file-change';
    default:
      return false;
  }
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
  /** 有过会话外作用的任务（`isSideEffect`）。 */
  readonly #effectful = new Set<Id>();

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
    record.items.forEach((item, i) => {
      this.#index.set(item.id, i);
      if (item.taskId && isSideEffect(item)) this.#effectful.add(item.taskId);
    });
    this.log = new TopicLog(() => this.snapshot(), record.seq);
  }

  get conversation(): Conversation {
    return this.record.conversation;
  }

  get id(): Id {
    return this.record.conversation.id;
  }

  /**
   * 快照。`tail`：只要最近几个回合（架构设计 §11.3），从后往前数第 `tail` 个回合的开头切开，`offset` 是切口；
   * 切口之前、被这一段引用的任务条目（完成收件箱唤醒的旧任务）放在最前面，之后它的更新客户端按 id 接住。回合不够时整份。
   */
  snapshot(tail?: number): ConversationSnapshot {
    const conversation = this.record.conversation;
    const items = this.record.items;
    const offset = tail === undefined ? 0 : turnStart(items, items.length, tail);
    if (offset === 0) return { conversation, items };
    const slice = items.slice(offset);
    return { conversation, items: [...this.#pinnedTasks(slice, offset), ...slice], offset };
  }

  /** 往前一页：`before` 之前最近 `turns` 个回合，切口对齐回合开头；同样带上这一页引用的、更早的任务条目。 */
  page(before: number, turns: number): ConversationPage {
    const items = this.record.items;
    const end = Math.min(Math.max(0, before), items.length);
    const offset = turnStart(items, end, turns);
    const slice = items.slice(offset, end);
    return { items: [...this.#pinnedTasks(slice, offset), ...slice], offset };
  }

  /**
   * 在会话中查找（`conversations.search`）：用户消息与回复正文里不分大小写、不重叠地数。从最近的往前数，数满 `limit` 处就停，
   * 更早还有时 `truncated`；结果按记录先后。
   */
  search(query: string, limit: number): ConversationSearch {
    const needle = query.toLowerCase();
    const items = this.record.items;
    const hits: ConversationSearchHit[] = [];
    let total = 0;
    let truncated = false;
    for (let i = items.length - 1; needle && i >= 0 && !truncated; i--) {
      const item = items[i]!;
      if (item.kind !== 'user-message' && item.kind !== 'agent-message') continue;
      const text = item.text.toLowerCase();
      let count = 0;
      for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
        if (total + count === limit) {
          truncated = true;
          break;
        }
        count++;
      }
      if (count) hits.push({ itemId: item.id, index: i, count });
      total += count;
    }
    return { hits: hits.reverse(), truncated };
  }

  /** `slice` 里的条目引用、本身在 `offset` 之前的任务条目，按记录里的先后。 */
  #pinnedTasks(slice: readonly TimelineItem[], offset: number): TimelineItem[] {
    const indexes = new Set<number>();
    for (const item of slice) {
      if (!item.taskId) continue;
      const i = this.#index.get(item.taskId);
      if (i !== undefined && i < offset && this.record.items[i]?.kind === 'task') indexes.add(i);
    }
    return [...indexes].sort((a, b) => a - b).map((i) => this.record.items[i]!);
  }

  item(id: Id): TimelineItem | undefined {
    const i = this.#index.get(id);
    return i === undefined ? undefined : this.record.items[i];
  }

  items(): readonly TimelineItem[] {
    return this.record.items;
  }

  upsert(item: TimelineItem): void {
    let index = this.#index.get(item.id);
    if (index === undefined) {
      index = this.record.items.length;
      this.#index.set(item.id, index);
      this.record.items.push(item);
    } else {
      this.record.items[index] = item;
    }
    this.#publishOrdered({ type: 'item.upsert', item, index });
    if (item.kind === 'task') {
      this.#onTaskChanged(item);
    } else if (item.taskId && !this.#effectful.has(item.taskId) && isSideEffect(item)) {
      // 任务第一次在会话外留下作用：补发一次任务变化，任务表据此收进它。
      this.#effectful.add(item.taskId);
      const task = this.item(item.taskId);
      if (task?.kind === 'task') this.#onTaskChanged(task);
    }
  }

  /** 这个任务有没有在会话外留下过作用（`isSideEffect`）。 */
  hasSideEffects(taskId: Id): boolean {
    return this.#effectful.has(taskId);
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
    tail?: number,
  ): TopicSubscription<ConversationSnapshot, ConversationEvent> {
    this.flush();
    return this.log.subscribe(afterSeq, listener, tail === undefined ? undefined : () => this.snapshot(tail));
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

/**
 * `end` 之前从后往前数第 `turns` 个回合的开头。回合按任务第一次出现的位置算（用户消息在前，任务条目紧随其后）；
 * 完成收件箱唤醒的旧任务接着写的条目不算新回合。回合不够时是 0。
 */
function turnStart(items: readonly TimelineItem[], end: number, turns: number): number {
  const seen = new Set<Id>();
  const starts: number[] = [];
  for (let i = 0; i < end; i++) {
    const taskId = items[i]!.taskId;
    if (!taskId || seen.has(taskId)) continue;
    seen.add(taskId);
    starts.push(i);
  }
  return starts.length > turns ? starts[starts.length - turns]! : 0;
}
