import { opaqueBounds } from '../../render/thumbnails.ts';
import type { Rect } from './thumb-scenes.ts';

/**
 * 动起来的字幕样式卡一圈的帧。卡按「一圈第几格」取帧：同一格画过就不再叫内核画，一圈循环下去只是贴图。
 *
 * 一格裁到不透明的那一块再存；画面一样的格共用一份（按词变色的一圈几十格只有几份不同的画面）。一张卡存的
 * 字节有上限：落入、弹跳这类每格都不一样的动画存满了，剩下的格每次现画。一圈都是同一份画面（没有逐词动画）时
 * `still` 为真，组件就不再跟着时钟走。
 */

/** 每秒几格：一个词一拍 0.62 秒，15 格看得出落入、弹跳的走势；时钟也按它取格。 */
export const CAPTION_FPS = 15;

/** 一张卡最多存多少字节的帧（按词变色的一圈在高分屏上约 1 MB）。 */
export const LOOP_BUDGET = 2 * 1024 * 1024;

/** 一格：裁到不透明那一块的画面（全透明时为 null）与它贴在格子里的位置。 */
export interface LoopCell {
  image: ImageData | null;
  at: Rect;
}

export class CaptionLoop {
  /** 一圈多长（秒）。 */
  readonly period: number;
  /** 一圈几格。 */
  readonly count: number;
  private readonly budget: number;
  private readonly cells: (LoopCell | undefined)[];
  /** 存着的各份不同画面，按摘要分桶。 */
  private readonly kept = new Map<number, LoopCell[]>();
  private bytes = 0;
  private filled = 0;
  private unique = 0;

  constructor(period: number, budget = LOOP_BUDGET) {
    this.period = period;
    this.budget = budget;
    // 减一点点：浮点乘出来的 4.0000000001 不该多出一格。
    this.count = Math.max(1, Math.ceil(period * CAPTION_FPS - 1e-9));
    this.cells = new Array<LoopCell | undefined>(this.count);
  }

  /** 时钟走到 `seconds` 时是一圈的第几格（各卡共用一个原点，同一刻念到同一个词）。 */
  index(seconds: number): number {
    const phase = ((seconds % this.period) + this.period) % this.period;
    return Math.min(this.count - 1, Math.floor(phase * CAPTION_FPS));
  }

  /** 第几格画的是哪一刻（秒）。 */
  time(index: number): number {
    return index / CAPTION_FPS;
  }

  get(index: number): LoopCell | undefined {
    return this.cells[index];
  }

  /** 一圈每格都画过，而且都是同一份画面：不会动。 */
  get still(): boolean {
    return this.filled === this.count && this.unique === 1;
  }

  /**
   * 收下第几格画出来的整格画面，返回要贴的那一块。与存着的哪一格画面一样就共用那一份（不必相邻：第一圈因时钟
   * 预算跳过的格补画时也认得出）；存不下时不存，下一圈再现画。
   */
  put(index: number, image: ImageData): LoopCell {
    const known = this.cells[index];
    if (known) return known;
    const cell = crop(image);
    const key = digest(cell);
    const twin = this.kept.get(key)?.find((other) => sameCell(other, cell));
    if (twin) {
      this.cells[index] = twin;
      this.filled++;
      return twin;
    }
    const size = cell.image ? cell.image.data.byteLength : 0;
    if (this.bytes + size > this.budget) return cell;
    this.cells[index] = cell;
    this.kept.set(key, [...(this.kept.get(key) ?? []), cell]);
    this.bytes += size;
    this.filled++;
    this.unique++;
    return cell;
  }

  /** 丢掉存着的帧（卡滚出视野时，省得一屏外的卡还占着内存）。 */
  clear(): void {
    this.cells.fill(undefined);
    this.kept.clear();
    this.bytes = 0;
    this.filled = 0;
    this.unique = 0;
  }
}

/** 裁到不透明的那一块。 */
function crop(image: ImageData): LoopCell {
  const bounds = opaqueBounds(image);
  if (!bounds) return { image: null, at: { x: 0, y: 0, width: 0, height: 0 } };
  if (bounds.width === image.width && bounds.height === image.height) return { image, at: bounds };
  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  const row = bounds.width * 4;
  for (let y = 0; y < bounds.height; y++) {
    const from = ((bounds.y + y) * image.width + bounds.x) * 4;
    data.set(image.data.subarray(from, from + row), y * row);
  }
  return { image: new ImageData(data, bounds.width, bounds.height), at: bounds };
}

/** 一格的摘要（FNV-1a，按 4 字节一步）：摘要不同的两格画面一定不同，相同时再逐字节比。 */
function digest(cell: LoopCell): number {
  let hash = Math.imul(0x811c9dc5 ^ cell.at.x, 0x01000193);
  hash = Math.imul(hash ^ cell.at.y, 0x01000193);
  hash = Math.imul(hash ^ cell.at.width, 0x01000193);
  if (!cell.image) return hash;
  const { data } = cell.image;
  const words = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
  for (let i = 0; i < words.length; i++) hash = Math.imul(hash ^ words[i]!, 0x01000193);
  return hash;
}

function sameCell(a: LoopCell, b: LoopCell): boolean {
  if (a.at.x !== b.at.x || a.at.y !== b.at.y || a.at.width !== b.at.width || a.at.height !== b.at.height) return false;
  if (!a.image || !b.image) return a.image === b.image;
  const x = a.image.data;
  const y = b.image.data;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
