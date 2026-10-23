import type {
  AudioMix,
  ConfettiProps,
  Crop,
  DrawProps,
  EmbeddedAudio,
  FocalPoint,
  Fx,
  Id,
  Place,
  ProgressProps,
  Revision,
  Sequence,
  SequenceItem,
  ShapeProps,
  StickerProps,
  VideoPanel,
  VisualizerProps,
  VisualMode,
} from '@baocut/protocol';
import type { Json } from '../render/text-style.ts';

/**
 * 拖动中还没提交的属性（滑杆松手、取色面板放手才提交）：只叠给预览与属性页看。
 * 草稿记着它基于的序列版本；序列换了版本（提交成功、撤销、别人改了），草稿自然作废。
 */
export interface ItemDraft {
  itemId: Id;
  revision: Revision;
  patch: ItemPatch;
}

export interface ItemPatch {
  /** 位置、大小、角度、不透明度与圆角（逐字段叠在 `place` 上）。 */
  place?: Partial<Place>;
  /** 文字样式（整体替换）。 */
  style?: Json;
  /** 图形（整体替换）。 */
  shape?: ShapeProps;
  /** 生成类元素的种类参数（声波、进度条、彩纸、手绘、贴纸；整体替换）。 */
  props?: Json;
  /** 合成的参数（整体替换）。 */
  parameterValues?: Json;
  /** 音频实例的混音。 */
  mix?: Partial<AudioMix>;
  /** 视频自带的声音，或合成发出的声音。 */
  embeddedAudio?: Partial<EmbeddedAudio>;
  /** 画面效果（整体替换；`null` 是去掉）。 */
  fx?: Fx | null;
  /** 视频与图片的取景（裁剪与取景点整体替换，null 是去掉）：画布上放大按原片取景的视频时跟手。 */
  framing?: { crop: Crop | null; focalPoint: FocalPoint | null };
  /** 视频的分屏格子（整份替换，`null` 去掉）：画布上在一格里拖、属性面板拖格子的滑杆时跟手。 */
  panels?: VideoPanel[] | null;
  /** 视觉媒体的铺满 / 画中画：画布上拖动铺满画布的媒体时它换成画中画（`stage-framing.ts` 的 `placeChange`）。 */
  mode?: VisualMode;
}

/** 同一个片段、同一个版本上的草稿叠在一起（拖完一根滑杆、提交还没回来时又拖另一根，前一根不弹回）。 */
export function mergeDraft(previous: ItemDraft | null, next: ItemDraft): ItemDraft {
  if (!previous || previous.itemId !== next.itemId || previous.revision !== next.revision) return next;
  const a = previous.patch;
  const b = next.patch;
  return {
    ...next,
    patch: {
      ...a,
      ...b,
      ...(a.place || b.place ? { place: { ...a.place, ...b.place } } : {}),
      ...(a.mix || b.mix ? { mix: { ...a.mix, ...b.mix } } : {}),
      ...(a.embeddedAudio || b.embeddedAudio ? { embeddedAudio: { ...a.embeddedAudio, ...b.embeddedAudio } } : {}),
    },
  };
}

/** 序列叠上草稿；草稿不属于这个版本时原样返回。 */
export function applyDraft(sequence: Sequence, draft: ItemDraft | null): Sequence {
  if (!draft || draft.revision !== sequence.revision) return sequence;
  const index = sequence.items.findIndex((item) => item.id === draft.itemId);
  if (index < 0) return sequence;
  const items = [...sequence.items];
  items[index] = patchItem(items[index]!, draft.patch);
  return { ...sequence, items };
}

/** 一个片段叠上补丁：只叠这种片段有的字段。 */
export function patchItem(item: SequenceItem, patch: ItemPatch): SequenceItem {
  if (item.type === 'audio') return patch.mix ? { ...item, mix: { ...item.mix, ...patch.mix } } : item;
  if (item.type === 'caption') return item;
  const media = item.type === 'video' || item.type === 'image' || item.type === 'sticker' || item.type === 'placeholder' || item.type === 'whiteboard';
  const moded = patch.mode && media ? { ...item, mode: patch.mode } : item;
  const moved = patch.place ? { ...moded, place: { ...moded.place, ...patch.place } } : moded;
  const placed = patch.framing && (moved.type === 'video' || moved.type === 'image') ? withFraming(moved, patch.framing) : moved;
  const props = patch.props;
  switch (placed.type) {
    case 'video':
      return withFx(
        withPanels(patch.embeddedAudio ? { ...placed, embeddedAudio: { ...placed.embeddedAudio, ...patch.embeddedAudio } } : placed, patch),
        patch,
      );
    case 'image':
    case 'placeholder':
    case 'whiteboard':
      return withFx(placed, patch);
    case 'sticker':
      return withFx(props ? { ...placed, sticker: props as unknown as StickerProps } : placed, patch);
    case 'text':
      return patch.style ? { ...placed, style: patch.style } : placed;
    case 'shape':
      return patch.shape ? { ...placed, shape: patch.shape } : placed;
    case 'visualizer':
      return props ? { ...placed, visualizer: props as unknown as VisualizerProps } : placed;
    case 'progress':
      return props ? { ...placed, progress: props as unknown as ProgressProps } : placed;
    case 'confetti':
      return props ? { ...placed, confetti: props as unknown as ConfettiProps } : placed;
    case 'draw':
      return props ? { ...placed, draw: props as unknown as DrawProps } : placed;
    case 'composition':
      return withFx(
        {
          ...placed,
          ...(patch.parameterValues ? { parameterValues: patch.parameterValues } : {}),
          ...(patch.embeddedAudio && placed.audio ? { audio: { ...placed.audio, ...patch.embeddedAudio } } : {}),
        },
        patch,
      );
  }
}

/** 换上取景：裁剪与取景点整体替换，`null` 的去掉字段（与引擎落盘一致）。 */
function withFraming<T extends { crop?: Crop; focalPoint?: FocalPoint }>(item: T, framing: NonNullable<ItemPatch['framing']>): T {
  const { crop: _crop, focalPoint: _focal, ...rest } = item;
  return { ...rest, ...(framing.crop ? { crop: framing.crop } : {}), ...(framing.focalPoint ? { focalPoint: framing.focalPoint } : {}) } as T;
}

/** 换上或去掉分屏格子（`null` 去掉字段，与引擎落盘一致）。 */
function withPanels<T extends { panels?: VideoPanel[] }>(item: T, patch: ItemPatch): T {
  if (patch.panels === undefined) return item;
  if (patch.panels !== null) return { ...item, panels: patch.panels };
  const { panels: _gone, ...rest } = item;
  return rest as T;
}

/** 换上或去掉 `fx`（`null` 去掉字段，与引擎落盘一致）。 */
function withFx<T extends { fx?: Fx }>(item: T, patch: ItemPatch): T {
  if (patch.fx === undefined) return item;
  if (patch.fx !== null) return { ...item, fx: patch.fx };
  const { fx: _gone, ...rest } = item;
  return rest as T;
}

/** 序列叠上几份草稿（舞台上整体拖动多件）：逐份叠，不属于这个版本的那份跳过。 */
export function applyDrafts(sequence: Sequence, drafts: readonly ItemDraft[]): Sequence {
  return drafts.reduce((shown, draft) => applyDraft(shown, draft), sequence);
}
