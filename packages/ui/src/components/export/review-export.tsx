import { useEffect, useMemo, useRef, useState } from 'react';
import type { Id } from '@baocut/protocol';
import { Badge, Button, Picker, PickerItem, ProgressBar, Switch, Text } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { exportCliCommand } from '../../model/export-cli.ts';
import { latestLiveExport } from '../../model/export-job.ts';
import { exportLanes } from '../../model/export-lanes.ts';
import {
  DEFAULT_LOUDNESS_FORM,
  DEFAULT_VIDEO_FORM,
  defaultFileNames,
  pickResolution,
  resolutionChoices,
  sourceShortSide,
  videoSettings,
} from '../../model/export-settings.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { copyToClipboard } from '../editor/transcript-actions.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { Actions, Note, TextLink } from './export-parts.tsx';
import { RejectedAlert } from './export-remedy.tsx';
import { ExportJobView } from './export-status.tsx';
import { useExportSubmit, type ExportEnv } from './use-export-submit.ts';

/**
 * 审片页的导出（产品设计 §5.12，设计稿 export-quick.jsx）：只导这部视频的 MP4 成片。
 *
 * - 能挑的只有尺寸（同导出面板的尺寸表，缺省画布那档）与字幕画不画进画面；其余照时间线，位置是项目的 `exports/`（Runtime 的缺省）。
 * - 「复制等效命令」给出同一次导出的 `baocut export`（`exportCliCommand`）。
 * - 审片会话订阅不了全局的 `jobs` 主题（架构设计 §4.8「审片链接」）：进度靠 `exports.list` 轮询，结果写进 jobs-store，
 *   导出按钮、运行态与完成态照常读它；列表里只有这个会话自己起的导出。
 * - 完成后「复制路径」与「下载」（`webExportDownloadPath`），没有「在文件夹中显示」。
 */

const panel = style({ display: 'flex', flexDirection: 'column', width: 440, padding: 24, maxWidth: '[calc(100vw - 48px)]', boxSizing: 'border-box' });
const header = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 });
const title = style({ margin: 0, font: 'title', color: 'gray-900' });
const summary = style({ marginTop: 8, font: 'ui-sm', color: 'gray-700', overflowWrap: 'anywhere' });
const rows = style({ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 });
const row = style({ display: 'grid', gridTemplateColumns: '[56px minmax(0, 1fr)]', alignItems: 'center', columnGap: 12 });
const rowTop = style({ display: 'grid', gridTemplateColumns: '[56px minmax(0, 1fr)]', alignItems: 'start', columnGap: 12 });
const label = style({ font: 'ui-sm', color: 'gray-700' });
const value = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 });
const file = style({ font: 'code-sm', color: 'gray-900', overflowWrap: 'anywhere' });
const detail = style({ font: 'ui-xs', color: 'gray-600' });
const buttons = style({ display: 'flex', gap: 8, flexShrink: 0 });
const waitBar = style({ marginTop: 16 });

const FAST_MS = 1000;
const SLOW_MS = 10_000;

/** 拉一次这部视频的导出（只有这个审片会话起的），整份放进 jobs-store。失败时不动（下一次再拉）。 */
export async function refreshReviewExports(runtime: RuntimeSession, videoId: Id): Promise<void> {
  try {
    const jobs = await runtime.listExports(videoId);
    useJobs.getState().replace({ jobs });
  } catch {
    // 断线或会话过期：页面另有提示，这里等下一次。
  }
}

/** 审片页轮询导出：有导出在跑或弹层开着时每秒一次，否则每 10 秒一次；打开页面时先拉一次，接上关页前还在跑的。 */
export function useReviewExportPoll(videoId: Id | null, fast: boolean): void {
  const runtime = useRuntime();
  const pace = useRef(fast);
  pace.current = fast;
  const kick = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!runtime.review || !videoId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      clearTimeout(timer);
      await refreshReviewExports(runtime, videoId);
      if (!stopped) timer = setTimeout(() => void tick(), pace.current ? FAST_MS : SLOW_MS);
    };
    kick.current = () => void tick();
    void tick();
    return () => {
      stopped = true;
      kick.current = null;
      clearTimeout(timer);
    };
  }, [runtime, videoId]);
  // 从慢变快（打开弹层、刚提交）时立刻拉一次，不等满 10 秒。
  useEffect(() => {
    if (fast) kick.current?.();
  }, [fast]);
}

export function ReviewExportPanel({ env, initialJobId, onClose }: { env: ExportEnv; initialJobId: Id | null; onClose: () => void }) {
  const runtime = useRuntime();
  const jobs = useJobs((s) => s.jobs);
  const [watch, setWatch] = useState<Id | null>(() => initialJobId ?? latestLiveExport(jobs, env.videoId)?.jobId ?? null);
  const submitter = useExportSubmit(env, (jobId) => {
    setWatch(jobId);
    void refreshReviewExports(runtime, env.videoId);
  });
  const watched = watch ? (jobs.find((j) => j.jobId === watch) ?? null) : null;

  if (watch) {
    return (
      <div className={panel}>
        {watched ? (
          <ExportJobView job={watched} env={env} submitter={submitter} onReset={() => setWatch(null)} onClose={onClose} />
        ) : (
          <>
            <Note>{EXPORT_COPY.waiting}</Note>
            <div className={waitBar}>
              <ProgressBar aria-label={EXPORT_COPY.waiting} isIndeterminate />
            </div>
          </>
        )}
      </div>
    );
  }
  return <ReviewSetup env={env} submitter={submitter} onClose={onClose} />;
}

function ReviewSetup({ env, submitter, onClose }: { env: ExportEnv; submitter: ReturnType<typeof useExportSubmit>; onClose: () => void }) {
  const [short, setShort] = useState<number | null>(null);
  const [burn, setBurn] = useState(true);
  const [copied, setCopied] = useState(false);
  const { width, height } = env.sequence.canvas;
  const canvas = useMemo(() => ({ width, height }), [width, height]);
  const sourceShort = useMemo(() => sourceShortSide(env.sequence, env.assets, canvas), [env.sequence, env.assets, canvas]);
  const resolutions = useMemo(() => resolutionChoices(canvas, undefined, sourceShort), [canvas, sourceShort]);
  const resolution = pickResolution(resolutions, short);
  const captions = useMemo(() => exportLanes(env.sequence, env.documents).filter((l) => l.kind === 'subtitle' && l.picture), [env.sequence, env.documents]);
  const form = { ...DEFAULT_VIDEO_FORM, short: resolution && !resolution.canvas ? resolution.short : null, burnCaptions: burn };
  const settings = videoSettings(form, canvas, {}, DEFAULT_LOUDNESS_FORM, sourceShort);
  const [name] = defaultFileNames(env.videoName, settings, env.documents, env.sequence);
  const what = [
    resolution ? `${resolution.label} · ${resolution.width}×${resolution.height}` : null,
    captions.length ? (burn ? EXPORT_COPY.captionsBurned : EXPORT_COPY.captionsNotBurned) : null,
  ].filter(Boolean);

  const copyCommand = async () => {
    if (!(await copyToClipboard(exportCliCommand(env.videoId, settings), null))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={panel}>
      <div className={header}>
        <h2 className={title}>{EXPORT_COPY.quickTitle}</h2>
        <Badge variant="neutral" size="S" fillStyle="subtle">
          MP4
        </Badge>
      </div>
      {what.length ? <div className={summary}>{what.join(' · ')}</div> : null}
      <div className={rows}>
        <div className={row}>
          <span className={label}>{EXPORT_COPY.quickSize}</span>
          <Picker
            size="S"
            aria-label={EXPORT_COPY.quickSize}
            isDisabled={!resolutions.length}
            selectedKey={resolution ? String(resolution.short) : null}
            onSelectionChange={(key) => {
              if (key !== null) setShort(Number(key));
            }}>
            {resolutions.map((r) => (
              <PickerItem key={r.short} id={String(r.short)} textValue={`${r.label} · ${r.width}×${r.height}`}>
                <Text slot="label">{`${r.label} · ${r.width}×${r.height}`}</Text>
                {r.source ? <Text slot="description">{EXPORT_COPY.sourceResolution}</Text> : null}
              </PickerItem>
            ))}
          </Picker>
        </div>
        {captions.length ? (
          <div className={row}>
            <span className={label}>{EXPORT_COPY.quickCaptions}</span>
            <Switch size="S" isSelected={burn} onChange={setBurn}>
              {EXPORT_COPY.quickBurn}
            </Switch>
          </div>
        ) : null}
        <div className={rowTop}>
          <span className={label}>{EXPORT_COPY.quickSaveTo}</span>
          <span className={value}>
            {name ? <span className={file}>{name}</span> : null}
            <span className={detail}>{EXPORT_COPY.quickPlace}</span>
          </span>
        </div>
      </div>
      <Note>{EXPORT_COPY.quickNote}</Note>
      <RejectedAlert problem={submitter.problem} settings={submitter.rejected} videoId={env.videoId} busy={submitter.busy} onSubmit={(s) => void submitter.submit(s)} />
      {!env.ready ? <Note warn>{EXPORT_COPY.notOpen}</Note> : null}
      <Actions between>
        <TextLink onPress={() => void copyCommand()}>{copied ? EXPORT_COPY.commandCopied : EXPORT_COPY.copyCommand}</TextLink>
        <span className={buttons}>
          <Button variant="secondary" fillStyle="outline" onPress={onClose}>
            {EXPORT_COPY.cancel}
          </Button>
          <Button variant="accent" isPending={submitter.busy} isDisabled={!env.ready} onPress={() => void submitter.submit(settings)}>
            {EXPORT_COPY.button}
          </Button>
        </span>
      </Actions>
    </div>
  );
}
