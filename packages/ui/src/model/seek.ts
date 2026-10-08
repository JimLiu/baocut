/**
 * 定位排队（产品设计 §11.1 的 0.3 出口条件「拖动定位时旧画面不覆盖新请求」，架构设计 §4.5）。
 *
 * 媒体元素同一时间只做一次 seek。拖动时新请求来得比 seek 完成快：只记下最新的一个，
 * 上一次 seek 完成（`seeked`）后再发它，中间的请求直接丢掉。正在定位时，界面显示的位置是
 * 最新的请求，而不是媒体元素报上来的旧时间；全部落地后才回到读媒体元素自己的时间。
 */

export interface Seekable {
  currentTime: number;
}

export class SeekQueue {
  readonly #media: Seekable;
  #inFlight: number | null = null;
  #pending: number | null = null;

  constructor(media: Seekable) {
    this.#media = media;
  }

  /** 请求定位到 `time` 秒。 */
  request(time: number): void {
    if (this.#inFlight === null) this.#apply(time);
    else this.#pending = time;
  }

  /** 媒体元素的 `seeked`。还有排着的请求就接着发；返回是否全部落地。 */
  settle(): boolean {
    if (this.#inFlight === null) return true;
    if (this.#pending !== null) {
      const next = this.#pending;
      this.#pending = null;
      this.#apply(next);
      return false;
    }
    this.#inFlight = null;
    return true;
  }

  /** 换了文件或加载失败：丢掉所有请求。 */
  reset(): void {
    this.#inFlight = null;
    this.#pending = null;
  }

  /** 正在定位时应当显示的位置（最新的请求）；没有在定位时为 null。 */
  get target(): number | null {
    return this.#pending ?? this.#inFlight;
  }

  #apply(time: number): void {
    this.#inFlight = time;
    this.#media.currentTime = time;
  }
}
