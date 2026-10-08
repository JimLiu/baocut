import { useMemo } from 'react';
import type { Id, Sequence } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatClock } from '../../model/format.ts';
import { placeSegments } from '../../model/live-transcript.ts';
import { jobLive } from '../../model/task-list.ts';
import { useJobs, useLiveSegments } from '../../state/jobs-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { JumpToLatest, LiveSkeleton, useFollowLatest } from './live-follow.tsx';
import { TRANSCRIPT_COPY as T } from './transcript-copy.ts';

const frame = style({ position: 'relative', flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' });
const body = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingTop: 8, paddingBottom: 12 });
const list = style({ display: 'flex', flexDirection: 'column', gap: 8 });
/** 一条（原型 `.sb.sb--live`）：与字幕列表的句子卡同一个外形（subtitle-panel.tsx `cueCard`），只读，点了跳过去。 */
const card = style({
  position: 'relative',
  overflow: 'hidden',
  paddingY: '[9px]',
  paddingStart: '[12px]',
  paddingEnd: '[10px]',
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-25',
  cursor: 'pointer',
});
/** 宏里没有逐边的边框色：左边那道色条单画一块。还没有说话人，退灰。 */
const accent = style({ position: 'absolute', top: 0, bottom: 0, insetStart: 0, width: '[3px]', backgroundColor: 'gray-300' });
const head = style({ display: 'flex', alignItems: 'center', gap: '[6px]', marginBottom: '[5px]', minHeight: 20 });
const number = style({ fontSize: '[10px]', color: 'gray-500', minWidth: 16 });
/** 说话人要等转录完成才有：在长的那一条写「识别中」，退灰（原型 `.sbsp--unk`）。 */
const unknown = style({ font: 'ui-xs', fontWeight: 'bold', color: 'gray-500' });
const time = style({ font: 'ui-xs', color: 'gray-500' });
const text = style({
  font: 'body-sm',
  lineHeight: '[1.6]',
  color: { default: 'gray-800', isTail: 'gray-700' },
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
});
/** 光标只跟在还在长的那一条后面（原型 `.caret`）。 */
const caret = style({
  display: 'inline-block',
  width: 2,
  height: 14,
  marginStart: 2,
  verticalAlign: 'middle',
  backgroundColor: 'blue-900',
});

/**
 * 转录中的字幕面板（原型 panel-subtitle.jsx 第 220 轮）：第一次转录、还没有字幕可校对时，运行态头（进度、阶梯、取消）下面按到达
 * 顺序列出已识别的段落，一段一张只读卡（序号、时间、正文），点了跳过去；不能改字、不进撤销——这些还不是字幕文档，转录流程
 * 最后一步才切成字幕。只列落在时间线上的段落（字幕只为时间线上的部分生成），时间是它在时间线上第一次出现的位置。还一条都
 * 没有时画骨架；默认跟着最新的往下滚，往上翻就停住，浮出「回到最新」。`jobId` 是跑识别的转写 Job；还在提交时为 null。
 */
export function SubtitleLive({ jobId, sequence }: { jobId: Id | null; sequence: Sequence }) {
  const { seek } = useEditorActions();
  const step = useJobs((s) => (jobId ? (s.jobs.find((j) => j.jobId === jobId) ?? null) : null));
  const segments = useLiveSegments(jobId);
  const assetId = step?.assetId ?? null;
  const running = !!step && jobLive(step);
  // 每段一张卡：跨剪辑点裁成几块的取第一块的起点，整段被剪掉的不列。
  const cards = useMemo(() => {
    if (!assetId) return [];
    const seen = new Set<number>();
    const out: Array<{ index: number; start: number; text: string }> = [];
    for (const p of placeSegments(sequence, assetId, segments)) {
      if (seen.has(p.index)) continue;
      seen.add(p.index);
      const text = segments[p.index]?.text.trim() ?? '';
      if (text) out.push({ index: p.index, start: p.start, text });
    }
    return out.sort((a, b) => a.index - b.index);
  }, [sequence, assetId, segments]);
  const { bodyRef, follow, onScroll, toLatest } = useFollowLatest(cards.length);

  return (
    <div className={frame}>
      <div ref={bodyRef} className={`${body} bc-scroll`} onScroll={onScroll} aria-live="polite">
        {cards.length ? (
          <div className={list}>
            {cards.map((c, i) => {
              const tail = running && i === cards.length - 1;
              return (
                <div key={c.index} className={card} onClick={() => seek(c.start)}>
                  <span className={accent} aria-hidden />
                  <div className={head}>
                    <span className={`${number} bc-tabular`}>{i + 1}</span>
                    {tail ? <span className={unknown}>{T.liveSpeaker}</span> : null}
                    <span className={`${time} bc-tabular`}>{formatClock(c.start)}</span>
                  </div>
                  <div className={text({ isTail: tail })}>
                    {c.text}
                    {tail ? <span className={`${caret} bc-live-caret`} /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <LiveSkeleton hint={T.liveWaiting} />
        )}
      </div>
      {follow ? null : <JumpToLatest label={T.liveJump} onPress={toLatest} />}
    </div>
  );
}
