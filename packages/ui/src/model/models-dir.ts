import { live, type Id, type JobRecord, type ModelBundleStatus, type ModelsDirInfo, type ModelsDirInspection, type ModelsDirMode } from '@baocut/protocol';
import { shortenPath } from './format.ts';
import { fmtSize } from './task-facts.ts';
import { M, type ModelsDirMessages } from './models-dir-copy.ts';

/**
 * 设置 › 本地模型 › 模型目录（架构设计 §6.3；设计稿 model-models-dir.js、settings-models-dir.jsx）。
 * 只放判断与文字：长路径的中间省略、卡片副题、哪些任务让更改暂时不可用、更改确认框的分支、移动进度。
 * 数字都来自 Runtime（`models.getDir`、`models.inspectDir`），这里不碰文件系统。
 */

export const MODELS_DIR_COPY: ModelsDirMessages['dir'] = live(() => M.dir);

/**
 * 长路径中间省略：主目录缩成 ~，保留开头至多两段与结尾至多两段，装不下再减；永远不省掉最后一段。
 * 分隔符跟着路径走：只用 `\` 的（Windows）照样用 `\` 拼回去，盘符（`D:`）与 `~` 算开头的一段。
 */
export function shortenDir(full: string, max = 44): string {
  const path = shortenPath(full);
  if (path.length <= max) return path;
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  // 开头的分隔符原样保留：`/` 是根，`\\` 是网络路径。
  const lead = /^[\\/]*/.exec(path)![0];
  const segs = path.split(/[\\/]/).filter((s) => s !== '');
  for (let head = Math.min(2, segs.length - 1); head >= 0; head -= 1) {
    for (let tail = Math.min(2, segs.length - head); tail >= 1; tail -= 1) {
      if (head + tail >= segs.length) continue;
      const s = `${lead}${segs.slice(0, head).join(sep)}${head ? sep : ''}…${sep}${segs.slice(segs.length - tail).join(sep)}`;
      if (s.length <= max) return s;
    }
  }
  const last = segs[segs.length - 1] ?? '';
  return `…${sep}${last.length > max - 2 ? `${last.slice(0, max - 3)}…` : last}`;
}

/** 卡片副题：已用 · 所在磁盘可用 · 已识别 N 个模型（可用空间查不到时不写）。 */
export function dirStats(info: ModelsDirInfo): string {
  return M.stats(fmtSize(info.usedBytes), info.freeBytes !== null ? fmtSize(info.freeBytes) : null, info.modelCount);
}

/** 目录本身的问题（外置盘没接上、不能写）；没有时 null。 */
export function dirHealth(info: ModelsDirInfo): string | null {
  if (!info.exists) return MODELS_DIR_COPY.missingDir;
  if (!info.writable) return MODELS_DIR_COPY.notWritableDir;
  return null;
}

const LIVE: readonly JobRecord['state'][] = ['queued', 'running'];
const DIR_KINDS: readonly JobRecord['kind'][] = ['modelInstall', 'modelTest'];

export interface DirBlocker {
  text: string;
  /** 在用本地模型的普通任务（不含下载与检查）。 */
  jobIds: Id[];
  /** 有普通任务时给「查看任务」。 */
  hasTasks: boolean;
}

/**
 * 现在能不能更改：排队或进行中的下载、检查，以及带模型包的任务（转写、合成…）都会让 Runtime 拒绝。
 * 移动本身由进度条表达，不算在这里。没有时 null。
 */
export function dirBlocker(jobs: readonly JobRecord[], bundles: readonly ModelBundleStatus[]): DirBlocker | null {
  const name = (bundleId: string | null | undefined) => bundles.find((b) => b.bundleId === bundleId)?.label ?? bundleId ?? '';
  const live = jobs.filter((j) => LIVE.includes(j.state) && j.kind !== 'modelsMove');
  const downloading = live.filter((j) => j.kind === 'modelInstall').map((j) => name(j.bundleId));
  const testing = live.filter((j) => j.kind === 'modelTest').map((j) => name(j.bundleId));
  const tasks = live.filter((j) => !DIR_KINDS.includes(j.kind) && j.bundleId);
  if (!downloading.length && !testing.length && !tasks.length) return null;
  return {
    text: M.blocker(unique(downloading), unique(testing), tasks.length),
    jobIds: tasks.map((j) => j.jobId),
    hasTasks: tasks.length > 0,
  };
}

const unique = (list: string[]) => [...new Set(list)];

export type ChangePlan =
  /** 选定的文件夹不能用。 */
  | { kind: 'error'; title: string; text: string }
  /** 已经是当前目录。 */
  | { kind: 'same' }
  /** 当前目录里没有模型：只说明新位置里有什么，直接切换。 */
  | { kind: 'direct'; found: string }
  /** 当前目录里有模型：移过去，或只切换位置。 */
  | { kind: 'choose'; found: string; move: { disabled: boolean; description: string }; switchDescription: string };

/** 更改确认框的分支（`models.inspectDir` 的结果 → 几句话）。 */
export function changePlan(inspection: ModelsDirInspection): ChangePlan {
  switch (inspection.problem) {
    case 'same':
      return { kind: 'same' };
    case 'missing':
      return { kind: 'error', title: M.missingTitle, text: M.missingText };
    case 'not-writable':
      return { kind: 'error', title: M.notWritableTitle, text: M.notWritableText };
    case 'nested':
      return { kind: 'error', title: M.nestedTitle, text: M.nestedText };
    default:
      break;
  }
  const count = inspection.found.bundleIds.length;
  const found = M.found(count, fmtSize(inspection.found.bytes), inspection.freeBytes !== null ? fmtSize(inspection.freeBytes) : null);
  if (inspection.current.bytes <= 0) return { kind: 'direct', found };
  const { requiredBytes, sameVolume, fits } = inspection.move;
  const short = inspection.freeBytes !== null ? Math.max(0, requiredBytes - inspection.freeBytes) : 0;
  const description = !fits
    ? M.moveNoFit(fmtSize(requiredBytes), fmtSize(inspection.freeBytes ?? 0), fmtSize(short))
    : sameVolume
      ? M.moveSameVolume(fmtSize(inspection.current.bytes))
      : M.moveOther(fmtSize(requiredBytes || inspection.current.bytes));
  return {
    kind: 'choose',
    found,
    move: { disabled: !fits, description },
    switchDescription: M.switchDescription(count),
  };
}

/** 确认框里选中的方式：放不下时「移过去」不可选，落到「只切换位置」；不用选时是 switch。 */
export function pickedMode(plan: ChangePlan, chosen: ModelsDirMode): ModelsDirMode {
  if (plan.kind !== 'choose') return 'switch';
  return plan.move.disabled ? 'switch' : chosen;
}

/** 更改之后的提示。 */
export function appliedText(mode: ModelsDirMode, path: string, hadModels: boolean, moving: boolean): string {
  const where = shortenDir(path, 40);
  if (moving) return M.appliedMoving(where);
  if (mode === 'switch' && hadModels) return M.appliedKept(where);
  return M.applied(where);
}

export interface MoveProgressView {
  /** 0–100；还不知道总量时 null（进度条不确定）。 */
  percent: number | null;
  label: string;
}

/** 移动任务的进度（`modelsMove`，`progress.unit: 'bytes'`）。 */
export function moveProgressView(job: JobRecord | undefined, to: string | null): MoveProgressView {
  const where = to ? shortenDir(to, 36) : null;
  const progress = job?.progress;
  const total = progress?.total ?? null;
  const done = progress?.done ?? 0;
  const percent = total !== null && total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : null;
  const amount = total ? `${fmtSize(done)} / ${fmtSize(total)}` : null;
  if (!job || job.state === 'queued') return { percent: null, label: M.moveWaiting(where) };
  if (job.phase === 'validating') return { percent, label: M.moveValidating(amount) };
  if (job.phase === 'publishing') return { percent: null, label: M.movePublishing };
  return { percent, label: M.moving(amount, where) };
}
