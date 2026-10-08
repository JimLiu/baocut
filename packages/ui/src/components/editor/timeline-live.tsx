import { useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import type { AssetRecord, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import TranscriptIcon from '@react-spectrum/s2/icons/Transcript';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatClock } from '../../model/format.ts';
import {
  assetCaptioned,
  liveAt,
  livePending,
  liveRowShown,
  liveTranscriptions,
  placePending,
  placeSegments,
  placeTranscript,
  transcribedBefore,
  transcriptRows,
  type TranscriptRowSource,
} from '../../model/live-transcript.ts';
import { projectableItems } from '../../model/speech-cues.ts';
import { jobLive, jobPercent } from '../../model/task-list.ts';
import { assetDuration } from '../../model/transcript-cut.ts';
import { useJobs, useLiveSegments } from '../../state/jobs-store.ts';
import { SUBTITLE_COPY as C } from './subtitle-copy.ts';
import { useDocumentBody } from './timeline-cues.tsx';

const icon = iconStyle({ size: 'XS' });
const label = style({ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
/** 行头的呼吸点（原型 `.thd__live`）：这一行还在长；百分比不写在行头里，进提示。 */
const dot = style({ flexShrink: 0, width: 6, height: 6, marginEnd: 8, borderRadius: 'full', backgroundColor: 'purple-900' });
/** 已识别的段落：与字幕片段里的句子块同一个样子（timeline-cues.tsx），只读，点了跳过去。 */
const cue = style({
  position: 'absolute',
  top: 4,
  bottom: 4,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: 'purple-300',
  font: 'ui-xs',
  color: 'purple-1100',
  overflow: 'hidden',
  cursor: 'pointer',
});
const cueText = style({ truncate: true, minWidth: 0 });
/** 只读文稿行的句子块（原型 ui.css `.ttx`）：中性灰底深字，与字幕的颜色分开——它不上画面、不进导出；没有选中态。 */
const transcriptCue = style({
  position: 'absolute',
  top: 4,
  bottom: 4,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: { default: 'gray-200', ':hover': 'gray-300' },
  font: 'ui-xs',
  color: 'gray-800',
  overflow: 'hidden',
  cursor: 'pointer',
});
/** 最后一段末尾的光标（原型 `.tcue__cur`）：这里还在长。 */
const caret = style({ flexShrink: 0, width: 1, height: 10, marginStart: 2, backgroundColor: 'purple-1100' });
/** 还没转录到的那段（原型 `.tpend`）：斜纹、低对比，前缘一道实线；它不是块，点了只是跳过去。 */
const band = style({
  position: 'absolute',
  top: 4,
  bottom: 4,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: '[6px]',
  paddingStart: '[10px]',
  paddingEnd: 8,
  borderRadius: 'sm',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  font: 'ui-xs',
  color: 'gray-700',
  userSelect: 'none',
  '--bc-live-bg': { type: 'backgroundColor', value: 'gray-100' },
  '--bc-live-stripe': { type: 'backgroundColor', value: 'gray-200' },
  '--bc-live-edge': { type: 'backgroundColor', value: 'purple-900' },
});
const bandDot = style({ flexShrink: 0, width: 6, height: 6, borderRadius: 'full', backgroundColor: 'purple-900' });
const bandText = style({ overflow: 'hidden', textOverflow: 'ellipsis' });

/** 句子块窄于这个宽度就不写字（同 timeline-cues.tsx）。 */
const LABEL_MIN_PX = 45;
/** 相邻两句之间留的缝。 */
const GAP_PX = 2;

/**
 * 时间线上要画临时转录行的转写 Job（`jobId`）：第一次转录、时间线上取用了这个素材、还没有它的字幕（`liveRowShown`）。
 * 选出的是一串 ID，进度与段落每来一条不会让整条时间线重画；画内容的 `LiveCaptionRow` 自己订阅。
 */
export function useLiveRows(videoId: Id | null, sequence: Sequence, documents: Record<Id, DocumentRecord>): Id[] {
  const key = useJobs((s) =>
    liveTranscriptions(s.jobs, videoId)
      .filter(
        (t) =>
          projectableItems(sequence, t.assetId).length > 0 &&
          liveRowShown({
            running: t.running,
            segments: (s.liveSegments[t.step.jobId] ?? s.heldSegments[t.step.jobId] ?? []).length,
            captioned: assetCaptioned(sequence, documents, t.assetId),
            transcribedBefore: transcribedBefore(documents, t.assetId, t.step.createdAt),
          }),
      )
      .map((t) => t.step.jobId)
      .join(' '),
  );
  return useMemo(() => (key ? key.split(' ') : []), [key]);
}

/**
 * 转录中的临时字幕行（原型 timeline-rows.jsx `SubsRow` 第 220 轮）。第一次转录时还没有字幕轨——转录流程最后一步才建——所以
 * 这一行不属于哪条轨，占在字幕行的位置上：已识别的段落一段一块，最后一段末尾挂光标；从转录位置到素材末尾是「转录中」待定带。
 * 段落按素材时钟，经取用这个素材的实例投到时间线上（`placeSegments`），裁掉、错开的实例照样放对。只读：不进选区、不能拖，
 * 点块或带只是跳播放头。行头只有图标、名字与呼吸点，没有开关（还不是一条轨）。
 */
export function LiveCaptionRow({
  jobId,
  sequence,
  assets,
  height,
  rowClass,
  headerClass,
  laneClass,
  laneWidth,
  pps,
  xOf,
  view,
  onSeek,
}: {
  jobId: Id;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  height: number;
  rowClass: string;
  headerClass: string;
  laneClass: string;
  laneWidth: number;
  pps: number;
  /** 序列时间（秒）→ 轨道内容里的横坐标。 */
  xOf(seconds: number): number;
  /** 看得见的横向范围（轨道内容坐标）。 */
  view: { left: number; right: number };
  onSeek(seconds: number): void;
}) {
  const step = useJobs((s) => s.jobs.find((j) => j.jobId === jobId) ?? null);
  const segments = useLiveSegments(jobId);
  const assetId = step?.assetId ?? null;
  const running = !!step && jobLive(step);
  const progress = step?.progress ?? null;
  const duration = (assetId && assetDuration(assets, assetId)) || (progress?.unit === 'seconds' ? progress.total : null);
  const at = liveAt(segments, progress, duration, !running);
  const pending = livePending(at, duration, !running);
  const placed = useMemo(() => (assetId ? placeSegments(sequence, assetId, segments) : []), [sequence, assetId, segments]);
  const pendingStart = pending?.start ?? null;
  const pendingEnd = pending?.end ?? null;
  const bands = useMemo(
    () =>
      assetId && pendingStart !== null && pendingEnd !== null
        ? placePending(sequence, assetId, { start: pendingStart, end: pendingEnd })
        : [],
    [sequence, assetId, pendingStart, pendingEnd],
  );
  if (!step || !assetId) return null;

  const pct = running ? jobPercent(step) : null;
  const remain = pending && duration ? formatClock(duration - at) : null;
  const tip = C.liveTip(pct, formatClock(at), remain);
  const last = placed.length ? placed[placed.length - 1]! : null;
  // 不让空白处的框选从这一行起手：这一行没有可选的东西。
  const hold = (event: ReactPointerEvent) => event.stopPropagation();

  return (
    <div className={rowClass} style={{ height }}>
      <div className={headerClass} onPointerDown={hold}>
        <CloseCaptions styles={icon} data-bc-icons="own" />
        <span className={label} title={tip}>
          {C.trackName}
        </span>
        {running ? <span className={`${dot} bc-live-dot`} title={tip} /> : null}
      </div>
      <div className={laneClass} style={{ width: laneWidth }} onPointerDown={hold}>
        {placed.map((p) => {
          const x0 = xOf(p.start);
          const x1 = xOf(p.end);
          if (x1 < view.left || x0 > view.right) return null;
          const width = Math.max(2, x1 - x0 - GAP_PX);
          const tail = running && p === last;
          return (
            <span key={p.key} className={cue} style={{ left: x0, width }} title={p.text} onClick={() => onSeek(p.start)}>
              {width >= LABEL_MIN_PX ? <span className={cueText}>{p.text}</span> : null}
              {tail ? <span className={`${caret} bc-live-caret`} /> : null}
            </span>
          );
        })}
        {bands.map((b) => {
          const x0 = xOf(b.start);
          const x1 = xOf(b.end);
          if (x1 < view.left || x0 > view.right) return null;
          const width = Math.max(2, x1 - x0);
          return (
            <div
              key={b.start}
              className={`${band} bc-live-pending`}
              style={{ left: x0, width }}
              title={tip}
              onClick={(event) => {
                // 带上点哪里播放头就落哪里——它是时间线上一段普通的地面，不是可选中的块。
                const rect = event.currentTarget.getBoundingClientRect();
                onSeek(Math.max(b.start, Math.min(b.end, b.start + (event.clientX - rect.left) / pps)));
              }}>
              <span className={`${bandDot} bc-live-dot`} />
              {width >= 150 ? (
                <span className={bandText}>{remain ? C.pendingLeft(remain) : C.liveTitle}</span>
              ) : width >= 60 ? (
                <span className={bandText}>{C.liveTitle}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 时间线上要画只读文稿行的素材（`transcriptRows`）：一条字幕轨都没有、素材转录过。正画着临时转录行（`liveRows`）的素材不算，
 * 免得转写落地、字幕层还没建好时同一段话画两行。
 */
export function useTranscriptRows(sequence: Sequence, documents: Record<Id, DocumentRecord>, liveRows: readonly Id[]): TranscriptRowSource[] {
  const live = useJobs((s) => liveRows.map((jobId) => s.jobs.find((j) => j.jobId === jobId)?.assetId ?? '').join(' '));
  return useMemo(() => transcriptRows(sequence, documents, new Set(live.split(' ').filter(Boolean))), [sequence, documents, live]);
}

/**
 * 只读的「文稿」行（原型 timeline-rows.jsx `TranscriptRow`）：视频转录过、却还没有字幕轨时，文稿一句一块落在字幕行的位置上，
 * 看得见哪里在说话。它不是轨：行头只有图标与名字，没有开关；块不可选中、不可裁，点一句只把播放头落到句首。
 */
export function TranscriptRow({
  source,
  sequence,
  height,
  rowClass,
  headerClass,
  laneClass,
  laneWidth,
  xOf,
  view,
  onSeek,
}: {
  source: TranscriptRowSource;
  sequence: Sequence;
  height: number;
  rowClass: string;
  headerClass: string;
  laneClass: string;
  laneWidth: number;
  /** 序列时间（秒）→ 轨道内容里的横坐标。 */
  xOf(seconds: number): number;
  /** 看得见的横向范围（轨道内容坐标）。 */
  view: { left: number; right: number };
  onSeek(seconds: number): void;
}) {
  const body = useDocumentBody(source.speech);
  const placed = useMemo(() => placeTranscript(sequence, source.assetId, body), [sequence, source.assetId, body]);
  // 不让空白处的框选从这一行起手：这一行没有可选的东西。
  const hold = (event: ReactPointerEvent) => event.stopPropagation();
  return (
    <div className={rowClass} style={{ height }}>
      <div className={headerClass} onPointerDown={hold}>
        <TranscriptIcon styles={icon} data-bc-icons="own" />
        <span className={label} title={C.transcriptRowTip}>
          {C.transcriptRow}
        </span>
      </div>
      <div className={laneClass} style={{ width: laneWidth }} onPointerDown={hold}>
        {placed.map((p) => {
          const x0 = xOf(p.start);
          const x1 = xOf(p.end);
          if (x1 < view.left || x0 > view.right) return null;
          const width = Math.max(2, x1 - x0 - GAP_PX);
          return (
            <span
              key={p.key}
              className={transcriptCue}
              style={{ left: x0, width }}
              title={`${p.text} · ${C.transcriptRowTip}`}
              onClick={() => onSeek(p.start)}>
              {width >= LABEL_MIN_PX ? <span className={cueText}>{p.text}</span> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
