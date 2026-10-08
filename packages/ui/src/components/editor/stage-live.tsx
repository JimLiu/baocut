import { useEffect, useMemo } from 'react';
import type { DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { liveCaptionCues } from '../../model/live-caption.ts';
import { placeSegments } from '../../model/live-transcript.ts';
import { useJobs, useLiveSegments } from '../../state/jobs-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { useLiveRows } from './timeline-live.tsx';

/**
 * 转录中画面上的临时字幕（原型 stage.jsx 第 220 轮；产品设计 §5.7）。与时间线的临时字幕行同一道门（`useLiveRows`：第一次
 * 转录、时间线上取用了这个素材、还没有它的字幕轨）：已识别的段落投到序列上交给预览引擎，播放头落在一段里画面上就有这一段，
 * 还没转录到的部分什么都不画。字幕轨出来（或流程结束）这一层就收起，之后由真字幕接着画。不画 DOM，只往引擎里送。
 */
export function StageLiveCaptions({
  videoId,
  sequence,
  documents,
}: {
  videoId: Id | null;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
}) {
  const jobIds = useLiveRows(videoId, sequence, documents);
  return (
    <>
      {jobIds.map((jobId) => (
        <StageLiveCaption key={jobId} jobId={jobId} sequence={sequence} />
      ))}
    </>
  );
}

/** 一次转录的临时字幕：段落每来一条重新投一次，卸下时从引擎里撤掉。 */
function StageLiveCaption({ jobId, sequence }: { jobId: Id; sequence: Sequence }) {
  const { engine } = useEditorActions();
  const assetId = useJobs((s) => s.jobs.find((j) => j.jobId === jobId)?.assetId ?? null);
  const segments = useLiveSegments(jobId);
  const cues = useMemo(() => (assetId ? liveCaptionCues(placeSegments(sequence, assetId, segments)) : []), [sequence, assetId, segments]);
  useEffect(() => engine.setLiveCaption(jobId, cues), [engine, jobId, cues]);
  useEffect(() => () => engine.setLiveCaption(jobId, null), [engine, jobId]);
  return null;
}
