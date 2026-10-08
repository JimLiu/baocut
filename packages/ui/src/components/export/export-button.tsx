import { useEffect, useRef, useState } from 'react';
import type { Id, Sequence } from '@baocut/protocol';
import { Button, DialogTrigger, Popover, Text, ToastQueue } from '@react-spectrum/s2';
import ExportIcon from '@react-spectrum/s2/icons/Export';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { assetFilePath } from '../../model/editor-ops.ts';
import { exportButtonLabel, exportDir, exportOutputs, exportTitle, latestLiveExport, videoExports } from '../../model/export-job.ts';
import { exportSourceDir } from '../../model/export-settings.ts';
import { jobLive } from '../../model/task-list.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import type { OpenVideo } from '../../state/video-store.ts';
import { mediaCandidates } from '../editor/transcribe-run.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { Note } from './export-parts.tsx';
import { ExportPanel } from './export-popover.tsx';
import type { ExportEnv } from './use-export-submit.ts';

/**
 * 视频栏的「导出」按钮（设计稿 export.jsx、产品设计 §17.1）：点开右对齐的导出弹层。
 * 这个视频有导出在跑时（谁提交的都算），按钮念「导出中 · NN%」；关掉弹层不停导出。
 * 弹层关着时导出结束：完成给一条提示，可以直接在文件夹中显示；失败或中断给一条提示，点「查看」打开弹层看原因。
 */

const tabular = { fontVariantNumeric: 'tabular-nums' } as const;
const empty = style({ width: 368, padding: 24, boxSizing: 'border-box' });

export function ExportButton({ video, sequence }: { video: OpenVideo; sequence: Sequence | null }) {
  const videoId = video.videoId;
  const jobs = useJobs((s) => s.jobs);
  const live = videoId ? latestLiveExport(jobs, videoId) : null;
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<Id | null>(null);
  useEndNotices(videoId, open, (jobId) => {
    setFocus(jobId);
    setOpen(true);
  });
  if (!videoId) return null;
  const label = exportButtonLabel(live);

  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFocus(null);
      }}>
      <Button variant="accent" aria-label={live ? `${label} · ${EXPORT_COPY.buttonBusyTitle}` : EXPORT_COPY.button}>
        <ExportIcon />
        <Text>
          <span style={tabular}>{label}</span>
        </Text>
      </Button>
      <Popover placement="bottom end" padding="none" aria-label={EXPORT_COPY.title}>
        <PanelHost video={video} videoId={videoId} sequence={sequence} initialJobId={focus} onClose={() => setOpen(false)} />
      </Popover>
    </DialogTrigger>
  );
}

/** 弹层打开那一刻的视频事实；播放头与选区取打开时的（弹层开着时编辑器不动）。 */
function PanelHost({ video, videoId, sequence, initialJobId, onClose }: { video: OpenVideo; videoId: Id; sequence: Sequence | null; initialJobId: Id | null; onClose: () => void }) {
  const web = useRuntime().host.platform === 'web';
  const [{ playhead, selection }] = useState(() => {
    const s = useEditor.getState();
    return { playhead: s.playhead, selection: s.selection };
  });
  const snapshot = video.state?.video ?? null;
  if (!snapshot || !sequence) {
    return (
      <div className={empty}>
        <Note>{EXPORT_COPY.notOpen}</Note>
      </div>
    );
  }
  // 成片没挑位置时导到主素材（时间轴上最早出现的那段视频或音频）所在的文件夹。Web 上 Runtime 只往项目的 exports/ 里写，不给。
  const main = web ? undefined : mediaCandidates(sequence, snapshot.assets, snapshot.documents)[0]?.asset;
  const videoDir = video.ref?.path ?? null;
  const env: ExportEnv = {
    videoId,
    videoName: snapshot.name,
    sequence,
    documents: snapshot.documents,
    assets: snapshot.assets,
    playhead,
    selection,
    ready: video.status === 'ready',
    sourceDir: main ? exportSourceDir(assetFilePath(main, videoDir), videoDir) : null,
  };
  return <ExportPanel env={env} initialJobId={initialJobId} onClose={onClose} />;
}

/**
 * 弹层关着时，这个视频的某次导出从「在跑」变成结束：完成、失败、中断各给一条提示（取消是用户自己点的，不再提示）。
 * 只看这个窗口亲眼见过在跑的那些，刚连上时的历史记录不提示。
 */
function useEndNotices(videoId: Id | null, open: boolean, onView: (jobId: Id) => void) {
  const runtime = useRuntime();
  const jobs = useJobs((s) => s.jobs);
  const seen = useRef<Map<Id, boolean> | null>(null);
  const view = useRef(onView);
  useEffect(() => {
    view.current = onView;
  });

  useEffect(() => {
    const mine = videoId ? videoExports(jobs, videoId) : [];
    const before = seen.current;
    seen.current = new Map(mine.map((j) => [j.jobId, jobLive(j)]));
    if (!before || open) return;
    for (const job of mine) {
      if (before.get(job.jobId) !== true || jobLive(job)) continue;
      const title = job.export ? exportTitle(job.export.settings) : EXPORT_COPY.title;
      if (job.state === 'completed') {
        const target = exportOutputs(job)[0]?.path ?? exportDir(job);
        const name = exportOutputs(job)[0]?.name ?? title;
        ToastQueue.positive(EXPORT_COPY.exportedToast(name), {
          timeout: 8000,
          ...(target ? { actionLabel: EXPORT_COPY.reveal, onAction: () => void runtime.host.revealPath(target), shouldCloseOnAction: true } : {}),
        });
      } else if (job.state === 'failed' || job.state === 'interrupted') {
        const text = job.state === 'failed' ? EXPORT_COPY.failedToast(title) : EXPORT_COPY.interruptedToast(title);
        ToastQueue.negative(text, { timeout: 10000, actionLabel: EXPORT_COPY.view, onAction: () => view.current(job.jobId), shouldCloseOnAction: true });
      }
    }
  }, [jobs, videoId, open, runtime]);
}
