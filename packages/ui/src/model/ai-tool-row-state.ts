import { AI_TOOL_PIPELINE, type CutSuggestion, type DocumentRecord, type Id, type JobRecord } from '@baocut/protocol';
import type { AiToolId } from './ai-tools.ts';
import { jobLive, jobPercent } from './task-list.ts';

/**
 * AI 工具列表每一行右边的状态（产品设计 §5.10「AI 工具 Tab」，原型 panel-aitools-list.jsx `rowState`）：只报编辑器手里有的事实，
 * 按「在跑 > 待处理 > 过期 > 章节 > 上次跑过」取第一个。这里只做判断，文案与色调由列表按 `kind` 取。
 */
export type AiToolRowState =
  | { kind: 'running'; percent: number | null }
  /** 直接调模型的结果或收据还没看完（「完成」之前）。 */
  | { kind: 'result' }
  /** 识别说话人的提案等人确认。 */
  | { kind: 'review' }
  | { kind: 'pending'; count: number }
  | { kind: 'stale'; count: number }
  | { kind: 'chapters'; count: number }
  | { kind: 'last'; at: string }
  | { kind: 'undone' };

export interface AiToolRowFacts {
  /** 这个视频上这个工具在跑的任务；百分比不知道时 null。 */
  running?: { percent: number | null } | null;
  result?: boolean;
  review?: boolean;
  /** 时间线上建议了、还没定的剪切（只对找可剪的口）。 */
  pendingCuts?: number;
  /** 过期的译文句子（只对刷新过期译文）。 */
  staleSentences?: number;
  /** 时间线上的章节数（只对生成章节）。 */
  chapters?: number;
  /** 这个视频上这个工具最近一次跑完的那一次；`undone` 是它写进视频的那一笔已经撤销。 */
  last?: { at: string; undone: boolean } | null;
}

export function aiToolRowState(tool: AiToolId, facts: AiToolRowFacts): AiToolRowState | null {
  if (facts.running) return { kind: 'running', percent: facts.running.percent };
  if (facts.result) return { kind: 'result' };
  if (facts.review) return { kind: 'review' };
  if (tool === 'cleanup' && facts.pendingCuts) return { kind: 'pending', count: facts.pendingCuts };
  if (tool === 'stale' && facts.staleSentences) return { kind: 'stale', count: facts.staleSentences };
  if (tool === 'chapters' && facts.chapters) return { kind: 'chapters', count: facts.chapters };
  if (facts.last) return facts.last.undone ? { kind: 'undone' } : { kind: 'last', at: facts.last.at };
  return null;
}

// ---- 事实 ----

export interface AiToolJobFacts {
  running: { percent: number | null } | null;
  last: { jobId: Id; at: string } | null;
}

const toolOf = (job: JobRecord): unknown => job.pipeline?.params.tool;
const videoOf = (job: JobRecord): unknown => job.videoId ?? job.pipeline?.params.videoId;

/** 直接调模型的任务（`ai-tool` 流程）里属于这个视频的，按工具分：在跑的那一个与最近一次完成的那一个。 */
export function aiToolJobFacts(jobs: readonly JobRecord[], videoId: Id): Partial<Record<string, AiToolJobFacts>> {
  const out: Partial<Record<string, AiToolJobFacts>> = {};
  for (const job of jobs) {
    if (job.kind !== 'pipeline' || job.pipeline?.name !== AI_TOOL_PIPELINE || videoOf(job) !== videoId) continue;
    const tool = toolOf(job);
    if (typeof tool !== 'string') continue;
    const facts = (out[tool] ??= { running: null, last: null });
    if (jobLive(job)) {
      const percent = jobPercent(job);
      if (!facts.running || (facts.running.percent === null && percent !== null)) facts.running = { percent };
    } else if (job.state === 'completed') {
      const at = job.endedAt ?? job.updatedAt;
      if (!facts.last || Date.parse(at) > Date.parse(facts.last.at)) facts.last = { jobId: job.jobId, at };
    }
  }
  return out;
}

export const EDITORIAL_PROPOSAL_KIND = 'editorial-proposal';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 剪辑提案（视频格式规范 §6.2）里还没定的建议条数。转写在检测之后改过的提案已经过期（`speechRef` 不是那份转写的现在这版），
 * 不算；正文还没取到或认不出来时不算。
 */
export function pendingCutCount(proposals: readonly { record: DocumentRecord; body: unknown }[], documents: Record<Id, DocumentRecord>): number {
  let n = 0;
  for (const { body } of proposals) {
    if (!isObject(body) || body.schema !== 'baocut.editorial-proposal/1' || !Array.isArray(body.suggestions)) continue;
    const ref = body.speechRef;
    if (!isObject(ref) || typeof ref.id !== 'string' || documents[ref.id]?.currentRevision !== ref.revision) continue;
    n += (body.suggestions as CutSuggestion[]).filter((s) => isObject(s) && s.status === 'pending').length;
  }
  return n;
}
