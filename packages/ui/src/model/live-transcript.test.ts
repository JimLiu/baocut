import type { CaptionItem, DocumentRecord, JobLiveSegment, Sequence, VideoItem } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import { job } from '../testing/task-records.ts';
import {
  assetCaptioned,
  holdSegments,
  liveAt,
  livePending,
  liveRowShown,
  liveTranscriptions,
  liveTranscriptShown,
  placePending,
  placeSegments,
  transcribedBefore,
} from './live-transcript.ts';

const fps = { num: 30, den: 1 };
const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };

/** 素材 `a1` 的一个实例：序列上从 `fromFrame` 起 `durationFrames` 帧，取素材的 `sourceIn` 秒起。 */
function video(id: string, fromFrame: number, durationFrames: number, sourceIn: number): VideoItem {
  return {
    ...base,
    id,
    trackId: 'v1',
    type: 'video',
    span: { fromFrame, durationFrames },
    place: {},
    mode: 'fullscreen',
    assetRef: { id: 'a1', revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: String(Math.round(sourceIn * 1000)), timescale: 1000 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
  };
}

const caption = (id: string, documentId: string): CaptionItem => ({
  ...base,
  id,
  trackId: 's1',
  type: 'caption',
  span: { fromFrame: 0, durationFrames: 300 },
  documentId,
});

function sequence(items: Sequence['items']): Sequence {
  return {
    id: 'seq',
    revision: '1',
    name: '主序列',
    fps,
    canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: '#000000' },
    durationPolicy: { kind: 'derived' },
    tracks: [],
    items,
    animationBindings: [],
    transitions: [],
    markers: [],
    ducking: [],
  };
}

const doc = (id: string, kind: string, createdAt: string, sourceAssetId = 'a1'): DocumentRecord => ({
  id,
  kind,
  name: id,
  sourceAssetId,
  currentRevision: '1',
  revisions: { '1': { revision: '1', contentHash: 'sha256:0', byteLength: 1, createdAt, createdBy: 'tx' } },
});

const seg = (start: number, end: number, text = `${start}`): JobLiveSegment => ({ start, end, text });

describe('liveAt / livePending', () => {
  it('转录位置 = max(最后一段的终点, 进度秒数)，夹在素材时长里', () => {
    expect(liveAt([], null, 30)).toBe(0);
    expect(liveAt([seg(0, 4), seg(4, 9)], null, 30)).toBe(9);
    // 进度按秒报：解码、VAD 走在识别前面时前缘跟进度。
    expect(liveAt([seg(0, 4)], { done: 12, total: 30, unit: 'seconds' }, 30)).toBe(12);
    // 段落比进度新（进度事件还没到）时跟段落。
    expect(liveAt([seg(0, 14)], { done: 12, total: 30, unit: 'seconds' }, 30)).toBe(14);
    expect(liveAt([], { done: 45, total: 30, unit: 'seconds' }, 30)).toBe(30);
  });

  it('按 VAD 片段报的进度只当下限：done / total × 时长', () => {
    expect(liveAt([], { done: 5, total: 10, unit: 'segments' }, 30)).toBe(15);
    expect(liveAt([seg(0, 20)], { done: 5, total: 10, unit: 'segments' }, 30)).toBe(20);
    // 总数不明、时长不明时不按片段数换算。
    expect(liveAt([seg(0, 3)], { done: 5, total: null, unit: 'segments' }, 30)).toBe(3);
    expect(liveAt([seg(0, 3)], { done: 5, total: 10, unit: 'segments' }, null)).toBe(3);
  });

  it('待定带从转录位置到素材末尾；转写做完（done）时没有待定带', () => {
    expect(livePending(0, 30)).toEqual({ start: 0, end: 30 });
    expect(livePending(12, 30)).toEqual({ start: 12, end: 30 });
    expect(livePending(30, 30)).toBeNull();
    expect(livePending(12, null)).toEqual({ start: 12, end: Infinity });
    expect(liveAt([seg(0, 4)], null, 30, true)).toBe(30);
    expect(livePending(liveAt([seg(0, 4)], null, 30, true), 30, true)).toBeNull();
  });
});

describe('liveTranscriptions', () => {
  const parent = job({ jobId: 'p1', kind: 'pipeline', assetId: null, submitter: { kind: 'agent', id: 'c1', taskId: 't1' } });
  const step = job({ jobId: 's1', submitter: { kind: 'pipeline', id: 'p1' } });

  it('从转写 Job 找起：带上流程父任务；别的视频、别的种类不算', () => {
    const found = liveTranscriptions([parent, step, job({ jobId: 'x', videoId: 'v2' }), job({ jobId: 'e', kind: 'export' })], 'v1');
    expect(found).toEqual([{ assetId: 'a1', step, parent, running: true }]);
    expect(liveTranscriptions([parent, step], null)).toEqual([]);
  });

  it('转写做完、父任务还在跑（建字幕层）时仍算，running 为 false；父任务结束就不算了', () => {
    const done = { ...step, state: 'completed' as const, endedAt: '2026-10-01T09:05:00Z' };
    expect(liveTranscriptions([parent, done], 'v1')).toEqual([{ assetId: 'a1', step: done, parent, running: false }]);
    const ended = { ...parent, state: 'completed' as const, endedAt: '2026-10-01T09:06:00Z' };
    expect(liveTranscriptions([ended, done], 'v1')).toEqual([]);
    // 直接提交、没有父任务的转写做完就结束。
    expect(liveTranscriptions([{ ...done, submitter: { kind: 'connection', id: 'x' } }], 'v1')).toEqual([]);
  });

  it('同一个素材重试过时取最新的那次', () => {
    const retry = job({ jobId: 's2', submitter: { kind: 'pipeline', id: 'p1' }, createdAt: '2026-10-01T09:01:00Z' });
    expect(liveTranscriptions([parent, step, retry], 'v1').map((t) => t.step.jobId)).toEqual(['s2']);
  });
});

describe('第一次转录才画临时行；收尾时不空一拍', () => {
  it('时间线上有这个素材的字幕、或开始前已有转写（重新转录）时不画', () => {
    const documents = { cap: doc('cap', 'caption', '2026-10-01T09:10:00Z'), other: doc('other', 'caption', '2026-10-01T08:00:00Z', 'a2') };
    expect(assetCaptioned(sequence([video('v', 0, 300, 0), caption('c', 'other')]), documents, 'a1')).toBe(false);
    expect(assetCaptioned(sequence([video('v', 0, 300, 0), caption('c', 'cap')]), documents, 'a1')).toBe(true);
    const speech = { sp: doc('sp', 'speech', '2026-10-01T09:05:00Z') };
    expect(transcribedBefore(speech, 'a1', '2026-10-01T09:00:00Z')).toBe(false);
    expect(transcribedBefore(speech, 'a1', '2026-10-01T09:06:00Z')).toBe(true);
    expect(transcribedBefore(speech, 'a2', '2026-10-01T09:06:00Z')).toBe(false);
  });

  it('按真实的先后走一遍：识别中 → 转写落盘、段落被丢掉但留着 → 字幕轨出现 / 流程结束', () => {
    const parent = job({ jobId: 'p1', kind: 'pipeline', assetId: null });
    const running = job({ jobId: 's1', submitter: { kind: 'pipeline', id: 'p1' } });
    const done = {
      ...running,
      state: 'completed' as const,
      endedAt: '2026-10-01T09:05:00Z',
      result: { documentId: 'sp', artifactId: 'x' },
    };
    const segments = [seg(0, 4), seg(4, 9)];
    const first = { captioned: false, transcribedBefore: false };

    // 1. 识别中：段落在 liveSegments 里。还没有段落时（不流式的服务）也画——只有待定带。
    let held = holdSegments({}, { s1: segments }, {}, [parent, running]);
    expect(held).toEqual({});
    expect(liveRowShown({ running: true, segments: 0, ...first })).toBe(true);
    expect(liveRowShown({ running: true, segments: 2, ...first })).toBe(true);
    expect(liveTranscriptShown({ running: true, segments: 0, documentLanded: false })).toBe(true);

    // 2. 转写 Job 完成：reducer 丢掉它的段落，父任务还在建字幕层——留住，临时行接着画；转写文档落进视频前文稿也接着画。
    held = holdSegments({ s1: segments }, {}, held, [parent, done]);
    expect(held).toEqual({ s1: segments });
    expect(liveTranscriptions([parent, done], 'v1')[0]!.running).toBe(false);
    expect(liveRowShown({ running: false, segments: held.s1!.length, ...first })).toBe(true);
    expect(liveTranscriptShown({ running: false, segments: 2, documentLanded: false })).toBe(true);
    // 转写文档到了：文稿面板换成正式文稿；临时行不看转写文档（它是这次转录自己写的），只等字幕轨。
    expect(liveTranscriptShown({ running: false, segments: 2, documentLanded: true })).toBe(false);
    expect(liveRowShown({ running: false, segments: 2, captioned: false, transcribedBefore: false })).toBe(true);

    // 3a. 字幕轨出现：临时行收起。
    expect(liveRowShown({ running: false, segments: 2, captioned: true, transcribedBefore: false })).toBe(false);

    // 3b. 流程结束（不建字幕层的流程也会走到这里）：留着的段落放掉，这次转录也不再算进行中。
    const ended = { ...parent, state: 'completed' as const, endedAt: '2026-10-01T09:06:00Z' };
    held = holdSegments({}, {}, held, [ended, done]);
    expect(held).toEqual({});
    expect(liveTranscriptions([ended, done], 'v1')).toEqual([]);
  });

  it('转写做完却一段也没有时不画空行；取消、失败的段落不留', () => {
    expect(liveRowShown({ running: false, segments: 0, captioned: false, transcribedBefore: false })).toBe(false);
    const parent = job({ jobId: 'p1', kind: 'pipeline', assetId: null });
    const cancelled = job({ jobId: 's1', state: 'cancelled', submitter: { kind: 'pipeline', id: 'p1' } });
    expect(holdSegments({ s1: [seg(0, 1)] }, {}, {}, [parent, cancelled])).toEqual({});
  });

  it('没有变化时返回原对象（订阅者不因此重画）', () => {
    const held = {};
    expect(holdSegments({}, {}, held, [])).toBe(held);
  });
});

describe('投到时间线上', () => {
  it('段落经取用这个素材的实例投到序列上：裁掉的部分不出现，错开的实例放对', () => {
    // 素材 0–10 秒放在序列 0–5 秒（取 0–5），素材 20–30 秒放在序列 5–10 秒。
    const seq = sequence([video('v1', 0, 150, 0), video('v2', 150, 150, 20)]);
    const segments = [seg(1, 3, 'a'), seg(6, 8, 'cut'), seg(21, 24, 'b'), seg(4, 22, 'across')];
    const placed = placeSegments(seq, 'a1', segments);
    expect(placed.map((p) => [p.text, p.index, p.start, p.end])).toEqual([
      ['a', 0, 1, 3],
      ['across', 3, 4, 5],
      ['across', 3, 5, 7],
      ['b', 2, 6, 9],
    ]);
    // 同一批段落、同一版序列再取是同一份。
    expect(placeSegments(seq, 'a1', segments)).toBe(placed);
  });

  it('待定带也按实例裁成几块；时长不明时延到实例末尾', () => {
    const seq = sequence([video('v1', 0, 150, 0), video('v2', 150, 150, 20)]);
    expect(placePending(seq, 'a1', { start: 3, end: 30 })).toEqual([
      { start: 3, end: 5 },
      { start: 5, end: 10 },
    ]);
    expect(placePending(seq, 'a1', { start: 22, end: Infinity })).toEqual([{ start: 7, end: 10 }]);
    expect(placePending(seq, 'a1', null)).toEqual([]);
  });
});
