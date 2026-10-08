import { compareSeq, nextSeq, type Seq, type SequencedEvent, type SubscribeResult } from '@baocut/protocol';

export interface TopicSubscription<S, E> {
  result: SubscribeResult<S, E>;
  unsubscribe: () => void;
}

/**
 * 一个主题的有序事件流（架构设计 §4.4）。
 *
 * - 状态变更与 `publish` 在同一个同步段里完成，所以「快照 + 其后的事件」天然同一水位。
 * - 保留最近一段事件用于断线补发；补不齐时给快照，不在缺事件的镜像上继续。
 */
export class TopicLog<S, E> {
  readonly #snapshot: () => S;
  readonly #capacity: number;
  readonly #buffer: SequencedEvent<E>[] = [];
  readonly #listeners = new Set<(event: SequencedEvent<E>) => void>();
  #seq: Seq;

  constructor(snapshot: () => S, initialSeq: Seq, capacity = 2000) {
    this.#snapshot = snapshot;
    this.#seq = initialSeq;
    this.#capacity = capacity;
  }

  get seq(): Seq {
    return this.#seq;
  }

  publish(event: E): Seq {
    this.#seq = nextSeq(this.#seq);
    const sequenced = { seq: this.#seq, event };
    this.#buffer.push(sequenced);
    if (this.#buffer.length > this.#capacity) this.#buffer.splice(0, this.#buffer.length - this.#capacity);
    for (const listener of this.#listeners) listener(sequenced);
    return this.#seq;
  }

  subscribe(afterSeq: Seq | undefined, listener: (event: SequencedEvent<E>) => void): TopicSubscription<S, E> {
    this.#listeners.add(listener);
    return { result: this.#initial(afterSeq), unsubscribe: () => this.#listeners.delete(listener) };
  }

  #initial(afterSeq: Seq | undefined): SubscribeResult<S, E> {
    if (afterSeq !== undefined && compareSeq(afterSeq, this.#seq) <= 0) {
      if (compareSeq(afterSeq, this.#seq) === 0) return { mode: 'replay', seq: this.#seq, events: [] };
      const first = this.#buffer[0];
      if (first && compareSeq(first.seq, nextSeq(afterSeq)) <= 0) {
        return {
          mode: 'replay',
          seq: this.#seq,
          events: this.#buffer.filter((e) => compareSeq(e.seq, afterSeq) > 0),
        };
      }
    }
    return { mode: 'snapshot', seq: this.#seq, snapshot: this.#snapshot() };
  }

  /** 主题被删除时断开所有订阅者。 */
  clear(): void {
    this.#listeners.clear();
  }
}
