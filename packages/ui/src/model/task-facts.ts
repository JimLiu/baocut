import {
  defineMessages,
  type CapabilityNotConfiguredDetails,
  type GeneratedOutput,
  type JobCancellation,
  type JobKind,
  type JobRecord,
  type ModelServiceCapability,
  type TaskSummary,
} from '@baocut/protocol';
import { TASK_VIEW_COPY } from '../copy.ts';
import type { ModelCategory, ModelPage } from './settings-nav.ts';
import { runsOnLabel, type TaskRow } from './task-list.ts';
import { agoLabel, formatClock } from './format.ts';
import { zhHans } from './task-facts.zh-Hans.ts';
import { zhHant } from './task-facts.zh-Hant.ts';
import { ja } from './task-facts.ja.ts';
import { ko } from './task-facts.ko.ts';
import { es } from './task-facts.es.ts';
import { fr } from './task-facts.fr.ts';
import { de } from './task-facts.de.ts';
import { nl } from './task-facts.nl.ts';
import { ptBR } from './task-facts.pt-BR.ts';
import { it } from './task-facts.it.ts';
import { ru } from './task-facts.ru.ts';
import { pl } from './task-facts.pl.ts';
import { tr } from './task-facts.tr.ts';
import { vi } from './task-facts.vi.ts';
import { remedyHintText } from './localized-text.ts';

/** 「详情」表的行名与生图请求那一行（译文在 `task-facts.<语言>.ts`）。 */
const en = {
  fact: {
    kind: 'Type',
    submitter: 'Started by',
    status: 'Status',
    startedAt: 'Started',
    runsOn: 'Runs on',
    language: 'Language',
    phase: 'Phase',
    images: 'Images',
    took: 'Time taken',
    cost: 'Cost',
  },
  imageCount: (count: number) => `${count} ${count === 1 ? 'image' : 'images'}`,
};
export type TaskFactsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 任务详情的事实（原型 model-task-facts.js）：「详情」表、错误卡片的补救去处、产物行。
 * 只产出真有数据的行，缺席不写占位；原型里没有后端的（费用、调用记录、行数、帧与速度、预计剩余）不出。
 */

/** `42s` / `12m 40s` / `1h 5m`（原型 `took`）。 */
export function took(ms: number): string {
  const seconds = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** `612 MB` / `1.5 GB` / `500 KB`，1024 进位（原型 `fmtSize`）。 */
export function fmtSize(bytes: number): string {
  const mb = (bytes || 0) / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${Math.round(mb)} MB`;
  return `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`;
}

export type FactRow = [label: string, value: string];

/** `12 s`；满一分钟起同 `took`（原型 `secs`）。 */
export function secs(ms: number): string {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return s < 60 ? `${s} s` : took(ms);
}

/**
 * 「详情」表的状态格（原型 `statusLabel`）：在跑的念「进行中」，阶段与百分比在进度条与「阶段」一格；
 * 等批准、正在停止与结束了的照 chip 念。
 */
function factStatus(row: TaskRow): string {
  if (row.queued) return TASK_VIEW_COPY.queued;
  if (row.waiting) return row.label;
  // 可以停或取消的在跑的；正在停止的没有动作可做，照 chip 念「正在停止」。
  if (row.live && row.action) return TASK_VIEW_COPY.running;
  return row.label;
}

function submitterLabel(job: JobRecord): string {
  switch (job.submitter.kind) {
    case 'agent':
      return TASK_VIEW_COPY.byAgent;
    case 'connection':
      return TASK_VIEW_COPY.byCli;
    case 'node':
      return TASK_VIEW_COPY.byNode;
    default:
      return TASK_VIEW_COPY.byApp;
  }
}

/**
 * 「详情」行 `[label, value]`（原型 `details`）：类型、发起方、状态、开始于、跑在、语言、阶段、图片、用时。
 * 用时：结束了按结束时间算，还在跑的按 `now` 现算，还在排队的不写。
 */
export function taskFacts(row: TaskRow, source: { job?: JobRecord; task?: TaskSummary }, now: number): FactRow[] {
  const rows: FactRow[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value != null && value !== '') rows.push([label, value]);
  };
  const job = source.job;
  const F = M.fact;
  add(F.kind, row.kindText);
  add(F.submitter, job ? submitterLabel(job) : TASK_VIEW_COPY.byAgent);
  add(F.status, factStatus(row));
  add(F.startedAt, agoLabel(row.startedAt, now));
  if (job) {
    add(F.runsOn, runsOnLabel(job.providerId));
    if (job.generation?.capability === 'synthesizeSpeech') add(F.language, job.generation.language);
    if (row.phase) add(F.phase, row.phase);
    if (job.generation?.capability === 'generateImage') {
      add(F.images, `${job.result?.outputs?.length ?? 0}/${job.generation.count}`);
    }
    if (job.startedAt) add(F.took, took((job.endedAt ? Date.parse(job.endedAt) : now) - Date.parse(job.startedAt)));
    if (job.cancellation) add(F.cost, cancellationCost(job.cancellation));
  } else {
    add(F.took, took((row.endedAt ? Date.parse(row.endedAt) : now) - Date.parse(row.startedAt)));
  }
  return rows;
}

/**
 * 取消之后费用的那句实话（架构设计 §7.4）：服务商不支持取消时请求可能照样在远端做完。没有外发的不写（null）。
 */
export function cancellationCost(cancellation: Pick<JobCancellation, 'remote' | 'cost'>): string | null {
  if (cancellation.cost === 'none') return null;
  if (cancellation.cost === 'charged') return TASK_VIEW_COPY.costCharged;
  if (cancellation.remote === 'cancel-unsupported') return TASK_VIEW_COPY.costCancelUnsupported;
  if (cancellation.remote === 'unknown') return TASK_VIEW_COPY.costUnknown;
  return TASK_VIEW_COPY.costPossible;
}

/** 补救去处：与 shell 的路由同形（`models` 的类与页、设置 › Agent、服务）。 */
export type RemedyTarget =
  | { tab: 'models'; category: ModelCategory; page?: ModelPage }
  | { tab: 'settings'; section: 'agent' }
  | { tab: 'services'; service: 'remote' }
  | { tab: 'tasks'; taskId: string };

export interface Remedy {
  label: string;
  target: RemedyTarget;
  /** 说明这是配置问题的一句；`CAPABILITY_NOT_CONFIGURED` 时用它自己的提示。 */
  hint: string;
}

const CAPABILITY_CATEGORY: Record<ModelServiceCapability, ModelCategory> = {
  transcribe: 'asr',
  synthesizeSpeech: 'tts',
  generateImage: 'image',
  generateText: 'llm',
  separateAudio: 'sep',
};

/** 模型任务所属的能力分类；导出、固定流程、安装之类不是模型任务，没有。 */
function jobCategory(kind: JobKind): ModelCategory | undefined {
  return (CAPABILITY_CATEGORY as Partial<Record<JobKind, ModelCategory>>)[kind];
}

function isCapabilityNotConfigured(details: unknown): details is CapabilityNotConfiguredDetails {
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { code?: unknown }).code === 'CAPABILITY_NOT_CONFIGURED' &&
    typeof (details as { remedy?: unknown }).remedy === 'object'
  );
}

/**
 * 失败的 Job 去哪儿补：`CAPABILITY_NOT_CONFIGURED` 按 `remedy.action`（合同上它在提交时就拒绝、不建 Job，这里防御着读），
 * 其余按错误码：凭据问题去云端模型，模型包问题去本地模型。别的错误没有确定的去处，不给按钮。
 */
export function jobRemedy(job: Pick<JobRecord, 'kind' | 'providerId' | 'error'>): Remedy | null {
  const error = job.error;
  if (!error) return null;
  const configHint = TASK_VIEW_COPY.configHint;
  if (isCapabilityNotConfigured(error.details)) {
    const { remedy } = error.details;
    const category = CAPABILITY_CATEGORY[remedy.capability] ?? jobCategory(job.kind);
    const hint = remedyHintText(remedy) || configHint;
    const providerId = remedy.providerId ?? error.details.providerId ?? '';
    switch (remedy.action) {
      case 'install-model':
        return { label: TASK_VIEW_COPY.remedyInstall, target: { tab: 'models', category, page: 'local' }, hint };
      case 'configure-provider':
      case 'enable-provider':
        if (providerId.startsWith('agent:')) return { label: TASK_VIEW_COPY.remedyAgent, target: { tab: 'settings', section: 'agent' }, hint };
        return { label: TASK_VIEW_COPY.remedyCloud, target: { tab: 'models', category, page: 'cloud' }, hint };
      case 'set-default':
        return { label: TASK_VIEW_COPY.remedyDefault, target: { tab: 'models', category }, hint };
      case 'pair-node':
        return { label: TASK_VIEW_COPY.remedyNode, target: { tab: 'services', service: 'remote' }, hint };
      case 'setup-agent':
        return { label: TASK_VIEW_COPY.remedyAgent, target: { tab: 'settings', section: 'agent' }, hint };
      default:
        return null;
    }
  }
  const category = jobCategory(job.kind);
  if (!category) return null;
  if (error.code === 'PROVIDER_AUTH_FAILED' || error.code === 'API_KEY_INVALID') {
    if (job.providerId.startsWith('agent:')) return { label: TASK_VIEW_COPY.remedyAgent, target: { tab: 'settings', section: 'agent' }, hint: configHint };
    return { label: TASK_VIEW_COPY.remedyCloud, target: { tab: 'models', category, page: 'cloud' }, hint: configHint };
  }
  if ((error.code === 'MODEL_LOAD_FAILED' || error.code === 'MODEL_NOT_READY') && job.providerId === 'local') {
    return { label: TASK_VIEW_COPY.remedyInstall, target: { tab: 'models', category, page: 'local' }, hint: configHint };
  }
  return null;
}

/**
 * 提交时就被拒、没有建 Job 的（`CAPABILITY_NOT_CONFIGURED` 在 RPC 错误的 details 里）：同样按 `remedy.action` 给去处。
 * 别的拒绝没有确定的去处（null）。
 */
export function rejectionRemedy(kind: JobKind, error: unknown): Remedy | null {
  const details = (error as { details?: unknown } | null)?.details;
  if (!isCapabilityNotConfigured(details)) return null;
  const message = error instanceof Error ? error.message : String(error);
  return jobRemedy({ kind, providerId: details.providerId ?? '', error: { code: details.code, message, details } });
}

export interface OutputRow {
  key: string;
  kind: 'image' | 'audio' | 'document';
  name: string;
  /** `768×1344 · 1.2 MB`、`0:12 · 48 kHz · 1.2 MB`；文稿是一句说明。 */
  meta: string;
  /** 能经 `artifacts.openHandle` 打开的产物；文稿写进了视频，没有单独可开的文件。 */
  artifactId: string | null;
  mediaType: string | null;
  /** 已导入视频成为素材。 */
  imported: boolean;
  /** 写到磁盘上的文件（导出）：完整路径，「在文件夹中显示」用；只存在产物库里的没有。 */
  path: string | null;
}

const basename = (file: string) => file.split(/[\\/]/).pop() || file;

function outputRow(output: GeneratedOutput, index: number): OutputRow {
  const size = fmtSize(output.byteLength);
  if (output.media.kind === 'image') {
    return {
      key: output.artifactId,
      kind: 'image',
      name: TASK_VIEW_COPY.imageName(index + 1),
      meta: [`${output.media.width}×${output.media.height}`, size].join(' · '),
      artifactId: output.artifactId,
      mediaType: output.mediaType,
      imported: output.assetId !== null,
      path: output.path ?? null,
    };
  }
  if (output.media.kind !== 'audio') {
    const media = output.media;
    const meta =
      media.kind === 'video'
        ? [`${media.width}×${media.height}`, formatClock(media.durationSec), size]
        : media.kind === 'text'
          ? [TASK_VIEW_COPY.entries(media.entries), size]
          : media.kind === 'package'
            ? [TASK_VIEW_COPY.packageFiles(media.files), size]
            : media.kind === 'project'
              ? [TASK_VIEW_COPY.projectClips(media.clips), formatClock(media.durationSec), size]
              : [size];
    return {
      key: output.artifactId,
      kind: 'document',
      // 导出写到磁盘上的文件以实际文件名为准（重名时 Runtime 加过的序号也在里面）。
      name: output.path ? basename(output.path) : media.kind === 'video' ? TASK_VIEW_COPY.videoName(index + 1) : TASK_VIEW_COPY.fileName(index + 1),
      meta: meta.join(' · '),
      // 便携包不进产物库（`artifactId` 只是包文件的摘要），打不开，只能在文件夹中显示。
      artifactId: media.kind === 'package' ? null : output.artifactId,
      mediaType: output.mediaType,
      imported: false,
      path: output.path ?? null,
    };
  }
  return {
    key: output.artifactId,
    kind: 'audio',
    name: output.path ? basename(output.path) : TASK_VIEW_COPY.audioName(index + 1),
    meta: [formatClock(output.media.durationSec), `${Math.round(output.media.sampleRate / 100) / 10} kHz`, size].join(' · '),
    artifactId: output.artifactId,
    mediaType: output.mediaType,
    imported: output.assetId !== null,
    path: output.path ?? null,
  };
}

/** 产物行：生成任务的每个输出；转录写进视频的文稿只说一句，原始结果（JSON）不列。 */
export function jobOutputs(job: Pick<JobRecord, 'result'>): OutputRow[] {
  const result = job.result;
  if (!result) return [];
  if (result.outputs?.length) return result.outputs.map(outputRow);
  if (result.documentId) {
    return [
      {
        key: result.documentId,
        kind: 'document',
        name: TASK_VIEW_COPY.documentName,
        meta: TASK_VIEW_COPY.documentWritten,
        artifactId: null,
        mediaType: null,
        imported: true,
        path: null,
      },
    ];
  }
  return [];
}

/** 生图任务的那一行请求（原型 `imageMeta`）：`模型 · 画幅 · N 张 · 用时`。没有冻结参数时 null。 */
export function imageRequest(job: JobRecord, now: number): { prompt: string; meta: string } | null {
  const g = job.generation;
  if (g?.capability !== 'generateImage') return null;
  const elapsed = job.startedAt && job.state !== 'queued' ? (job.endedAt ? Date.parse(job.endedAt) : now) - Date.parse(job.startedAt) : null;
  const meta = [job.modelId, g.aspectRatio ?? g.size, g.count > 0 ? M.imageCount(g.count) : null, elapsed != null ? secs(elapsed) : null]
    .filter(Boolean)
    .join(' · ');
  return { prompt: g.prompt, meta };
}
