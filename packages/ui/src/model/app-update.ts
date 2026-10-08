import { defineMessages, getLocale, live, onLocaleChange, type JobRecord, type TaskSummary } from '@baocut/protocol';
import type { AppUpdateFailure, AppUpdateInfo, AppUpdateState } from '../host.ts';
import { TASK_VIEW_COPY } from '../copy.ts';
import { jobRow, type TaskAction } from './task-list.ts';
import { zhHans } from './app-update.zh-Hans.ts';
import { zhHant } from './app-update.zh-Hant.ts';
import { ja } from './app-update.ja.ts';
import { ko } from './app-update.ko.ts';
import { es } from './app-update.es.ts';
import { fr } from './app-update.fr.ts';
import { de } from './app-update.de.ts';
import { nl } from './app-update.nl.ts';
import { ptBR } from './app-update.pt-BR.ts';
import { it } from './app-update.it.ts';
import { ru } from './app-update.ru.ts';
import { pl } from './app-update.pl.ts';
import { tr } from './app-update.tr.ts';
import { vi } from './app-update.vi.ts';

/** 应用更新的文案（英文是键与类型的来源，译文在 `app-update.zh-Hans.ts`）。 */
const en = {
  justNow: 'Just now',
  minutesAgo: (n: number) => (n === 1 ? '1 minute ago' : `${n} minutes ago`),
  hoursAgo: (n: number) => (n === 1 ? '1 hour ago' : `${n} hours ago`),
  daysAgo: (n: number) => (n === 1 ? '1 day ago' : `${n} days ago`),
  failure: {
    check: 'Can’t reach the update server. Check your network and try again.',
    download: 'The download didn’t finish. Check your network and try again.',
    verify: 'The downloaded file didn’t pass verification and was deleted.',
    signature: 'The new version’s signature doesn’t match this app, so it wasn’t installed. Install it manually from the download page.',
    install: 'The installation couldn’t finish. Install it manually from the download page.',
    manual: 'This copy of BaoCut can’t replace itself. The downloaded file and the download page are open; install it manually.',
  } as Record<AppUpdateFailure, string>,
  version: (version: string, build: number) => `${version} (Build ${build})`,
  appStore: 'App Store versions are updated by the App Store',
  devBuild: 'Development builds don’t check for updates',
  checking: 'Checking…',
  upToDate: 'You’re up to date',
  checkForUpdates: 'Check for Updates',
  available: (version: string) => `New version ${version} available`,
  needsMacOS: (version: string) => `Requires macOS ${version}`,
  downloadAndInstall: 'Download and install',
  verifyingVersion: (version: string) => `Verifying ${version}…`,
  downloadingVersion: (version: string, pct: number) => `Downloading ${version} · ${pct}%`,
  cancel: 'Cancel',
  readyWaiting: (version: string) => `${version} downloaded; it will install when background tasks finish`,
  restartAndUpdate: 'Restart and update',
  stopWaiting: 'Don’t wait',
  readyOnQuit: (version: string) => `${version} downloaded; it will install automatically when you quit BaoCut`,
  installing: 'Installing…',
  retry: 'Try again',
  downloadPage: 'Go to download page',
  lastCheck: (when: string) => `Last checked: ${when}`,
  waitingRunning: (n: number) =>
    `${n === 1 ? '1 background task is' : `${n} background tasks are`} still running; the update installs automatically when ${n === 1 ? 'it finishes' : 'they all finish'}.`,
  waitingDone: 'Background tasks have finished. Installing…',
  tipAvailable: (version: string) => `New version · BaoCut ${version}`,
  tipVerifying: 'Verifying update…',
  tipDownloading: (pct: number) => `Downloading update · ${pct}%`,
  tipReady: 'Update downloaded · Installs when you quit',
  tipError: 'Update failed · Click to view',
  later: 'Later',
  verifying: 'Verifying…',
  downloading: (pct: number) => `Downloading · ${pct}%`,
  titleReady: 'Update downloaded',
  titleAvailable: 'New version available',
  current: (version: string) => `You’re using BaoCut ${version}.`,
  noteOnQuit: 'It will install automatically when you quit BaoCut; no need to restart now.',
  notesTitle: 'What’s new',
  readyToast: (version: string) => `BaoCut ${version} downloaded; it will install automatically when you quit`,
  availableToast: (version: string) => `BaoCut ${version} is ready to update`,
  view: 'View',
  restartTitle: 'Restart and update now?',
  restartBody: (n: number) =>
    `${n === 1 ? '1 background task is' : `${n} background tasks are`} running. Restarting will interrupt ${n === 1 ? 'it' : 'them'}; you can start ${n === 1 ? 'it' : 'them'} again afterward.`,
  remoteTitle: 'These run remotely. After stopping, they may keep running or incurring charges on the provider’s side:',
  stopAndInstall: 'Stop now and install',
  waitAndInstall: 'Install when tasks finish',
  autoRow: {
    label: 'Automatically check for and download updates',
    desc: 'Checks at launch and every 6 hours after that. Downloaded updates install the next time you quit, or you can restart to update right away. BaoCut never restarts on its own.',
  },
};
export type AppUpdateMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/*
 * 应用自动更新的界面模型（设计稿 model-app-update.js，§17.7）：设置 › 关于的状态块、rail 上的更新按钮、更新窗、toast、
 * 安装前的停止屏障（架构设计 §2.6）与设置 › 通用的开关。状态机在主进程（apps/desktop 的 app-update-rules.ts），
 * 这里只把镜像来的状态翻成要显示的东西。文案逐字照设计稿；时间由调用方传 `now`（unix 秒），这一层不读时钟。
 */

/** 关于页最多显示几行说明。 */
export const NOTES_MAX_LINES = 6;

/** 版本说明按界面语言取（`notesLocalized` 用 App 的语言码）。 */
export let NOTES_LANG: string = getLocale();
onLocaleChange((locale) => {
  NOTES_LANG = locale;
});

/**
 * 说明取哪种语言（与 App 的 `notes_for` 同口径）：精确码 → 同一主语言的别的码 → `en` → 不分语言的 `notes`。
 * 空白的说明当没有。
 */
export function notesText(info: Pick<AppUpdateInfo, 'notes' | 'notesLocalized'>, lang: string): string {
  const pick = (key: string) => {
    const text = info.notesLocalized[key];
    return text && text.trim() ? text : null;
  };
  const primary = lang.split('-')[0];
  const sibling = Object.entries(info.notesLocalized).find(([key, text]) => key.split('-')[0] === primary && text.trim())?.[1];
  return pick(lang) ?? sibling ?? pick('en') ?? info.notes;
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** 关于页的说明：最多 6 行，`more` 表示截掉了。 */
export function notesFor(info: AppUpdateInfo | null, lang: string): { lines: string[]; more: boolean } {
  if (!info) return { lines: [], more: false };
  const all = lines(notesText(info, lang));
  return { lines: all.slice(0, NOTES_MAX_LINES), more: all.length > NOTES_MAX_LINES };
}

/** 更新窗的全部说明（不截）；行首已有的列表记号剥掉，圆点由窗自己画。 */
export function notesAll(info: AppUpdateInfo | null, lang: string): string[] {
  if (!info) return [];
  return lines(notesText(info, lang))
    .map((line) => line.replace(/^[•\-*]\s*/u, ''))
    .filter(Boolean);
}

/** 「上次检查：…」的相对时间。 */
export function relTime(thenSec: number, nowSec: number): string {
  const d = Math.max(0, Math.floor(nowSec - thenSec));
  if (d < 60) return M.justNow;
  if (d < 3600) return M.minutesAgo(Math.floor(d / 60));
  if (d < 86400) return M.hoursAgo(Math.floor(d / 3600));
  return M.daysAgo(Math.floor(d / 86400));
}

/** 出错态的那句话：主进程只报类别，文案在界面这边（检查、校验两句照设计稿）。 */
export const FAILURE_TEXT: Record<AppUpdateFailure, string> = live(() => M.failure);

const verOf = (info: Pick<AppUpdateInfo, 'version' | 'build'>) => M.version(info.version, info.build);

/**
 * 界面上的动作：`later` 只关窗；`restart` 走停止屏障再安装；`retry` 按出错的是哪一步重查或重下；
 * `stopWaiting` 不再等后台任务结束。
 */
export type UpdateAction = 'check' | 'download' | 'cancel' | 'restart' | 'install' | 'retry' | 'downloadPage' | 'later' | 'stopWaiting';

export interface UpdateButton {
  k: UpdateAction;
  label: string;
  variant: 'accent' | 'secondary';
  disabled: boolean;
}

const btn = (k: UpdateAction, label: string, variant: UpdateButton['variant'] = 'secondary', disabled = false): UpdateButton => ({
  k,
  label,
  variant,
  disabled,
});

export interface StatusView {
  line: string | null;
  tone?: 'muted' | 'positive' | 'negative' | 'strong';
  notes?: { lines: string[]; more: boolean };
  /** 系统版本不够那一行（红）。 */
  warn?: string;
  progress?: number;
  actions: UpdateButton[];
  link?: { k: UpdateAction; label: string };
  sub?: string | null;
}

export interface ViewContext {
  lang: string;
  lastCheck: number | null;
  now: number;
  /** 在等后台任务结束后安装：还有几个在跑；没在等时 null。 */
  waiting?: number | null;
}

/** 下载到 100% 之后、进已下载之前的那一小段：校验（macOS 解开、核对签名与公证，架构设计 §2.6）。 */
export function verifying(st: AppUpdateState): boolean {
  return st.k === 'downloading' && st.pct >= 100;
}

/** 设置 › 关于的状态块：一行状态（含色调）、版本说明、进度、按钮与链接（设计稿 `view`）。 */
export function view(st: AppUpdateState, ctx: ViewContext): StatusView {
  switch (st.k) {
    case 'unsupported':
      return { line: st.why === 'appStore' ? M.appStore : M.devBuild, tone: 'muted', actions: [] };
    case 'checking':
      return { line: null, actions: [btn('check', M.checking, 'secondary', true)] };
    case 'upToDate':
      return { line: M.upToDate, tone: 'positive', actions: [btn('check', M.checkForUpdates)] };
    case 'available':
      return st.systemUnmet
        ? { line: M.available(verOf(st.info)), tone: 'strong', notes: notesFor(st.info, ctx.lang), warn: M.needsMacOS(st.systemUnmet), actions: [] }
        : { line: M.available(verOf(st.info)), tone: 'strong', notes: notesFor(st.info, ctx.lang), actions: [btn('download', M.downloadAndInstall, 'accent')] };
    case 'downloading':
      return {
        line: verifying(st) ? M.verifyingVersion(st.info.version) : M.downloadingVersion(st.info.version, st.pct),
        progress: st.pct,
        actions: [btn('cancel', M.cancel)],
      };
    case 'ready':
      return ctx.waiting != null
        ? {
            line: M.readyWaiting(st.info.version),
            tone: 'strong',
            actions: [btn('restart', M.restartAndUpdate, 'accent')],
            link: { k: 'stopWaiting', label: M.stopWaiting },
            sub: waitingText(ctx.waiting),
          }
        : { line: M.readyOnQuit(st.info.version), tone: 'strong', actions: [btn('restart', M.restartAndUpdate, 'accent')] };
    case 'installing':
      return { line: null, actions: [btn('install', M.installing, 'accent', true)] };
    case 'error':
      return { line: FAILURE_TEXT[st.failure], tone: 'negative', actions: [btn('retry', M.retry)], link: { k: 'downloadPage', label: M.downloadPage } };
    case 'idle':
      return {
        line: null,
        actions: [btn('check', M.checkForUpdates)],
        sub: ctx.lastCheck != null ? M.lastCheck(relTime(ctx.lastCheck, ctx.now)) : null,
      };
  }
}

function waitingText(running: number): string {
  return running > 0 ? M.waitingRunning(running) : M.waitingDone;
}

/** 出错态的「重试」重做哪一步：带着版本信息的是下载 / 校验 / 安装失败（重下），没有的是检查失败（重查）。 */
export function retryAction(st: AppUpdateState): 'download' | 'check' {
  return st.k === 'error' && st.info ? 'download' : 'check';
}

// ---- rail 上的更新按钮 ----

export type SideButton =
  | { visible: false }
  | { visible: true; glyph: 'download' | 'ring' | 'check'; pct?: number; dot: 'white' | 'positive' | 'negative' | null; tip: string };

const HIDDEN: SideButton = { visible: false };

/**
 * rail「设置」上方的 accent 方钮：只在有事可做时出现——有新版本（系统版本够）、下载中、已下载、带着版本信息的出错；
 * 系统版本不够、检查失败与其余各态都不显示（设计稿 `sideButton`）。
 */
export function sideButton(st: AppUpdateState): SideButton {
  switch (st.k) {
    case 'available':
      return st.systemUnmet ? HIDDEN : { visible: true, glyph: 'download', dot: 'white', tip: M.tipAvailable(st.info.version) };
    case 'downloading':
      return { visible: true, glyph: 'ring', pct: st.pct, dot: null, tip: verifying(st) ? M.tipVerifying : M.tipDownloading(st.pct) };
    case 'ready':
      return { visible: true, glyph: 'check', dot: 'positive', tip: M.tipReady };
    case 'error':
      return st.info ? { visible: true, glyph: 'download', dot: 'negative', tip: M.tipError } : HIDDEN;
    default:
      return HIDDEN;
  }
}

// ---- 更新窗 ----

export interface DialogView {
  title: string;
  sub: string;
  current: string | null;
  /** 已下载、没在等后台任务时多一句：退出时也会装。 */
  note: string | null;
  notesTitle: string;
  notes: string[];
  footer: {
    left: null | { progress: number; text: string } | { error: string } | { note: string };
    buttons: { k: UpdateAction; label: string; variant: 'accent' | 'secondary' }[];
  };
}

/**
 * 更新窗（宽 480）：侧栏按钮不该显示的态一律返回 null——视图拿 null 当「窗自动关」（设计稿 `dialog`）。
 * `current` 是正在运行的版本；`waiting` 同 `view`。已下载时多一句 `note`（退出时也会装），在等后台任务时不写——
 * 它和底栏「都结束后自动安装」挨着读像两套说法；下载到 100% 的校验段，
 * 底栏左侧写「正在校验…」。
 */
export function dialog(
  st: AppUpdateState,
  ctx: { lang: string; current: { version: string; build: number } | null; waiting?: number | null },
): DialogView | null {
  if (!sideButton(st).visible) return null;
  if (st.k !== 'available' && st.k !== 'downloading' && st.k !== 'ready' && st.k !== 'error') return null;
  const info = st.info;
  if (!info) return null;
  const b = (k: UpdateAction, label: string, variant: 'accent' | 'secondary' = 'secondary') => ({ k, label, variant });
  const later = b('later', M.later);
  const footer: DialogView['footer'] =
    st.k === 'available'
      ? { left: null, buttons: [later, b('download', M.downloadAndInstall, 'accent')] }
      : st.k === 'downloading'
        ? { left: { progress: st.pct, text: verifying(st) ? M.verifying : M.downloading(st.pct) }, buttons: [b('cancel', M.cancel)] }
        : st.k === 'ready'
          ? ctx.waiting != null
            ? { left: { note: waitingText(ctx.waiting) }, buttons: [b('stopWaiting', M.stopWaiting), b('restart', M.restartAndUpdate, 'accent')] }
            : { left: null, buttons: [later, b('restart', M.restartAndUpdate, 'accent')] }
          : { left: { error: FAILURE_TEXT[st.failure] }, buttons: [b('downloadPage', M.downloadPage), b('retry', M.retry, 'accent')] };
  return {
    title: st.k === 'ready' ? M.titleReady : M.titleAvailable,
    sub: `BaoCut ${info.version} · Build ${info.build}`,
    current: ctx.current ? M.current(verOf(ctx.current)) : null,
    note: st.k === 'ready' && ctx.waiting == null ? M.noteOnQuit : null,
    notesTitle: M.notesTitle,
    notes: notesAll(info, ctx.lang),
    footer,
  };
}

// ---- toast ----

/** 自动检查后台下载好了（每个 build 只弹一次由主进程把关）。 */
export function readyToast(info: AppUpdateInfo): { text: string; action: string } {
  return { text: M.readyToast(info.version), action: M.restartAndUpdate };
}

/** 自动下载关着时，自动检查发现了新版本。「查看」打开更新窗。 */
export function availableToast(info: AppUpdateInfo): { text: string; action: string } {
  return { text: M.availableToast(info.version), action: M.view };
}

// ---- 安装前的停止屏障（架构设计 §2.6） ----

export interface BarrierTask {
  id: string;
  title: string;
  /** 模型 · 跑在哪。 */
  where: string;
  /** 跑在远端节点或云端：停了之后那边可能还在跑、还在计费。 */
  remote: boolean;
  /** 怎么停；正在停止的 Agent 任务没有（等它自己停完）。 */
  action: TaskAction | null;
}

/** 本机之外跑的 Job：远端节点与云端服务商（本机与本机上的智能体 Provider 不算）。 */
export function runsRemotely(providerId: string): boolean {
  return providerId !== 'local' && !providerId.startsWith('agent:');
}

/** 还在跑的后台任务：Agent 任务（运行中、正在停止）与 Job（排队、运行、崩溃后正在重跑）。 */
export function barrierTasks(jobs: readonly JobRecord[], tasks: readonly TaskSummary[], jobLive: (job: JobRecord) => boolean): BarrierTask[] {
  const ctx = { projects: [], conversations: [], video: null };
  const fromTasks = tasks
    .filter((task) => task.status === 'running' || task.status === 'stopping')
    .map(
      (task): BarrierTask => ({
        id: task.taskId,
        title: task.goal,
        where: TASK_VIEW_COPY.local,
        remote: false,
        action: task.status === 'running' ? { type: 'stop', taskId: task.taskId } : null,
      }),
    );
  const fromJobs = jobs.filter(jobLive).map((job): BarrierTask => {
    const row = jobRow(job, ctx);
    return { id: job.jobId, title: row.title, where: row.where, remote: runsRemotely(job.providerId), action: { type: 'cancel', jobId: job.jobId } };
  });
  return [...fromTasks, ...fromJobs];
}

export interface RestartAsk {
  title: string;
  body: string;
  /** 远端在跑、停了也可能继续跑或计费的任务；没有时 null。 */
  remoteTitle: string | null;
  remote: { id: string; title: string; where: string }[];
  stopLabel: string;
  waitLabel: string;
  cancelLabel: string;
}

/**
 * 点「重启并更新」：有后台任务在跑先问（设计稿 `restartAsk` 的标题与正文），让用户选「等任务结束后安装」或
 * 「现在停止并安装」，并列出停了之后仍可能在远端运行或计费的任务；没有任务在跑时返回 null，直接安装。
 */
export function restartAsk(tasks: readonly BarrierTask[]): RestartAsk | null {
  const n = tasks.length;
  if (!n) return null;
  const remote = tasks.filter((task) => task.remote).map(({ id, title, where }) => ({ id, title, where }));
  return {
    title: M.restartTitle,
    body: M.restartBody(n),
    remoteTitle: remote.length ? M.remoteTitle : null,
    remote,
    stopLabel: M.stopAndInstall,
    waitLabel: M.waitAndInstall,
    cancelLabel: M.later,
  };
}

// ---- 设置 › 通用的开关（`updates.autoCheck`、`updates.autoDownload`） ----

export const AUTO_ROW: AppUpdateMessages['autoRow'] = live(() => M.autoRow);

/**
 * 开关拨动时写哪些键（与 App 的 `app_auto_update` 同语义）：打开时两个都开；关上只关自动下载——照样按节奏检查，
 * 发现新版本时提醒「可以更新了」，不在后台下载。
 */
export function autoUpdatePatch(on: boolean): { 'updates.autoCheck'?: boolean; 'updates.autoDownload': boolean } {
  return on ? { 'updates.autoCheck': true, 'updates.autoDownload': true } : { 'updates.autoDownload': false };
}
