import { sequenceDurationFrames, type CaptionItem, type Sequence, type Track } from '@baocut/protocol';
import type { FrozenDocument } from '../render/render-planner.ts';
import type { PlacedSegment } from './live-transcript.ts';
import { DEFAULT_CAPTION_STYLE } from './property-values.ts';

/*
 * 转录中画面上的临时字幕（原型第 220 轮 stage.jsx + model-transcript.js `liveCueView`；产品设计 §5.7）。
 *
 * 第一次转录时还没有字幕轨，画面上照原型放已经识别出来的部分：播放头落在一段已识别的段落里就画这一段，还没转录到的部分
 * 什么都不画。真实数据没有半段文字（原型的 inflight 前缀），所以整段出现或不出现。
 *
 * 画法与真字幕同一条路：预览引擎把这里摆出的一层字幕（一条字幕轨、一份 `clock: 'sequence'` 的字幕文档、默认样式）
 * 叠进送给渲染内核的序列，由同一个 `frame-render` 画——只在预览引擎里，不进视频、不进撤销、不进导出（导出由 Runtime
 * 按视频里的文档画）。ID 都是界面自己起的，不会与 Runtime 发的 ID 撞上。
 */

export const LIVE_CAPTION_TRACK_ID = 'bc-live-caption-track';
export const LIVE_CAPTION_ITEM_ID = 'bc-live-caption';
export const LIVE_CAPTION_DOCUMENT_ID = 'bc-live-caption-document';
export const LIVE_CAPTION_STYLE_ID = 'bc-live-caption-style';

/** 画面上的一句（序列秒）。 */
export interface LiveCue {
  key: string;
  start: number;
  end: number;
  text: string;
}

/** 投到序列上的实时段落 → 临时字幕的句子：去掉空白段落与零长的块，按开始时刻排好。 */
export function liveCaptionCues(placed: readonly Pick<PlacedSegment, 'key' | 'start' | 'end' | 'text'>[]): LiveCue[] {
  return placed
    .map((p) => ({ key: p.key, start: p.start, end: p.end, text: p.text.trim() }))
    .filter((cue) => cue.text && cue.end > cue.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** 这一刻画面上放哪一句：播放头落在一段里（左闭右开）就是它；段落之间、还没转录到的部分是 null。 */
export function liveCueAt(cues: readonly LiveCue[], seconds: number): LiveCue | null {
  for (const cue of cues) if (cue.start <= seconds && seconds < cue.end) return cue;
  return null;
}

/**
 * 叠上临时字幕层的序列：最上面加一条字幕轨，上面一层字幕铺满序列现有的时长（不改时长），文档里的时间就是序列时间
 * （`scopeItemIds` 为空）。序列的 ID 与版本原样保留——编辑写回时按的是真序列的版本。
 */
export function withLiveCaption(sequence: Sequence): Sequence {
  const frames = sequenceDurationFrames(sequence);
  if (frames <= 0) return sequence;
  const order = sequence.tracks.reduce((max, track) => Math.max(max, track.order), -1) + 1;
  const paintOrder = sequence.items.reduce((max, item) => Math.max(max, item.paintOrder), -1) + 1;
  const track: Track = {
    id: LIVE_CAPTION_TRACK_ID,
    order,
    kind: 'subtitle',
    locked: true,
    visible: true,
    muted: false,
    solo: { enabled: false, group: 'visual' },
  };
  const item: CaptionItem = {
    id: LIVE_CAPTION_ITEM_ID,
    trackId: LIVE_CAPTION_TRACK_ID,
    type: 'caption',
    enabled: true,
    locked: true,
    paintOrder,
    followPolicy: { kind: 'sequence-fixed' },
    span: { fromFrame: 0, durationFrames: frames },
    documentId: LIVE_CAPTION_DOCUMENT_ID,
    styleDocumentId: LIVE_CAPTION_STYLE_ID,
    scopeItemIds: [],
  };
  return { ...sequence, tracks: [...sequence.tracks, track], items: [...sequence.items, item] };
}

/**
 * 临时字幕层要的两份文档：字幕正文（序列时钟、毫秒）与样式。样式是默认预设 `DEFAULT_CAPTION_STYLE`——转录流程最后一步
 * 新建的字幕没有别的样式时就是这一份（与渲染内核没有样式文档时的默认相同）。
 */
export function liveCaptionDocuments(cues: readonly LiveCue[]): FrozenDocument[] {
  return [
    {
      documentId: LIVE_CAPTION_DOCUMENT_ID,
      kind: 'caption',
      schema: 'baocut.caption/1',
      lineKind: 'original',
      body: {
        schema: 'baocut.caption/1',
        clock: 'sequence',
        timescale: 1000,
        cues: cues.map((cue, index) => ({
          id: `live-${index}`,
          start: Math.round(cue.start * 1000),
          end: Math.max(Math.round(cue.start * 1000) + 1, Math.round(cue.end * 1000)),
          text: cue.text,
        })),
      },
    },
    {
      documentId: LIVE_CAPTION_STYLE_ID,
      kind: 'caption-style',
      schema: String(DEFAULT_CAPTION_STYLE.schema),
      body: DEFAULT_CAPTION_STYLE,
    },
  ];
}
