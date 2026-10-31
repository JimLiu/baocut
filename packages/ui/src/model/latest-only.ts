/**
 * 异步结果的闸门：页面切了范围（标签、频道）之后才回来的结果，或者已经被更新的一次请求取代的结果，一律丢掉。
 * 记忆页用它保证「频道记忆」的读写结果不会落到「用户偏好」标签上，再被当成那边的内容存回去。
 */
export type GateResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export class LatestOnly {
  #key: string;
  #seq = 0;

  constructor(key: string) {
    this.#key = key;
  }

  /** 每次渲染时告诉闸门当前范围；范围一变，之前发出的请求都作废。 */
  setKey(key: string): void {
    if (key === this.#key) return;
    this.#key = key;
    this.#seq++;
  }

  /** 跑一次请求；结果仍属于当前范围且是最新一次时才返回，否则返回 null。 */
  async run<T>(fn: () => Promise<T>): Promise<GateResult<T> | null> {
    const seq = ++this.#seq;
    const key = this.#key;
    const fresh = () => seq === this.#seq && key === this.#key;
    try {
      const value = await fn();
      return fresh() ? { ok: true, value } : null;
    } catch (error) {
      return fresh() ? { ok: false, error } : null;
    }
  }
}
