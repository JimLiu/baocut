import {
  defineMessages,
  type Id,
  type LegacyImportItem,
  type LegacyImportProblem,
  type LegacyImportRun,
} from '@baocut/protocol';
import { TASK_VIEW_COPY } from '../copy.ts';
import { displayDirectory } from './legacy-import.ts';
import { kindLabel, type TaskRow } from './task-list.ts';
import { zhHans } from './legacy-import-run.zh-Hans.ts';
import { zhHant } from './legacy-import-run.zh-Hant.ts';
import { ja } from './legacy-import-run.ja.ts';
import { ko } from './legacy-import-run.ko.ts';
import { es } from './legacy-import-run.es.ts';
import { fr } from './legacy-import-run.fr.ts';
import { de } from './legacy-import-run.de.ts';
import { nl } from './legacy-import-run.nl.ts';
import { ptBR } from './legacy-import-run.pt-BR.ts';
import { it } from './legacy-import-run.it.ts';
import { ru } from './legacy-import-run.ru.ts';
import { pl } from './legacy-import-run.pl.ts';
import { tr } from './legacy-import-run.tr.ts';
import { vi } from './legacy-import-run.vi.ts';

/*
 * 旧版项目导入的进度与结果（设计稿 model-legacy-import-run.js；架构设计 §2.7）。纯函数：读 Runtime 推来的
 * `LegacyImportRun`，算出任务页那一行、卡片上的原因与怎么办、详情的分组、Home 顶上那一条与跑完的 toast。
 * 没导入的按原因分组：每块没接上的硬盘一组、文件不在原处一组、项目读不出来一组、导入中途出错一组，
 * 每组带一句原因（why）和一句怎么办（fix），视图不另写。
 */

const en = {
  offlineTitle: (name: string) => `Drive “${name}” isn’t connected`,
  offlineWhy: (n: number, root: string) =>
    n === 1
      ? `The videos this project uses are on this drive (${root}), which can’t be read right now.`
      : `The videos these ${n} projects use are on this drive (${root}), which can’t be read right now.`,
  offlineFix:
    'Connect the drive, then click “Retry”. If you leave it, BaoCut tries again the next time it starts. If you no longer need the footage, click “Skip” and it won’t be imported.',
  offlineShort: (n: number, name: string) =>
    n === 1 ? `1 project’s footage is on “${name}”, which isn’t connected` : `${n} projects’ footage is on “${name}”, which isn’t connected`,
  missingTitle: 'Media files aren’t where they were',
  missingWhy: 'Files the project uses were moved, renamed or deleted, so the paths saved in the earlier project no longer find them.',
  missingFix: 'Put the files back where they were, then click “Retry”. If you can’t get them back, click “Skip”.',
  missingShort: (n: number) => (n === 1 ? '1 project’s media files can’t be found' : `${n} projects’ media files can’t be found`),
  unreadableTitle: 'The earlier project file can’t be read',
  unreadableWhy: 'The earlier project file may be damaged, so retrying probably won’t help.',
  unreadableFix:
    'Show it in the folder to check that the original is still there and opens in the earlier version. If you don’t need it, click “Skip”.',
  unreadableShort: (n: number) => (n === 1 ? '1 project file can’t be read' : `${n} project files can’t be read`),
  failedTitle: 'Importing stopped partway',
  failedWhy: 'The project was read, but importing it stopped partway. The import report records what happened.',
  failedFix: 'Click “Retry” to try again. If it still fails, show the report in the folder. If you don’t need the project, click “Skip”.',
  failedShort: (n: number) => (n === 1 ? '1 project stopped partway through importing' : `${n} projects stopped partway through importing`),
  missingMany: (n: number, first: string) => `${n} files missing, for example ${first}`,
  missingOne: (file: string) => `Missing ${file}`,
  missingNone: 'Media files can’t be found',
  failedReport: (report: string) => `Import report: ${report}`,
  failedNoReport: 'No import report was written',
  /** 卡片上那一句：几组的短句连起来。 */
  note: (parts: string[]) => `${parts.join('; ')}.`,
  hintOffline: (name: string) =>
    `Connect “${name}”, then click “Retry all”. If you leave it, BaoCut tries again the next time it starts. To handle them one by one, open the details.`,
  hintOther: 'The reason and what to do for each one are in the details. You can skip the ones you don’t need.',
  subProgress: (done: number, total: number) => `Imported ${done}/${total}`,
  subImported: (n: number) => `Imported ${n}`,
  subPending: (n: number) => `To resolve ${n}`,
  subSkipped: (n: number) => `Skipped ${n}`,
  subDest: (dest: string) => `To ${dest}`,
  attention: (n: number) => `${n} to resolve`,
  phaseImporting: 'Importing',
  phaseWaiting: 'Waiting for other tasks',
  detailImporting: (title: string) => `Importing “${title}”`,
  detailWaiting: 'Other tasks are running, so importing is paused. It continues automatically when they finish.',
  bannerRunning: (done: number, total: number) => `Importing earlier projects · ${done}/${total}`,
  bannerResult: (imported: number, pending: number) => `Earlier projects import finished: ${imported} imported, ${pending} not imported`,
  doneAll: (n: number) => (n === 1 ? '1 earlier project imported' : `${n} earlier projects imported`),
  doneSome: (imported: number, pending: number) => `Import finished: ${imported} imported, ${pending} not imported`,
  retriedAll: (n: number) => (n === 1 ? 'The retried project was imported' : `All ${n} retried projects were imported`),
  retriedSome: (n: number, ok: number) => `Of the ${n} retried, ${ok} imported and ${n - ok} still not imported`,
  retriedNone: (n: number) => (n === 1 ? 'The retried project still wasn’t imported' : `The ${n} retried projects still weren’t imported`),
  retrying: (n: number) => (n === 1 ? 'Importing 1 project again' : `Importing ${n} projects again`),
  skipped: (n: number) =>
    n === 1 ? 'Skipped 1 project. It won’t be imported automatically.' : `Skipped ${n} projects. They won’t be imported automatically.`,
  actionFailed: (message: string) => `Couldn’t do that: ${message}`,
  undo: 'Undo',
  viewReasons: 'See why',
  viewInSpace: 'View in Space',
  viewProgress: 'View progress',
  close: 'Close',
  retryAll: 'Retry all',
  skipAll: 'Skip all',
  retry: 'Retry',
  skip: 'Skip',
  reveal: 'Show in folder',
  importInstead: 'Import',
  statImported: 'Imported',
  statPending: 'Not imported',
  statSkipped: 'Skipped',
  statLive: 'Not imported yet',
  pendingSection: 'Projects not imported',
  pendingHint: 'If you leave them, BaoCut tries again the next time it starts. Skipped ones aren’t imported.',
  howTo: 'What to do: ',
  groupTitle: (title: string, n: number) => `${title} · ${n}`,
  liveSection: 'Importing',
  importingChip: 'Importing',
  queuedChip: 'Queued',
  importedSection: 'Imported',
  skippedSection: 'Skipped',
  skippedHint: 'They won’t be imported automatically. The original files stay where they are.',
  expand: (n: number) => `Show ${n} more`,
  collapse: 'Show less',
};

export type LegacyImportRunMessages = typeof en;

export const LR = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 任务页里这条导入的 ID：一次启动一条，跟着 Runtime 给的 `runId`。 */
export const LEGACY_TASK_PREFIX = 'legacy-import:';
export const legacyTaskId = (runId: string): Id => `${LEGACY_TASK_PREFIX}${runId}`;

export interface RunCounts {
  imported: number;
  /** 没导入、等用户处理的（不含跳过的）。 */
  pending: number;
  skipped: number;
  queued: number;
  importing: number;
  /** 还没轮到或正在导入的。 */
  live: number;
  /** 这一轮要导入的：已导入、没导入与还在跑的（跳过的不算）。 */
  total: number;
}

export function runCounts(run: Pick<LegacyImportRun, 'items'> | null): RunCounts {
  const items = run?.items ?? [];
  const n = (state: LegacyImportItem['state']) => items.filter((it) => it.state === state).length;
  const c = { imported: n('imported'), pending: n('not-imported'), skipped: n('skipped'), queued: n('queued'), importing: n('importing') };
  const live = c.queued + c.importing;
  return { ...c, live, total: c.imported + c.pending + live };
}

/** 还在导入（含等其他任务）。 */
export const runLive = (run: Pick<LegacyImportRun, 'state'> | null): boolean => !!run && run.state !== 'finished';

export const currentItem = (run: LegacyImportRun | null): LegacyImportItem | null =>
  run?.items.find((it) => it.state === 'importing') ?? null;

/** 0–100，向下取整：没做完不念 100%。 */
export function runPercent(run: LegacyImportRun): number {
  const c = runCounts(run);
  if (!c.total) return runLive(run) ? 0 : 100;
  return Math.floor(((c.total - c.live) / c.total) * 100);
}

export type ProblemKind = LegacyImportProblem['kind'];

export interface ProblemGroup {
  key: string;
  kind: ProblemKind;
  /** 没接上的硬盘（`offline` 才有）。 */
  volume: { root: string; name: string } | null;
  items: LegacyImportItem[];
  title: string;
  why: string;
  fix: string;
  /** 卡片上那一句里的一段。 */
  short: string;
}

const RANK: Record<ProblemKind, number> = { offline: 0, missing: 1, unreadable: 2, failed: 3 };

function groupText(kind: ProblemKind, n: number, volume: ProblemGroup['volume']): Pick<ProblemGroup, 'title' | 'why' | 'fix' | 'short'> {
  if (kind === 'offline' && volume) {
    return {
      title: LR.offlineTitle(volume.name),
      why: LR.offlineWhy(n, volume.root),
      fix: LR.offlineFix,
      short: LR.offlineShort(n, volume.name),
    };
  }
  if (kind === 'missing' || kind === 'offline') {
    return { title: LR.missingTitle, why: LR.missingWhy, fix: LR.missingFix, short: LR.missingShort(n) };
  }
  if (kind === 'unreadable') {
    return { title: LR.unreadableTitle, why: LR.unreadableWhy, fix: LR.unreadableFix, short: LR.unreadableShort(n) };
  }
  return { title: LR.failedTitle, why: LR.failedWhy, fix: LR.failedFix, short: LR.failedShort(n) };
}

/** 没导入的按原因分组：每块没接上的硬盘一组，其余按原因各一组；顺序是硬盘、文件不在、读不出来、中途出错。 */
export function problemGroups(run: LegacyImportRun | null): ProblemGroup[] {
  const out: Omit<ProblemGroup, 'title' | 'why' | 'fix' | 'short'>[] = [];
  for (const item of run?.items ?? []) {
    if (item.state !== 'not-imported' || !item.problem) continue;
    const p = item.problem;
    const key = p.kind === 'offline' ? `offline:${p.volume.root}` : p.kind;
    let group = out.find((g) => g.key === key);
    if (!group) {
      group = { key, kind: p.kind, volume: p.kind === 'offline' ? p.volume : null, items: [] };
      out.push(group);
    }
    group.items.push(item);
  }
  return out
    .sort((a, b) => RANK[a.kind] - RANK[b.kind])
    .map((g) => ({ ...g, ...groupText(g.kind, g.items.length, g.volume) }));
}

/** 一行没导入的项目下面那句：缺几个文件、第一个缺的路径；读不出来的写旧项目在哪；中途出错的写导入记录在哪。 */
export function itemNote(item: LegacyImportItem): string {
  const p = item.problem;
  if (!p || p.kind === 'unreadable') return item.path;
  if (p.kind === 'failed') return p.report ? LR.failedReport(p.report) : LR.failedNoReport;
  const first = p.missing[0];
  if (!first) return LR.missingNone;
  return p.missingCount > 1 ? LR.missingMany(p.missingCount, first) : LR.missingOne(first);
}

/** 「在文件夹中显示」显示哪个：中途出错的显示导入记录，读不出来的显示旧项目；缺素材的不给（要处理的是素材）。 */
export function revealTarget(item: LegacyImportItem): string | null {
  const p = item.problem;
  if (p?.kind === 'failed') return p.report ?? item.path;
  if (p?.kind === 'unreadable') return item.path;
  return null;
}

/** 任务页卡片上的一句原因：`2 个项目的素材在没接上的「Extreme SSD」上，1 个项目的文件读不出来。` */
export function cardNote(run: LegacyImportRun | null): string {
  const groups = problemGroups(run);
  return groups.length ? LR.note(groups.map((g) => g.short)) : '';
}

/** 卡片上紧跟原因的那句怎么办：有没接上的硬盘就先说接上它；其余的去详情逐个看。 */
export function cardHint(run: LegacyImportRun | null): string {
  const groups = problemGroups(run);
  if (!groups.length) return '';
  const drive = groups.find((g) => g.volume);
  return drive?.volume ? LR.hintOffline(drive.volume.name) : LR.hintOther;
}

/** 卡片副行：在跑时「已导入 d/t · 导入到 …」，跑完「已导入 d · 待处理 p · 已跳过 s · 导入到 …」。 */
export function runSub(run: LegacyImportRun, platform: string): string {
  const c = runCounts(run);
  const dest = LR.subDest(displayDirectory(run.directory, platform));
  if (runLive(run)) return [LR.subProgress(c.imported, c.total), dest].join(' · ');
  return [
    LR.subImported(c.imported),
    c.pending ? LR.subPending(c.pending) : null,
    c.skipped ? LR.subSkipped(c.skipped) : null,
    dest,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 在跑时的阶段与那一句细节：等其他任务，或正在导入哪个。 */
export function runPhase(run: LegacyImportRun): { phase: string; detail: string | null } {
  if (run.state === 'waiting') return { phase: LR.phaseWaiting, detail: LR.detailWaiting };
  const now = currentItem(run);
  return { phase: LR.phaseImporting, detail: now ? LR.detailImporting(now.title) : null };
}

/**
 * 任务页、侧栏共用的那一行。在跑归「进行中」；跑完归历史，留了没导入的念「N 个待处理」、用提醒色。
 * 不能取消（Runtime 的导入不能中途停），不进视频顶栏的任务胶囊（它不属于哪部视频）。
 */
export function legacyTaskRow(run: LegacyImportRun, platform: string): TaskRow {
  const c = runCounts(run);
  const live = runLive(run);
  const pct = runPercent(run);
  const phase = live ? runPhase(run).phase : null;
  const label = live ? `${phase} · ${pct}%` : c.pending ? LR.attention(c.pending) : TASK_VIEW_COPY.completed;
  return {
    id: legacyTaskId(run.runId),
    origin: 'legacy-import',
    kind: 'legacyImport',
    kindText: kindLabel('legacyImport'),
    title: kindLabel('legacyImport'),
    where: runSub(run, platform),
    startedAt: run.startedAt,
    endedAt: run.finishedAt,
    live,
    queued: false,
    waiting: false,
    label,
    tone: live ? 'accent' : c.pending ? 'notice' : 'positive',
    phase,
    pct: live ? pct : null,
    progress: live ? pct : null,
    chip: null,
    action: null,
    conversationId: null,
    projectId: null,
    videoId: null,
    error: null,
  };
}

export interface RunBanner {
  state: 'running' | 'result';
  title: string;
  detail: string;
  pct: number | null;
  /** 关掉的是哪一次结果：再有新的结果会再出来。 */
  key: string;
}

/**
 * Home 顶上那一条（导入是全局的事，不属于哪部视频）：在跑时报进度与正在导入哪个；跑完留了没导入的报结果与原因；
 * 都导入了不出（toast 已经说过）。
 */
export function runBanner(run: LegacyImportRun | null, platform: string): RunBanner | null {
  if (!run) return null;
  const c = runCounts(run);
  if (runLive(run)) {
    const { detail } = runPhase(run);
    const dest = LR.subDest(displayDirectory(run.directory, platform));
    return {
      state: 'running',
      title: LR.bannerRunning(c.total - c.live, c.total),
      detail: run.state === 'waiting' ? LR.detailWaiting : [detail, dest].filter(Boolean).join(' · '),
      pct: runPercent(run),
      key: `${run.runId}:live`,
    };
  }
  if (!c.pending) return null;
  return {
    state: 'result',
    title: LR.bannerResult(c.imported, c.pending),
    detail: cardNote(run),
    pct: null,
    key: `${run.runId}:${run.finishedAt ?? ''}`,
  };
}

export interface FinishToast {
  text: string;
  tone: 'positive' | 'neutral';
  /** `result` 去任务详情看原因；`open` 去 Space 看导入的项目。 */
  action: 'result' | 'open';
}

/**
 * 一次导入（或一次重试）跑完时的 toast。`batch` 是这一轮导入过的项目（界面看着它们排队、导入）；
 * 覆盖了整次导入（不算跳过的）就报整体，否则是重试，只报重试的那几个。
 */
export function finishToast(run: LegacyImportRun, batch: ReadonlySet<string> | null): FinishToast {
  const scope = run.items.filter((it) => it.state !== 'skipped');
  const retried = batch && scope.some((it) => !batch.has(it.path)) ? run.items.filter((it) => batch.has(it.path)) : null;
  if (retried?.length) {
    const n = retried.length;
    const ok = retried.filter((it) => it.state === 'imported').length;
    if (ok === n) return { text: LR.retriedAll(n), tone: 'positive', action: 'open' };
    return { text: ok ? LR.retriedSome(n, ok) : LR.retriedNone(n), tone: 'neutral', action: 'result' };
  }
  const c = runCounts(run);
  if (!c.pending) return { text: LR.doneAll(c.imported), tone: 'positive', action: 'open' };
  return { text: LR.doneSome(c.imported, c.pending), tone: 'neutral', action: 'result' };
}

/** 点到的、还没导入的项目（`paths` 缺省 = 全部没导入的）：重试与跳过按它数。 */
export function pendingPaths(run: LegacyImportRun | null, paths?: readonly string[]): string[] {
  return (run?.items ?? [])
    .filter((it) => it.state === 'not-imported' && (!paths || paths.includes(it.path)))
    .map((it) => it.path);
}
