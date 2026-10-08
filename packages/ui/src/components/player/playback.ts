import { useSyncExternalStore } from 'react';
import { SeekQueue } from '../../model/seek.ts';
import { P } from './player-copy.ts';

/** 事件驱动的播放状态：只在事件发生时变，不随每一帧变。 */
export interface PlaybackStatus {
  ready: boolean;
  paused: boolean;
  ended: boolean;
  waiting: boolean;
  duration: number;
  /** 有画面（音频文件没有）。 */
  hasPicture: boolean;
  error: string | null;
}

const INITIAL: PlaybackStatus = { ready: false, paused: true, ended: false, waiting: false, duration: 0, hasPicture: false, error: null };

/** MediaError.code → 文案 key（出错时才读，跟当时的界面语言）。 */
const MEDIA_ERRORS: Record<number, 'aborted' | 'network' | 'decode' | 'unsupported'> = { 1: 'aborted', 2: 'network', 3: 'decode', 4: 'unsupported' };
const mediaErrorText = (code: number): string => P.mediaError[MEDIA_ERRORS[code] ?? 'other'];

type MediaWithFrames = HTMLMediaElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * 一个媒体元素的播放控制（架构设计 §4.5：播放时钟和拖动留在界面本地）。
 *
 * - 时间每帧读一次：有画面时取「这一帧画面」的时间（requestVideoFrameCallback），字幕跟着画面走；
 *   音频取 currentTime。
 * - 定位经 SeekQueue：拖动时只保留最新请求，正在定位时显示的就是它（验收 T30）。
 * - 组件按需订阅：时间（每帧）与状态（事件）分开，字幕列表只订阅由时间推出的句子序号。
 */
export class PlaybackController {
  readonly media: MediaWithFrames;
  readonly #queue: SeekQueue;
  readonly #timeListeners = new Set<() => void>();
  readonly #statusListeners = new Set<() => void>();
  #time = 0;
  #status: PlaybackStatus = INITIAL;
  #frame: number | null = null;
  #videoFrame: number | null = null;
  readonly #cleanup: () => void;

  constructor(media: HTMLMediaElement) {
    this.media = media as MediaWithFrames;
    this.#queue = new SeekQueue(media);
    const on = (type: string, handler: () => void) => {
      media.addEventListener(type, handler);
      return () => media.removeEventListener(type, handler);
    };
    const offs = [
      on('loadedmetadata', () =>
        this.#update({
          ready: true,
          duration: finite(media.duration),
          hasPicture: media instanceof HTMLVideoElement && media.videoWidth > 0,
        }),
      ),
      on('durationchange', () => this.#update({ duration: finite(media.duration) })),
      on('play', () => {
        this.#update({ paused: false, ended: false });
        this.#startLoop();
      }),
      on('pause', () => {
        this.#update({ paused: true });
        this.#stopLoop();
        this.#readTime();
      }),
      on('ended', () => {
        this.#update({ paused: true, ended: true });
        this.#stopLoop();
        this.#readTime();
      }),
      on('waiting', () => this.#update({ waiting: true })),
      on('playing', () => this.#update({ waiting: false })),
      on('canplay', () => this.#update({ waiting: false })),
      on('seeked', () => {
        this.#queue.settle();
        this.#readTime();
      }),
      on('timeupdate', () => {
        if (this.media.paused) this.#readTime();
      }),
      on('emptied', () => {
        this.#queue.reset();
        this.#update(INITIAL);
      }),
      on('error', () => {
        this.#queue.reset();
        this.#update({ error: mediaErrorText(media.error?.code ?? 0), waiting: false });
      }),
    ];
    this.#cleanup = () => {
      for (const off of offs) off();
      this.#stopLoop();
    };
  }

  dispose(): void {
    this.#cleanup();
  }

  // ---- 读 ----

  /** 显示用的位置：正在定位时是最新请求，否则是画面（或声音）的时间。 */
  get time(): number {
    return this.#time;
  }

  get status(): PlaybackStatus {
    return this.#status;
  }

  subscribeTime = (listener: () => void): (() => void) => {
    this.#timeListeners.add(listener);
    return () => this.#timeListeners.delete(listener);
  };

  subscribeStatus = (listener: () => void): (() => void) => {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  };

  // ---- 控制 ----

  toggle(): void {
    if (this.media.paused) this.play();
    else this.media.pause();
  }

  play(): void {
    if (this.#status.ended) this.seek(0);
    // 用户手势里调用；被拒绝（例如还没加载）时状态由事件说明，这里不报错。
    void this.media.play().catch(() => {});
  }

  pause(): void {
    this.media.pause();
  }

  seek(time: number): void {
    const duration = this.#status.duration;
    const target = Math.max(0, duration ? Math.min(time, duration) : time);
    if (this.#status.ended && target < duration) this.#update({ ended: false });
    this.#queue.request(target);
    this.#setTime(target);
  }

  nudge(delta: number): void {
    this.seek((this.#queue.target ?? this.#time) + delta);
  }

  // ---- 内部 ----

  #readTime(frameTime?: number): void {
    this.#setTime(this.#queue.target ?? frameTime ?? this.media.currentTime);
  }

  #setTime(time: number): void {
    if (time === this.#time) return;
    this.#time = time;
    for (const listener of this.#timeListeners) listener();
  }

  #update(patch: Partial<PlaybackStatus>): void {
    const next = { ...this.#status, ...patch };
    if ((Object.keys(next) as (keyof PlaybackStatus)[]).every((k) => next[k] === this.#status[k])) return;
    this.#status = next;
    for (const listener of this.#statusListeners) listener();
  }

  #startLoop(): void {
    this.#stopLoop();
    const media = this.media;
    if (this.#status.hasPicture && media.requestVideoFrameCallback) {
      const onFrame = (_now: number, metadata: { mediaTime: number }) => {
        this.#readTime(metadata.mediaTime);
        this.#videoFrame = media.requestVideoFrameCallback!(onFrame);
      };
      this.#videoFrame = media.requestVideoFrameCallback(onFrame);
      return;
    }
    const tick = () => {
      this.#readTime();
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  #stopLoop(): void {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    if (this.#videoFrame !== null) this.media.cancelVideoFrameCallback?.(this.#videoFrame);
    this.#frame = null;
    this.#videoFrame = null;
  }
}

function finite(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const NO_SUBSCRIBE = () => () => {};

/** 订阅由时间推出的值。`select` 应当返回原始值（数字、字符串），只有它变了组件才重画。 */
export function usePlaybackTime<T extends string | number | boolean | null>(
  controller: PlaybackController | null,
  select: (time: number) => T,
): T {
  return useSyncExternalStore(controller?.subscribeTime ?? NO_SUBSCRIBE, () => select(controller?.time ?? 0));
}

export function usePlaybackStatus(controller: PlaybackController | null): PlaybackStatus {
  return useSyncExternalStore(controller?.subscribeStatus ?? NO_SUBSCRIBE, () => controller?.status ?? INITIAL);
}
