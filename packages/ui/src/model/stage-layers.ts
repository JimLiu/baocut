import type { DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { MUSIC_ROLE } from './music-bed.ts';
import { captionAvailability, type CaptionMode } from './player.ts';

/**
 * 轻量视图舞台条左端的图层开关（轻量编辑器设计 §3.4、§11 第 11 条）：按这部视频画面上实有的东西生成，只列预览今天能开关的——
 * 字幕按原文 / 译文各一个（与全屏播放器的字幕档位同一个判法，`captionAvailability`），配乐一个（`role: music` 的音频实例）。
 * 都是这个窗口的观看态：只改送去预览的那份序列，不进视频、不进撤销、不影响导出。
 */

export type CaptionLayer = 'original' | 'translation';

/** 每种字幕在这个窗口里藏没藏（editor-store 的 `captionLayersHidden`）。 */
export type CaptionLayersHidden = Record<CaptionLayer, boolean>;

export const CAPTION_LAYERS_SHOWN: CaptionLayersHidden = { original: false, translation: false };

export interface LayerToggles {
  /** 画面上有的字幕种类，原文在前。 */
  captions: CaptionLayer[];
  /** 有没有听得见的配乐。 */
  music: boolean;
}

/** 这部视频该出哪几个开关；一个都没有时舞台条不摆这枚钮。 */
export function layerToggles(sequence: Sequence, documents: Record<Id, DocumentRecord>): LayerToggles {
  const { hasSource, hasTranslation } = captionAvailability(sequence, documents);
  const captions: CaptionLayer[] = [];
  if (hasSource) captions.push('original');
  if (hasTranslation) captions.push('translation');
  return { captions, music: hasMusic(sequence) };
}

export function hasLayerToggles(toggles: LayerToggles): boolean {
  return toggles.captions.length > 0 || toggles.music;
}

const isMusic = (item: Sequence['items'][number]) => item.type === 'audio' && item.role === MUSIC_ROLE;

/** 有没有听得见的配乐：启用着、所在轨道没静音的 `role: music` 音频实例。 */
export function hasMusic(sequence: Sequence): boolean {
  const muted = new Set(sequence.tracks.filter((track) => track.muted).map((track) => track.id));
  return sequence.items.some((item) => isMusic(item) && item.enabled && !muted.has(item.trackId));
}

/** 画面上有的字幕是不是全藏了（与舞台的 `captionsHidden` 对齐）；没有字幕时不算藏。 */
export function captionsAllHidden(hidden: CaptionLayersHidden, present: readonly CaptionLayer[]): boolean {
  return present.length > 0 && present.every((kind) => hidden[kind]);
}

/**
 * 开关 → 送给预览引擎的字幕档位（`engine.setCaptionView`）：有的都开着是 `null`（照视频原样），只开原文是 `source`，
 * 只开译文是 `trans`，都关是 `off`。舞台隐藏了字幕（`captionsHidden`）时一律 `off`。
 */
export function layerCaptionMode(
  captionsHidden: boolean,
  hidden: CaptionLayersHidden,
  present: readonly CaptionLayer[],
): CaptionMode | null {
  if (captionsHidden) return 'off';
  const shown = present.filter((kind) => !hidden[kind]);
  if (shown.length === present.length) return null;
  if (shown.length === 0) return 'off';
  return shown[0] === 'original' ? 'source' : 'trans';
}

/** 某个开关此刻是开是关（舞台隐藏字幕时字幕的都算关）。 */
export function captionLayerShown(captionsHidden: boolean, hidden: CaptionLayersHidden, kind: CaptionLayer): boolean {
  return !captionsHidden && !hidden[kind];
}

/** 有没有关着的开关：图层钮显示「有藏起来的」。 */
export function layersPartlyHidden(
  toggles: LayerToggles,
  state: { captionsHidden: boolean; captionLayersHidden: CaptionLayersHidden; musicHidden: boolean },
): boolean {
  return (
    toggles.captions.some((kind) => !captionLayerShown(state.captionsHidden, state.captionLayersHidden, kind)) ||
    (toggles.music && state.musicHidden)
  );
}

/** 监听时去掉配乐：停用 `role: music` 的音频实例（只把启用的停掉）；没有要停的时原样返回。 */
export function withoutMusic(sequence: Sequence): Sequence {
  let changed = false;
  const items = sequence.items.map((item) => {
    if (!isMusic(item) || !item.enabled) return item;
    changed = true;
    return { ...item, enabled: false };
  });
  return changed ? { ...sequence, items } : sequence;
}
