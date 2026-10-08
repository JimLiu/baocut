import { useEffect } from 'react';
import { create } from 'zustand';
import type { ExternalToolStatus, ExternalToolUpdatePlan, Id, JobRecord } from '@baocut/protocol';
import { ActionButton, Badge, Button, ProgressBar, Text, ToastQueue } from '@react-spectrum/s2';
import Download from '@react-spectrum/s2/icons/Download';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { DOWNLOADER, rejectionCode, toolCard, toolReady, type ToolCard, type ToolCardState } from '../../model/link-import.ts';
import { hasUpdateSection, updateBefore, updateSummary } from '../../model/tool-update.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { useSettings } from '../../state/settings-store.ts';
import { DownloaderUpdateSection, type DownloaderUpdateRun } from './downloader-update.tsx';
import { ST } from './start-copy.ts';
import { jobErrorText } from '../../model/localized-text.ts';

/**
 * 下载工具（yt-dlp）的状态与卡片（设计稿 import-panel.jsx `DownloaderSettings`、import-flow.jsx 的 `downloader`）。
 * 首页链接档与链接导入的任务详情共用一份：检测只在本机跑 `--version`（`externalTools.detect`），进来就看一眼；
 * 安装（带同意）、同意、指定位置都只在用户按了按钮之后做，安装的进度读 `jobs` 主题里那条 `toolInstall` 任务。
 * 系统里的那一份按原安装方式更新（产品设计 §2.7）：用户点了命令旁的执行才提交 `toolUpdate` 任务，输出读任务记录的 `command`。
 */

interface DownloaderState {
  status: ExternalToolStatus | null;
  checking: boolean;
  /** 检测过一次（成功或失败）。 */
  checked: boolean;
  /** 用户刚按了安装、任务事件还没到：先显示「正在准备」。 */
  installing: boolean;
  installJobId: Id | null;
  /** 检测本身失败（Runtime 没连上等）。 */
  error: string | null;
  /** 正在提交同意 / 安装 / 指定位置。 */
  busy: boolean;
  /** 正在提交更新（点了执行、Runtime 还没回话）。 */
  updateBusy: boolean;
  /** 卡片里的这一次更新（用户点了执行的，或探测时发现正在进行的）；点「关闭」后为 null。 */
  update: DownloaderUpdateRun | null;
}

export const useDownloader = create<DownloaderState>()(() => ({
  status: null,
  checking: false,
  checked: false,
  installing: false,
  installJobId: null,
  error: null,
  busy: false,
  updateBusy: false,
  update: null,
}));

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

let detecting: Promise<void> | null = null;

/** 重新检测（只在本机看一眼版本、不联网）。同时只跑一次。 */
export function detectDownloader(runtime: Pick<RuntimeSession, 'detectExternalTool'>): Promise<void> {
  if (detecting) return detecting;
  useDownloader.setState({ checking: true });
  detecting = runtime
    .detectExternalTool(DOWNLOADER)
    .then(
      (status) => useDownloader.setState({ status, checked: true, error: null }),
      (error: unknown) => useDownloader.setState({ checked: true, error: messageOf(error) }),
    )
    .finally(() => {
      useDownloader.setState({ checking: false });
      detecting = null;
    });
  return detecting;
}

/** 卡片的主按钮：没装 / 要更新 / 坏了时安装（`consent: true` 一并记下同意），装好了只差同意时只记同意。 */
async function fixDownloader(runtime: RuntimeSession, state: ToolCardState): Promise<void> {
  useDownloader.setState({ busy: true });
  try {
    if (state === 'consent') {
      const status = await runtime.consentExternalTool(DOWNLOADER, true);
      useDownloader.setState({ status });
    } else {
      useDownloader.setState({ installing: true });
      const { tool, jobId } = await runtime.installExternalTool(DOWNLOADER);
      useDownloader.setState({ status: tool, installJobId: jobId });
    }
  } catch (error) {
    useDownloader.setState({ installing: false });
    ToastQueue.negative(state === 'consent' ? ST.downloader.consentFailed(messageOf(error)) : ST.downloader.installFailed(messageOf(error)), { timeout: 6000 });
  } finally {
    useDownloader.setState({ busy: false });
  }
}

/** 指定自己装的那一份（Runtime 先跑一次 `--version` 核对）。宿主没有打开对话框时这一项置灰。 */
async function pickDownloader(runtime: RuntimeSession): Promise<void> {
  const pick = runtime.host.pickFiles;
  if (!pick) return;
  const [path] = await pick({ title: ST.downloader.pickTitle, buttonLabel: ST.downloader.pickButton, multiple: false });
  if (!path) return;
  useDownloader.setState({ busy: true });
  try {
    const status = await runtime.setExternalToolPath(DOWNLOADER, path);
    useDownloader.setState({ status });
  } catch (error) {
    ToastQueue.negative(ST.downloader.pickFailed(messageOf(error)), { timeout: 6000 });
  } finally {
    useDownloader.setState({ busy: false });
  }
}

/**
 * 点了命令旁的执行：交回界面上显示的那条命令（就是用户的确认）。Runtime 说办法已经变了（`TOOL_UPDATE_CONFIRM_REQUIRED`）
 * 或现在不能代为执行（`TOOL_UPDATE_MANUAL`）时不执行，把此刻的命令换上，让用户再看一眼。
 */
async function runUpdate(runtime: RuntimeSession, plan: ExternalToolUpdatePlan): Promise<void> {
  const before = useDownloader.getState().status?.version ?? null;
  useDownloader.setState({ updateBusy: true });
  try {
    const { tool, jobId } = await runtime.updateExternalTool(DOWNLOADER, plan.command);
    useDownloader.setState({ status: tool, update: { jobId, before, open: true, settled: false, after: null } });
  } catch (error) {
    const code = rejectionCode(error);
    const details = (error as { details?: { update?: ExternalToolUpdatePlan } } | null)?.details;
    const status = useDownloader.getState().status;
    if ((code === 'TOOL_UPDATE_CONFIRM_REQUIRED' || code === 'TOOL_UPDATE_MANUAL') && details?.update && status) {
      useDownloader.setState({ status: { ...status, update: details.update } });
      ToastQueue.neutral(code === 'TOOL_UPDATE_MANUAL' ? ST.downloader.manualUpdate : ST.downloader.commandChanged, {
        timeout: 6000,
      });
    } else {
      if (code === 'TOOL_UPDATE_UNSUPPORTED') void detectDownloader(runtime);
      ToastQueue.negative(ST.downloader.updateFailed(messageOf(error)), { timeout: 6000 });
    }
  } finally {
    useDownloader.setState({ updateBusy: false });
  }
}

async function stopUpdate(runtime: RuntimeSession, jobId: Id): Promise<void> {
  try {
    await runtime.cancelJob(jobId);
  } catch (error) {
    ToastQueue.negative(ST.downloader.stopFailed(messageOf(error)), { timeout: 5000 });
  }
}

const settling = new Set<Id>();

/**
 * 更新任务结束：重新检测拿到新版本，再说结果（卡片在几处同时挂着时只做一次）。成功时输出收起，失败与停止时留着。
 */
async function settleUpdate(runtime: RuntimeSession, job: JobRecord): Promise<void> {
  const run = useDownloader.getState().update;
  if (!run || run.jobId !== job.jobId || run.settled || settling.has(job.jobId)) return;
  settling.add(job.jobId);
  try {
    await detectDownloader(runtime);
    const after = useDownloader.getState().status?.version ?? null;
    const before = updateBefore(run.before, job);
    useDownloader.setState((s) =>
      s.update?.jobId === job.jobId ? { update: { ...s.update, before, after, settled: true, open: job.state !== 'completed' } } : {},
    );
    const sum = updateSummary({ state: job.state, exitCode: job.command?.exitCode ?? null, error: jobErrorText(job.error) ?? null, before, after });
    const toast = sum.tone === 'positive' ? ToastQueue.positive : sum.tone === 'negative' ? ToastQueue.negative : ToastQueue.neutral;
    toast(sum.title, { timeout: 5000 });
  } finally {
    settling.delete(job.jobId);
  }
}

/** 换下载位置（设置 `downloads.directory`）：之后的导入都下到那里。 */
export async function changeDownloadDir(runtime: RuntimeSession): Promise<void> {
  const dir = await runtime.host.pickDirectory();
  if (!dir) return;
  try {
    const snapshot = await runtime.client.request('settings.set', { values: { 'downloads.directory': dir } });
    useSettings.getState().replace(snapshot);
  } catch (error) {
    ToastQueue.negative(ST.downloader.dirFailed(messageOf(error)), { timeout: 5000 });
  }
}

export interface DownloaderView extends DownloaderState {
  card: ToolCard;
  ready: boolean;
  /** 正在进行的安装任务（有时）。 */
  job: JobRecord | null;
  /** 卡片里那次更新的任务（有时；刚提交、任务事件还没到时为 null）。 */
  updateJob: JobRecord | null;
  /** 正在更新（含结束后重新检测的那一下）：期间不能开始下载。 */
  updating: boolean;
}

/**
 * 读下载工具的状态：第一次用到时检测；安装任务结束后重新检测（失败时提示原因）。
 * `enabled` 为假时不检测（本地文件档用不到它）。
 */
export function useDownloaderTool(enabled: boolean): DownloaderView {
  const runtime = useRuntime();
  const state = useDownloader();
  const jobId = state.installJobId ?? state.status?.installJobId ?? null;
  const job = useJobs((s) => (jobId ? (s.jobs.find((j) => j.jobId === jobId) ?? null) : null));
  const ended = !!job && !isJobLive(job);
  const updateJobId = state.update?.jobId ?? state.status?.updateJobId ?? null;
  const updateJob = useJobs((s) => (updateJobId ? (s.jobs.find((j) => j.jobId === updateJobId) ?? null) : null));
  const updateEnded = !!updateJob && !isJobLive(updateJob);

  useEffect(() => {
    if (enabled && !useDownloader.getState().checked) void detectDownloader(runtime);
  }, [enabled, runtime]);

  useEffect(() => {
    if (!ended || !job) return;
    useDownloader.setState({ installing: false, installJobId: null });
    if (job.state === 'failed') ToastQueue.negative(ST.downloader.notInstalled(jobErrorText(job.error) ?? ST.downloader.installFailedFallback), { timeout: 6000 });
    void detectDownloader(runtime);
    // 只在这条安装任务结束的那一下收尾。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, job?.jobId, runtime]);

  // 探测时发现正在进行的更新（CLI 开始的、重启前开始的）：接上它，输出照样显示在卡片里。
  const liveUpdateId = state.status?.updateJobId ?? null;
  useEffect(() => {
    if (liveUpdateId && useDownloader.getState().update?.jobId !== liveUpdateId)
      useDownloader.setState({ update: { jobId: liveUpdateId, before: null, open: true, settled: false, after: null } });
  }, [liveUpdateId]);

  useEffect(() => {
    if (updateEnded && updateJob) void settleUpdate(runtime, updateJob);
    // 只在这条更新任务结束的那一下收尾。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateEnded, updateJob?.jobId, runtime]);

  const installing = state.installing || (!!job && !ended);
  const updating = (!!state.update && !state.update.settled) || !!liveUpdateId;
  return {
    ...state,
    installing,
    job,
    updateJob,
    updating,
    ready: toolReady(state.status) && !updating,
    card: toolCard(state.status, { checking: state.checking, installing, updating }),
  };
}

const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginTop: 12,
  padding: 16,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-300',
  backgroundColor: { default: 'gray-25', tone: { setup: 'blue-100', problem: 'orange-100' } },
});
const head = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const headIcon = style({ display: 'flex', flexShrink: 0, color: 'gray-700', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const headTitle = style({ flexGrow: 1, minWidth: 0, font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const bodyText = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });
const factList = style({ margin: 0, padding: 0, listStyleType: 'none', display: 'flex', flexDirection: 'column', gap: 2 });
const fact = style({ font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const actions = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 });

/** 状态徽标的颜色；文字在渲染时从 `ST.downloader.badge` 读。 */
const BADGE: Record<ToolCardState, 'positive' | 'informative' | 'notice' | 'negative' | 'neutral'> = {
  checking: 'neutral',
  unknown: 'negative',
  installing: 'informative',
  updating: 'informative',
  install: 'informative',
  update: 'notice',
  broken: 'negative',
  blocked: 'notice',
  consent: 'informative',
  ready: 'positive',
};

/**
 * 下载工具卡片（视频下载工具 · yt-dlp）：现状一句话、来源与许可这类事实、主按钮（同意并安装 / 同意并更新 / 同意使用）、
 * 重新检测、指定位置。安装中显示安装任务的进度。系统里的那一份在最下面有「更新」一节（命令、执行与复制、输出）。
 */
export function DownloaderCard({ view }: { view: DownloaderView }) {
  const runtime = useRuntime();
  const { card: c, busy, job, checking, error } = view;
  const tone =
    c.state === 'ready' || c.state === 'updating' ? undefined : c.state === 'install' || c.state === 'consent' || c.state === 'installing' ? 'setup' : 'problem';
  const progress = job?.progress;
  const pct = progress && progress.total ? Math.max(0, Math.min(100, Math.floor((progress.done / progress.total) * 100))) : null;
  const badge = { variant: BADGE[c.state], label: ST.downloader.badge[c.state] };
  const canPick = !!runtime.host.pickFiles;
  const updating = view.updating;
  return (
    <section className={card({ tone })} aria-label={ST.downloader.card}>
      <div className={head}>
        <span className={headIcon} aria-hidden>
          <Download />
        </span>
        <span className={headTitle}>{c.title}</span>
        <Badge variant={badge.variant} fillStyle="subtle" size="S">
          {badge.label}
        </Badge>
      </div>
      <p className={bodyText}>{error && !view.status ? ST.downloader.checkFailed(error) : c.body}</p>
      {c.facts.length ? (
        <ul className={factList}>
          {c.facts.map((f) => (
            <li key={f} className={fact}>
              {f}
            </li>
          ))}
        </ul>
      ) : null}
      {c.state === 'installing' ? <ProgressBar aria-label={ST.downloader.preparing} size="S" isIndeterminate={pct === null} value={pct ?? undefined} /> : null}
      <div className={actions}>
        {c.action ? (
          <Button variant="accent" size="S" isPending={busy} onPress={() => void fixDownloader(runtime, c.state)}>
            {c.action}
          </Button>
        ) : null}
        {c.state === 'installing' || c.state === 'checking' ? null : (
          <ActionButton size="S" isQuiet isPending={checking} isDisabled={updating} onPress={() => void detectDownloader(runtime)}>
            <Text>{ST.downloader.recheck}</Text>
          </ActionButton>
        )}
        {c.state === 'installing' || c.state === 'checking' || c.state === 'unknown' ? null : (
          <ActionButton size="S" isQuiet isDisabled={!canPick || busy || updating} onPress={() => void pickDownloader(runtime)}>
            <Text>{canPick ? ST.downloader.pick : ST.downloader.pickUnavailable}</Text>
          </ActionButton>
        )}
      </div>
      {view.status && (hasUpdateSection(view.status) || view.update) ? (
        <DownloaderUpdateSection
          plan={view.status.update}
          platform={view.status.platform ?? null}
          run={view.update}
          job={view.updateJob}
          busy={view.updateBusy}
          onRun={(plan) => void runUpdate(runtime, plan)}
          onStop={(jobId) => void stopUpdate(runtime, jobId)}
          onToggle={() => useDownloader.setState((s) => (s.update ? { update: { ...s.update, open: !s.update.open } } : {}))}
          onClose={() => useDownloader.setState({ update: null })}
        />
      ) : null}
    </section>
  );
}
