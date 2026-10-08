import { useMemo } from 'react';
import type { AssetRecord, DocumentRecord, Id, JobLiveSegment, Sequence } from '@baocut/protocol';
import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Copy from '@react-spectrum/s2/icons/Copy';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatClock } from '../../model/format.ts';
import { liveTranscriptions, liveTranscriptShown, placeSegments } from '../../model/live-transcript.ts';
import { jobLive } from '../../model/task-list.ts';
import { useJobs, useLiveSegments } from '../../state/jobs-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { JumpToLatest, LiveSkeleton, useFollowLatest } from './live-follow.tsx';
import { PanelHead } from './panel-head.tsx';
import { copyToClipboard } from './transcript-actions.ts';
import { TRANSCRIPT_COPY as C } from './transcript-copy.ts';
import { TranscribeProgress } from './transcribe-progress.tsx';
import type { TranscribeRun } from './transcribe-run.ts';

const frame = style({ position: 'relative', flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' });
const body = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingTop: 12, paddingBottom: 12 });
const list = style({ display: 'flex', flexDirection: 'column', gap: 8 });
/** 实时段落（原型 `.para--live`）：与文稿的段落卡同一个外形，只读——没有词可点、没有菜单，点整段跳过去。 */
const row = style({
  paddingX: 8,
  paddingY: 8,
  borderRadius: 'lg',
  backgroundColor: 'gray-25',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  cursor: { default: 'default', isPlaced: 'pointer' },
});
const rowHead = style({ display: 'flex', alignItems: 'center', gap: 8, height: 20, marginBottom: 2 });
/** 说话人要等转录完成才有：在长的那一段写「识别中」，退灰。 */
const unknown = style({ font: 'ui-xs', fontWeight: 'bold', color: 'gray-500' });
const time = style({ font: 'ui-xs', color: 'gray-500' });
const text = style({
  font: 'body-sm',
  lineHeight: '[1.8]',
  color: { default: 'gray-800', isTail: 'gray-700' },
  overflowWrap: 'break-word',
});
/** 光标只跟在还在长的那一段后面（原型 `.caret`）。 */
const caret = style({
  display: 'inline-block',
  width: 2,
  height: 14,
  marginStart: 2,
  verticalAlign: 'middle',
  backgroundColor: 'blue-900',
});
const EMPTY: readonly JobLiveSegment[] = [];

/**
 * 文稿面板要切到实时态的那次转录（转写 Job 的 `jobId`）：时间线上能投影的素材里有一个正在转录（原型 panels.jsx：转录在跑就切，
 * 重新转录也一样）；转写做完以后等转写文档落进视频再切回（`liveTranscriptShown`）。选出的是 ID，进度每来一条不让整个面板重画。
 */
export function useLiveTranscriptJob(videoId: Id | null, assetIds: readonly Id[], documents: Record<Id, DocumentRecord>): Id | null {
  return useJobs((s) => {
    const found = liveTranscriptions(s.jobs, videoId);
    for (const assetId of assetIds) {
      const t = found.find((each) => each.assetId === assetId);
      if (!t) continue;
      const landed = t.step.result?.documentId ? !!documents[t.step.result.documentId] : false;
      const segments = (s.liveSegments[t.step.jobId] ?? s.heldSegments[t.step.jobId] ?? EMPTY).length;
      if (liveTranscriptShown({ running: t.running, segments, documentLanded: landed })) return t.step.jobId;
    }
    return null;
  });
}

/**
 * 转录中的文稿（原型 panels.jsx `LiveTranscript`）：任务事件流的投影，整面板只读——不能改字、不能剪、不进撤销栈。头上只留
 * 「复制已转录的部分」（润色、章节、说话人都要等完整文稿）；下面是运行态头（进度、阶梯、取消）与一段段流入的段落。还一段都没有时
 * （刚开始，或服务不流式返回）画骨架加一句提示，不造假数据。默认跟着最新的段落往下滚，往上翻就停住，浮出「回到最新」。
 */
export function LiveTranscript({ jobId, sequence, assets }: { jobId: Id; sequence: Sequence; assets: Record<Id, AssetRecord> }) {
  const { seek } = useEditorActions();
  const step = useJobs((s) => s.jobs.find((j) => j.jobId === jobId) ?? null);
  const parentId = step?.submitter.kind === 'pipeline' ? step.submitter.id : null;
  const parent = useJobs((s) => (parentId ? (s.jobs.find((j) => j.jobId === parentId) ?? null) : null));
  const segments = useLiveSegments(jobId);
  const assetId = step?.assetId ?? null;
  const running = !!step && jobLive(step);
  // 识别做完、流程还在把结果写进视频（建字幕层）：头部停在「保存」一级，不再给取消识别。
  const writing = useMemo<TranscribeRun | null>(
    () =>
      step && !running && step.videoId && assetId
        ? { videoId: step.videoId, assetId, assetName: assets[assetId]?.name ?? '', jobId: step.jobId, status: 'writing' }
        : null,
    [step, running, assetId, assets],
  );
  // 段落在时间线上第一次出现的位置：点了跳到那里；整段都被剪掉的没有。
  const starts = useMemo(() => {
    const map = new Map<number, number>();
    if (assetId) for (const p of placeSegments(sequence, assetId, segments)) if (!map.has(p.index)) map.set(p.index, p.start);
    return map;
  }, [sequence, assetId, segments]);

  const { bodyRef, follow, onScroll, toLatest } = useFollowLatest(segments.length);

  return (
    <>
      <PanelHead title={C.title}>
        <TooltipTrigger>
          <ActionButton
            isQuiet
            size="S"
            aria-label={C.liveCopy}
            isDisabled={!segments.length}
            onPress={() =>
              void copyToClipboard(
                segments
                  .map((s) => s.text.trim())
                  .filter(Boolean)
                  .join('\n'),
                C.liveCopied,
              )
            }>
            <Copy />
          </ActionButton>
          <Tooltip>{C.liveCopy}</Tooltip>
        </TooltipTrigger>
      </PanelHead>
      <TranscribeProgress
        run={writing}
        job={step}
        cancelJobId={parent?.jobId ?? null}
        assetName={assetId ? (assets[assetId]?.name ?? null) : null}
        note={C.liveNote}
        heading={C.liveSaving}
      />
      <div className={frame}>
        <div ref={bodyRef} className={`${body} bc-scroll`} onScroll={onScroll} aria-label={C.title} aria-live="polite">
          {segments.length ? (
            <div className={list}>
              {segments.map((segment, index) => {
                const tail = running && index === segments.length - 1;
                const at = starts.get(index);
                return (
                  <div key={index} className={row({ isPlaced: at !== undefined })} onClick={at === undefined ? undefined : () => seek(at)}>
                    <div className={rowHead}>
                      {tail ? <span className={unknown}>{C.liveSpeaker}</span> : null}
                      <span className={`${time} bc-tabular`}>{formatClock(segment.start)}</span>
                    </div>
                    <div className={text({ isTail: tail })}>
                      {segment.text.trim()}
                      {tail ? <span className={`${caret} bc-live-caret`} /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <LiveSkeleton hint={C.liveWaiting} />
          )}
        </div>
        {follow ? null : <JumpToLatest label={C.liveJump} onPress={toLatest} />}
      </div>
    </>
  );
}
