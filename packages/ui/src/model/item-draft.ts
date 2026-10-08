import type {
  AudioMix,
  ConfettiProps,
  DrawProps,
  EmbeddedAudio,
  Fx,
  Id,
  Place,
  ProgressProps,
  Revision,
  Sequence,
  SequenceItem,
  ShapeProps,
  StickerProps,
  VisualizerProps,
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
  const placed = patch.place ? { ...item, place: { ...item.place, ...patch.place } } : item;
  const props = patch.props;
  switch (placed.type) {
    case 'video':
      return withFx(
        patch.embeddedAudio ? { ...placed, embeddedAudio: { ...placed.embeddedAudio, ...patch.embeddedAudio } } : placed,
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
