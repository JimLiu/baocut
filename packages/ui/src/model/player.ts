import { mediaTimeToSeconds, type AssetRecord, type DocumentRecord, type Id, type Sequence, type VersionRef } from '@baocut/protocol';
import { captionChips, captionKind } from './caption-tracks.ts';
import { thumbnailGrid, sourceClock, sourceSecondsAt } from './clip-media.ts';
import { durationSeconds } from './editor.ts';

/**
 * 编辑器的全屏播放器（原型 model-player.js、player.jsx）的判据：控件什么时候收起、进度条上的一点是哪一秒、哪个键做什么、
 * 字幕四档各露哪些字幕。纯函数，界面（components/editor/fullscreen-player.tsx）只把这些结论画出来。
 *
 * 时间都是序列秒：编辑器的时间线上剪掉的段不占时间（拼缝即合拢），时间线时钟就是成片时钟，进度条与时码读的就是播放头。
 */

/** 空闲多久收起控件（原型 `IDLE_MS`）。 */
export const IDLE_MS = 3000;
/** ←/→ 与 J/L 一次跳多少秒。 */
export const SEEK_STEP = 5;
export const SEEK_STEP_LONG = 10;
/** 进度条悬停预览格：横片 160 宽，竖片按画幅收窄，高最多 120（原型 `PREV_W` / `PREV_MAX_H`）。 */
export const PREVIEW_WIDTH = 160;
export const PREVIEW_MAX_HEIGHT = 120;

/**
 * 「按住不放」的三件事：拖着进度条、开着弹层（菜单与键表）、正在拖音量。任一件为真，空闲计时就不收走控件——手还在条子上，
 * 条子却消失了，是播放器里最招人烦的一种「聪明」。
 */
export function holdingVisible(state: { scrubbing: boolean; popup: boolean; volumeDragging: boolean }): boolean {
  return state.scrubbing || state.popup || state.volumeDragging;
}

/** 控件该不该收起：只有在播、指针不在控件条上、没按住任何东西、空闲满 3 秒时才收。暂停一定可见。 */
export function chromeHidden(state: { playing: boolean; hovering: boolean; holding: boolean; idleMs: number }): boolean {
  return state.playing && !state.hovering && !state.holding && state.idleMs >= IDLE_MS;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** 进度比例（0–1）。时长为 0（空时间线）时恒为 0，不除出 NaN。 */
export function seekFraction(seconds: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return clamp(seconds / duration, 0, 1);
}

/** 进度条上的横坐标 → 秒（只用 `rect` 的 left 与 width）。 */
export function timeAt(clientX: number, rect: { left: number; width: number }, duration: number): number {
  if (!(rect.width > 0) || !(duration > 0)) return 0;
  return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
}

/** 跳转步进，夹在 [0, 时长]。 */
export function stepTime(seconds: number, delta: number, duration: number): number {
  return clamp(seconds + delta, 0, Math.max(0, duration || 0));
}

/** 0–9 跳到时长的 0%–90%。 */
export function percentTime(digit: number, duration: number): number {
  const total = Math.max(0, duration || 0);
  return clamp((digit / 10) * total, 0, total);
}

/** 章节边界在进度条上的位置（0–1）。首章的 0 不画——那是轨道的起点，不是一道缝。 */
export function chapterTicks(chapters: readonly { start: number }[], duration: number): number[] {
  if (!(duration > 0)) return [];
  return chapters.map((c) => c.start).filter((s) => s > 0.01 && s < duration).map((s) => s / duration);
}

/** 悬停预览格的大小：宽 160、按画布比例，竖片高不超过 120。 */
export function previewSize(canvas: { width: number; height: number }): { width: number; height: number } {
  const ratio = canvas.width > 0 && canvas.height > 0 ? canvas.width / canvas.height : 16 / 9;
  const height = Math.min(PREVIEW_MAX_HEIGHT, Math.round(PREVIEW_WIDTH / ratio));
  return { width: Math.round(height * ratio), height };
}

/**
 * 进度条悬停气泡上那一格画面：这一刻最上面那层（轨道 `order` 最大）启用着、轨道可见、素材有画面的视频片段，换到素材的源时间。
 * 序列时间先按时长的约百分之一取整（`thumbnailGrid` 的档位），指针挪一点点时复用同一张缩略图，不为每个像素取一次帧。
 */
export function seekFrame(
  sequence: Sequence,
  assets: Record<Id, AssetRecord>,
  seconds: number,
): { asset: VersionRef; at: number } | null {
  const fps = sequence.fps;
  const grid = thumbnailGrid(durationSeconds(sequence) / 100);
  const at = Math.floor(seconds / grid) * grid;
  const tracks = new Map(sequence.tracks.map((track) => [track.id, track]));
  let best: { order: number; asset: VersionRef; at: number } | null = null;
  for (const item of sequence.items) {
    if (item.type !== 'video' || !item.enabled) continue;
    const track = tracks.get(item.trackId);
    if (!track?.visible) continue;
    const start = (item.span.fromFrame * fps.den) / fps.num;
    const end = ((item.span.fromFrame + item.span.durationFrames) * fps.den) / fps.num;
    const t = Math.max(start, at);
    if (seconds < start || seconds >= end || (best && best.order > track.order)) continue;
    if (!assets[item.assetRef.id]?.revisions[item.assetRef.revision]?.video) continue;
    const source = item.timeMap.kind === 'hold' ? mediaTimeToSeconds(item.timeMap.sourceAt) : sourceSecondsAt(sourceClock(item.timeMap, start), t);
    best = { order: track.order, asset: item.assetRef, at: Math.max(0, Math.round(source * 1000) / 1000) };
  }
  return best ? { asset: best.asset, at: best.at } : null;
}

/* ---------- 字幕四档 ---------- */

/**
 * 全屏里的字幕档位是视图态，不是文档编辑：选「只看译文」不把原文在视频里拿下（那会进撤销、跟着导出走），只在预览送去画的序列上
 * 临时停用不该露的字幕（`captionView`）。档位按画面上实际有的字幕生成：只有原文时不摆「双语」，那是空承诺。
 */
export type CaptionMode = 'off' | 'source' | 'trans' | 'both';

/** 画面上（轨道可见、实例启用着）有没有原文与译文字幕。 */
export function captionAvailability(sequence: Sequence, documents: Record<Id, DocumentRecord>): { hasSource: boolean; hasTranslation: boolean } {
  const shown = captionChips(sequence, documents).filter((chip) => chip.state === 'on');
  return { hasSource: shown.some((chip) => chip.kind === 'original'), hasTranslation: shown.some((chip) => chip.kind === 'translation') };
}

export function captionModes(hasSource: boolean, hasTranslation: boolean): CaptionMode[] {
  const modes: CaptionMode[] = ['off'];
  if (hasSource) modes.push('source');
  if (hasTranslation) modes.push('trans');
  if (hasSource && hasTranslation) modes.push('both');
  return modes;
}

/** 进全屏时的默认档：两种都有是双语，否则跟着有的那种，都没有是关。 */
export function defaultCaptionMode(hasSource: boolean, hasTranslation: boolean): CaptionMode {
  if (hasSource && hasTranslation) return 'both';
  if (hasSource) return 'source';
  if (hasTranslation) return 'trans';
  return 'off';
}

/** 选过的档位还在就用它（字幕被拿下之后可能不在了），否则用默认档。 */
export function effectiveCaptionMode(picked: CaptionMode | null, hasSource: boolean, hasTranslation: boolean): CaptionMode {
  return picked && captionModes(hasSource, hasTranslation).includes(picked) ? picked : defaultCaptionMode(hasSource, hasTranslation);
}

/** C：轮到下一档；当前档不在表里时从表头的下一档开始。 */
export function cycleCaptionMode(current: CaptionMode, hasSource: boolean, hasTranslation: boolean): CaptionMode {
  const modes = captionModes(hasSource, hasTranslation);
  return modes[(Math.max(0, modes.indexOf(current)) + 1) % modes.length]!;
}

/** 某一档下原文或译文露不露。 */
export function captionVisible(mode: CaptionMode, kind: 'original' | 'translation'): boolean {
  if (mode === 'off') return false;
  if (mode === 'source') return kind === 'original';
  if (mode === 'trans') return kind === 'translation';
  return true;
}

/** 按档位停用不该露的字幕实例（只把启用的停掉，从不把拿下的放回）；没有要停的时原样返回。 */
export function captionView(sequence: Sequence, documents: Record<Id, DocumentRecord>, mode: CaptionMode): Sequence {
  let changed = false;
  const items = sequence.items.map((item) => {
    if (item.type !== 'caption' || !item.enabled || captionVisible(mode, captionKind(item.documentId, documents))) return item;
    changed = true;
    return { ...item, enabled: false };
  });
  return changed ? { ...sequence, items } : sequence;
}

/* ---------- 键盘 ---------- */

/**
 * 全屏时播放器独占键盘：编辑器那一层（删除、复制粘贴、方向键推元素）在观看面上没有可操作的对象，接着接只会让人在看片时误删东西。
 * ⌘ / Ctrl / ⌥ 一律不接（留给系统与浏览器），⇧ 只用在左右键上。
 */
export type PlayerAction =
  | 'play'
  | 'exit'
  | 'back'
  | 'fwd'
  | 'back10'
  | 'fwd10'
  | 'prevChapter'
  | 'nextChapter'
  | 'volUp'
  | 'volDown'
  | 'mute'
  | 'captions'
  | 'start'
  | 'end'
  | 'percent'
  | 'keys';

export interface PlayerKey {
  action: PlayerAction;
  /** `percent` 的数字（0–9）。 */
  digit?: number;
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>;

/** 字母键：先认字符（Dvorak 等布局按字符走），认不出再按物理键位（与编辑器的 `letterOf` 同一条）。 */
function letterOf(event: KeyLike): string {
  const key = event.key.length === 1 ? event.key.toLowerCase() : '';
  if (/^[a-z]$/.test(key)) return key;
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  return key;
}

const LETTERS: Record<string, PlayerAction> = { k: 'play', f: 'exit', m: 'mute', c: 'captions', j: 'back10', l: 'fwd10' };

export function resolvePlayerKey(event: KeyLike): PlayerKey | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const { key } = event;
  switch (key) {
    case ' ':
      return { action: 'play' };
    case 'Escape':
      return { action: 'exit' };
    case 'ArrowLeft':
      return { action: event.shiftKey ? 'prevChapter' : 'back' };
    case 'ArrowRight':
      return { action: event.shiftKey ? 'nextChapter' : 'fwd' };
    case 'ArrowUp':
      return { action: 'volUp' };
    case 'ArrowDown':
      return { action: 'volDown' };
    case 'Home':
      return { action: 'start' };
    case 'End':
      return { action: 'end' };
    case '?':
      return { action: 'keys' };
  }
  if (/^[0-9]$/.test(key)) return { action: 'percent', digit: Number(key) };
  const letter = LETTERS[letterOf(event)];
  return letter ? { action: letter } : null;
}

/**
 * 人看的那张键表（`?`）。键只有一张表：播放器真正接的是 `resolvePlayerKey`，测试逐行拿 `probe` 打进去核对，并反向扫一遍键盘——
 * `resolvePlayerKey` 能返回、这张表没写的动作直接判红。`also` 是同一行里的另一半方向（写了 ← 就不再单列 →）。
 * 说明文字按 `action` 在文案目录里取（fullscreen-player-copy 的 `keys`）。
 */
export interface PlayerKeyRow {
  action: PlayerAction;
  also?: PlayerAction[];
  keys: string;
  probe: Partial<KeyLike> & { key: string };
}

export const PLAYER_KEYS: readonly PlayerKeyRow[] = [
  { action: 'play', keys: 'Space / K', probe: { key: ' ' } },
  { action: 'exit', keys: 'Esc / F', probe: { key: 'Escape' } },
  { action: 'back', also: ['fwd'], keys: '← / →', probe: { key: 'ArrowLeft' } },
  { action: 'back10', also: ['fwd10'], keys: 'J / L', probe: { key: 'j' } },
  { action: 'prevChapter', also: ['nextChapter'], keys: '⇧← / ⇧→', probe: { key: 'ArrowLeft', shiftKey: true } },
  { action: 'volUp', also: ['volDown'], keys: '↑ / ↓', probe: { key: 'ArrowUp' } },
  { action: 'mute', keys: 'M', probe: { key: 'm' } },
  { action: 'captions', keys: 'C', probe: { key: 'c' } },
  { action: 'start', also: ['end'], keys: 'Home / End', probe: { key: 'Home' } },
  { action: 'percent', keys: '0 – 9', probe: { key: '5' } },
  { action: 'keys', keys: '?', probe: { key: '?' } },
];
