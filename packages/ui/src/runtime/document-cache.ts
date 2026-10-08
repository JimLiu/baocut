import type { DocumentContent, Id, Revision } from '@baocut/protocol';

type Entry = { state: 'loading' } | { state: 'ready'; body: unknown } | { state: 'failed'; at: number };

/** 取失败之后隔这么久才再取（连接断开、Runtime 重启时会失败一阵）。 */
const RETRY_MS = 3000;

/**
 * 文档正文的缓存（视频格式规范 §4.4：正文按版本保存，不随快照下发）。一个版本的正文不会再变，按「文档@版本」记住；
 * 预览与时间线共用一份，取到了通知订阅者重画。
 */
export class DocumentCache {
  readonly #read: (documentId: Id, revision: Revision) => Promise<DocumentContent>;
  readonly #entries = new Map<string, Entry>();
  readonly #listeners = new Set<() => void>();
  #generation = 0;

  constructor(read: (documentId: Id, revision: Revision) => Promise<DocumentContent>) {
    this.#read = read;
  }

  /** 已经取到的正文；还没有时是 undefined。不发请求（React 渲染里也能调）。 */
  peek(documentId: Id, revision: Revision): unknown {
    const entry = this.#entries.get(key(documentId, revision));
    return entry?.state === 'ready' ? entry.body : undefined;
  }

  /** 还没有就去取；正在取或刚失败过就不重复发。 */
  load(documentId: Id, revision: Revision): void {
    const k = key(documentId, revision);
    const entry = this.#entries.get(k);
    if (entry && (entry.state !== 'failed' || performance.now() - entry.at < RETRY_MS)) return;
    const generation = this.#generation;
    const pending: Entry = { state: 'loading' };
    this.#entries.set(k, pending);
    this.#read(documentId, revision).then(
      (content) => this.#settle(generation, k, pending, { state: 'ready', body: content.body }),
      () => this.#settle(generation, k, pending, { state: 'failed', at: performance.now() }),
    );
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 换了视频：旧视频的正文不再要，路上的请求回来也不收。 */
  clear(): void {
    this.#generation++;
    this.#entries.clear();
  }

  /** 忘掉还在路上的请求（预览卡住时的「重试」）：之后再要就重新发，路上的回来也不收；取到的照留。 */
  forgetPending(): void {
    for (const [k, entry] of [...this.#entries]) if (entry.state === 'loading') this.#entries.delete(k);
  }

  #settle(generation: number, k: string, pending: Entry, entry: Entry): void {
    if (generation !== this.#generation || this.#entries.get(k) !== pending) return;
    this.#entries.set(k, entry);
    for (const listener of this.#listeners) listener();
  }
}

function key(documentId: Id, revision: Revision): string {
  return `${documentId}@${revision}`;
}
