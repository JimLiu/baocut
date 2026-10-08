import { defineMessages, type JobKind, type JobRecord, type SpaceEntry } from '@baocut/protocol';
import { isVideoTool, spaceKindsOf, TOOLS, toolById, type ToolId, type ToolInfo } from './tool-catalog.ts';
import { saveDirLabel } from './tool-frame.ts';
import { zhHans } from './tool-rerun.zh-Hans.ts';
import { zhHant } from './tool-rerun.zh-Hant.ts';
import { ja } from './tool-rerun.ja.ts';
import { ko } from './tool-rerun.ko.ts';
import { es } from './tool-rerun.es.ts';
import { fr } from './tool-rerun.fr.ts';
import { de } from './tool-rerun.de.ts';
import { nl } from './tool-rerun.nl.ts';
import { ptBR } from './tool-rerun.pt-BR.ts';
import { it } from './tool-rerun.it.ts';
import { ru } from './tool-rerun.ru.ts';
import { pl } from './tool-rerun.pl.ts';
import { tr } from './tool-rerun.tr.ts';
import { vi } from './tool-rerun.vi.ts';
import { toolOfJob } from './tool-runs.ts';

const en = { runAgain: 'Run again', retry: 'Try again' };
export type ToolRerunMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/*
 * 工具与 Space 条目、后台任务之间的来回（产品设计 §2.7「页面」「进度与失败」、§4.5；设计稿 model-space-tools.js、
 * model-task-outputs.js）：一个条目能用哪些工具处理，工具做出来的条目（任务）是哪个工具的，「再做一次 / 重试」怎么回去，
 * 条目落在哪个目录。
 */

/** 工具页的直接任务：任务种类 → 工具。 */
const DIRECT: Partial<Record<JobKind, ToolId>> = {
  synthesizeSpeech: 'synthesize-speech',
  generateImage: 'generate-image',
  generateText: 'generate-text',
};

/**
 * 工具页发起的任务是哪个工具的；不是工具页发起的返回 null。Agent 发起的（「再做一次」属于会话）、编辑器面板发起的
 * 直接任务（带视频，比如配音面板的生成语音）、固定流程里的一步都不回工具页。
 */
export function toolOfTask(job: Pick<JobRecord, 'kind' | 'pipeline' | 'submitter' | 'videoId'>): ToolId | null {
  if (job.submitter.kind !== 'connection') return null;
  if (job.kind === 'pipeline') return toolOfJob(job);
  if (job.videoId !== null) return null;
  return DIRECT[job.kind] ?? null;
}

const PIPELINE_TOOLS: readonly string[] = ['transcribe', 'translate-subtitles', 'dub', 'link-import'];

/**
 * 只有条目的来源（`origin.capability`，任务已经修剪掉）时推断工具：直接任务按任务种类，固定流程按流程名；文件转码分不出
 * 是哪一个工具（要看参数），导出与 Agent 做出来的不算。
 */
export function toolOfOrigin(origin: Pick<NonNullable<SpaceEntry['origin']>, 'capability' | 'conversationId'> | undefined): ToolId | null {
  const capability = origin?.capability;
  if (!capability || origin.conversationId) return null;
  return DIRECT[capability as JobKind] ?? (PIPELINE_TOOLS.includes(capability) ? (capability as ToolId) : null);
}

export interface Rerun {
  tool: ToolId;
  label: string;
  /**
   * `refill`：回到参数已经填好的工具页（直接任务与文件转码，表单照这次的参数填好，改不改由用户）；
   * `view`：视频工具打开这次运行（步骤、从那一步重试、「再做一次」回到表单都在运行页）。
   */
  mode: 'refill' | 'view';
}

/** 任务的「重试 / 再做一次」；还在跑、排队、等对账的，以及不是工具页发起的不给。 */
export function rerunOf(job: Pick<JobRecord, 'kind' | 'pipeline' | 'submitter' | 'videoId' | 'state'>): Rerun | null {
  const tool = toolOfTask(job);
  if (!tool || !toolById(tool)) return null;
  if (job.state === 'queued' || job.state === 'running' || job.state === 'needs-reconciliation') return null;
  if (isVideoTool(tool)) return { tool, label: M.runAgain, mode: 'view' };
  const failed = job.state === 'failed' || job.state === 'interrupted';
  return { tool, label: failed ? M.retry : M.runAgain, mode: 'refill' };
}

/**
 * 「用工具处理…」列哪些工具：收这种条目的工具（与工具页的 Space 输入一致）。回收站里的、生成中、失败的占位与找不到文件的
 * 不列。
 */
export function toolsForEntry(entry: Pick<SpaceEntry, 'kind' | 'status' | 'user'>): ToolInfo[] {
  if (entry.user.trashedAt || entry.status === 'generating' || entry.status === 'failed' || entry.status === 'missing') return [];
  return TOOLS.filter((t) => !t.planned && spaceKindsOf(t.id).includes(entry.kind));
}

function fold(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

/** 条目所在的目录与它是不是默认保存位置；不知道文件在哪、或是视频条目时 null。 */
export function entryLocation(
  entry: Pick<SpaceEntry, 'kind' | 'file'>,
  saveDirectory: string | null,
): { label: string; isSaveDir: boolean } | null {
  const path = entry.file?.path;
  if (!path || entry.kind === 'video') return null;
  const dir = path.replace(/[\\/][^\\/]*$/, '');
  if (!dir) return null;
  return { label: saveDirLabel(dir), isSaveDir: !!saveDirectory && fold(saveDirectory) === fold(dir) };
}
