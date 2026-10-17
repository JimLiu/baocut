import type { MessageParam, MessageRef } from '@baocut/protocol';

/**
 * 渲染内核的提示（`EXPORT_RENDER_NOTE`）的引用：`frameRender.itemNote` 写着哪个实例（`item`）与说明（`note`）。说明是嵌套的
 * 引用（`frameRender.*`，或元素与字幕内核的 `timelineRender.*`、`subtitleRender.*`）；少数转述来的提示（模板字幕场景的诊断、
 * 视频源自带的提示）没有引用，是原话。界面按引用认提示，不按某一种语言的原文。
 */
export interface RenderNote {
  item: string;
  /** 说明的键（`frameRender.missingFont` 这类）；转述来的原话没有键。 */
  key: string | null;
  params: Record<string, MessageParam>;
}

export function renderNote(ref: MessageRef | undefined): RenderNote | null {
  if (ref?.key !== 'frameRender.itemNote') return null;
  const item = ref.params?.item;
  if (typeof item !== 'string') return null;
  const note = ref.params?.note;
  if (note && typeof note === 'object') return { item, key: note.key, params: note.params ?? {} };
  return { item, key: null, params: {} };
}

/** 缺字体的提示报的族（`frameRender.missingFont`）；别的提示是 `null`。 */
export function missingFontFamily(ref: MessageRef | undefined): string | null {
  const note = renderNote(ref);
  const family = note?.key === 'frameRender.missingFont' ? note.params.family : null;
  return typeof family === 'string' ? family : null;
}

/** 说话人的声波听不出什么时候说话（没有转写、转写里没有这位）。 */
export function isSpeakerNote(ref: MessageRef | undefined): boolean {
  const key = renderNote(ref)?.key;
  return key === 'frameRender.speakerNoTranscript' || key === 'frameRender.speakerNotInSequence';
}
