import { defineMessages, live, localizeText, type DubFitStatus, type DubSummary, type Id, type JobKind, type JobRecord, type PipelineStepState } from '@baocut/protocol';
import { zhHans } from './dub-progress.zh-Hans.ts';
import { zhHant } from './dub-progress.zh-Hant.ts';
import { ja } from './dub-progress.ja.ts';
import { ko } from './dub-progress.ko.ts';
import { es } from './dub-progress.es.ts';
import { fr } from './dub-progress.fr.ts';
import { de } from './dub-progress.de.ts';
import { nl } from './dub-progress.nl.ts';
import { ptBR } from './dub-progress.pt-BR.ts';
import { it } from './dub-progress.it.ts';
import { ru } from './dub-progress.ru.ts';
import { pl } from './dub-progress.pl.ts';
import { tr } from './dub-progress.tr.ts';
import { vi } from './dub-progress.vi.ts';
import { DUB_PIPELINE } from './dub-setup.ts';
import { jobRemedy, type Remedy } from './task-facts.ts';
import { jobLive } from './task-list.ts';
import { chargesOnRetry } from './task-reconcile.ts';

/**
 * 翻译配音流程（`pipelines.start` 的 `dub`，架构设计 §7.9）在工具页上的进度、失败与收据：父任务记着九步（读取原文 →
 * 翻译 → 组装译文 → 写入译文 → 核对译文 → 分离人声与背景 → 逐句合成 → 时间对齐 → 应用配音），翻译与合成两步按句报进度，
 * 合成一步再为每句开一个子任务（`第 N 句`）。给了译文时翻译三步跳过；没有要求分离或没有分离的执行者时分离一步跳过。
 * 进度只按 Runtime 报来的真实数字算，不猜批次（同 translate-progress.ts）。
 */

/** 各步占总进度的份量：时间几乎都花在逐批翻译与逐句合成上。认不出的步骤按 3 算。 */
const STEP_WEIGHT: Record<string, number> = {
  'freeze-source': 2,
  translate: 30,
  assemble: 2,
  write: 2,
  'check-translation': 2,
  separate: 10,
  synthesize: 50,
  align: 4,
  apply: 3,
};
const weightOf = (name: string) => STEP_WEIGHT[name] ?? 3;

/** 先翻译时才跑的三步。 */
export const TRANSLATING_STEPS = new Set(['translate', 'assemble', 'write']);
/** 停在这几步上时失败与补救按文本模型算；别的按语音合成算。 */
const TEXT_STEPS = new Set(['freeze-source', 'translate', 'assemble', 'write']);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** 这个视频的翻译配音流程（不论从哪里发起：工具页、智能体、命令行）。 */
export function isDubJob(job: JobRecord, videoId: Id | null): boolean {
  return job.kind === 'pipeline' && job.pipeline?.name === DUB_PIPELINE && videoId !== null && job.videoId === videoId;
}

/** 正在配的（排队、在跑、崩溃后自动重跑）。 */
export function liveDubs(jobs: readonly JobRecord[], videoId: Id | null): JobRecord[] {
  return jobs.filter((job) => isDubJob(job, videoId) && jobLive(job));
}

/** 冻结参数里配成的语言。 */
export function dubLanguageOf(job: JobRecord): string | null {
  return str(job.pipeline?.params.language) ?? str(job.pipeline?.summary?.language);
}

/** 冻结参数里语音合成与文本模型的 Provider（父任务的 `providerId` 只记语音合成那家）。 */
export function dubProviders(job: JobRecord): { voice: string | null; text: string | null } {
  const params = job.pipeline?.params ?? {};
  const voice = isObject(params.voice) ? str(params.voice.providerId) : null;
  const translate = isObject(params.translate) ? str(params.translate.provider) : null;
  return { voice: voice ?? str(job.providerId), text: params.translationId ? null : translate };
}

/** 让流程停下的那一步：`pipeline.stoppedAt`，没有时取第一个失败、中断或取消的步骤。 */
export function dubStoppedAt(job: JobRecord): string | null {
  const steps = job.pipeline?.steps ?? [];
  return job.pipeline?.stoppedAt ?? steps.find((s) => s.status === 'failed' || s.status === 'interrupted' || s.status === 'cancelled')?.name ?? null;
}

/** 这一步会不会跳过：已经标了 `skipped`，或还没到、但按冻结参数一定跳过（给了译文时的翻译三步；没有分离的执行者）。 */
function skips(step: PipelineStepState, params: Json): boolean {
  if (step.status === 'skipped') return true;
  if (step.status !== 'pending') return false;
  if (TRANSLATING_STEPS.has(step.name)) return typeof params.translationId === 'string' && params.translationId !== '';
  if (step.name === 'separate') return !params.separatorId;
  return false;
}

/** 进度阶梯上画的步骤：去掉跳过的与按冻结参数一定跳过的（九格在窄面板里挤不下，也不该画永远灰着的格子）。 */
export function dubLadder(job: JobRecord): PipelineStepState[] {
  const params = job.pipeline?.params ?? {};
  return (job.pipeline?.steps ?? []).filter((step) => !skips(step, params));
}

export interface DubProgress {
  /** 0–100；还没开始时 0，没完成时最多 99。 */
  percent: number;
  /** 正在执行的那一步：Runtime 给的步骤名与给人看的名字；排队、还没有步骤时 null。 */
  step: { name: string; label: string } | null;
  /** 翻译或合成那一步的句数；还没报时 null。 */
  units: { step: 'translate' | 'synthesize'; done: number; total: number | null } | null;
  /** 合成那一步当前这一次的逐句子任务：在合成的、失败了的句数。 */
  sentences: { running: number; failed: number } | null;
  queued: boolean;
}

/**
 * 总进度：完成或跳过的步骤不计入（一定跳过的也不计，免得一开始就跳一大截），正在跑的步骤按子任务报来的 `done / total` 算一部分。
 * 子任务不在镜像里或没有总数时那一步按 0 算——宁可慢，不猜。
 */
export function dubProgress(parent: JobRecord, jobs: readonly JobRecord[]): DubProgress {
  const steps = dubLadder(parent);
  const total = steps.reduce((sum, step) => sum + weightOf(step.name), 0);
  let done = 0;
  let current: PipelineStepState | null = null;
  let units: DubProgress['units'] = null;
  let sentences: DubProgress['sentences'] = null;
  for (const step of steps) {
    const weight = weightOf(step.name);
    if (step.status === 'completed') {
      done += weight;
      continue;
    }
    if (step.status !== 'running') continue;
    current = step;
    const child = step.jobId ? jobs.find((job) => job.jobId === step.jobId) : undefined;
    const progress = child?.progress ?? null;
    if (progress && progress.total) done += weight * Math.min(1, Math.max(0, progress.done / progress.total));
    if ((step.name === 'translate' || step.name === 'synthesize') && progress?.unit === 'units') {
      units = { step: step.name, done: progress.done, total: progress.total ?? null };
    }
    if (step.name === 'synthesize') {
      const mine = jobs.filter(
        (job) => job.parentJobId === parent.jobId && job.step?.name === 'synthesize' && job.jobId !== step.jobId && job.attempt === step.attempts,
      );
      sentences = { running: mine.filter((job) => jobLive(job)).length, failed: mine.filter((job) => job.state === 'failed').length };
    }
  }
  const finished = parent.state === 'completed';
  const percent = finished ? 100 : total ? Math.min(99, Math.floor((done / total) * 100)) : 0;
  return {
    percent,
    step: current ? { name: current.name, label: current.label } : null,
    units,
    sentences,
    queued: parent.state === 'queued',
  };
}

/**
 * 重试会不会为已经做过的再花钱：`pipelines.retry` 从停下的那一步接着做，前面完成的步骤复用产出。
 * - 停在「翻译」：这一步整个重跑，已经翻过的批次会再调一次在线文本模型（`charges`；本机与节点的不计费，null）。
 * - 停在「逐句合成」：已经合成好的句子复用，只合成失败的和还没合成的（`partial`）。
 * - 停在合成之后（对齐、应用）：不再调用模型（`free`）。
 * - 停在翻译与合成之间：译文复用，合成还没开始，谈不上「再」花钱（`free`）。停在翻译之前：null。
 */
export function dubRetryNote(job: JobRecord): 'charges' | 'partial' | 'free' | null {
  const stoppedAt = dubStoppedAt(job);
  if (!stoppedAt || stoppedAt === 'freeze-source') return null;
  if (stoppedAt === 'translate') {
    const text = dubProviders(job).text;
    return text && chargesOnRetry({ providerId: text }) ? 'charges' : null;
  }
  if (stoppedAt === 'synthesize') return 'partial';
  return 'free';
}

/** 失败时按停下的那一步找补救：翻译那几步按文本模型（`generateText`），别的按语音合成（凭据、配置问题去模型页）。 */
export function dubRemedy(job: JobRecord): Remedy | null {
  const stoppedAt = dubStoppedAt(job);
  const providers = dubProviders(job);
  const text = stoppedAt !== null && TEXT_STEPS.has(stoppedAt);
  const kind: JobKind = text ? 'generateText' : 'synthesizeSpeech';
  const providerId = (text ? providers.text : providers.voice) ?? job.providerId;
  return jobRemedy({ kind, providerId, error: job.error });
}

/** 完成时的摘要；没有、或不像 `DubSummary` 时 null。 */
export function dubSummaryOf(job: JobRecord): DubSummary | null {
  const summary = job.pipeline?.summary;
  if (!isObject(summary) || !isObject(summary.units) || typeof summary.planDocumentId !== 'string' || typeof summary.groupId !== 'string') return null;
  const s = summary as unknown as DubSummary;
  return {
    ...s,
    staleUnits: Array.isArray(s.staleUnits) ? s.staleUnits : [],
    voiceUnavailableUnits: Array.isArray(s.voiceUnavailableUnits) ? s.voiceUnavailableUnits : [],
    speakers: Array.isArray(s.speakers) ? s.speakers : [],
    overlongUnits: Array.isArray(s.overlongUnits) ? s.overlongUnits : [],
  };
}

export type DubUnitKey = DubFitStatus | 'stale' | 'offTimeline' | 'voiceUnavailable';

export interface DubUnitRow {
  key: DubUnitKey;
  label: string;
  count: number;
  /** 放上了（`placed`）还是没放（要用户看一眼）。 */
  placed: boolean;
}

/** 配音进度与收据的文案（英文是键与类型的来源，译文在 `dub-progress.zh-Hans.ts`）。 */
const en = {
  unit: {
    fit: 'Placed as is',
    tempo: 'Placed after speeding up',
    extended: 'Sped up to the limit, using the silence after it',
    overlong: 'Too long to fit, not placed',
    stale: 'Translation out of date, not synthesized',
    offTimeline: 'Original line no longer on the timeline, not placed',
    voiceUnavailable: 'Speaker’s voice unavailable, not synthesized',
  } as Record<DubUnitKey, string>,
  reasonStale: 'The clone has expired; clone it again in the voice library',
  reasonMissing: 'Not cloned with this provider yet',
  reasonNoConsent: 'No consent statement from the speaker, so it won’t be uploaded to the provider',
  reasonRemoved: 'This voice is no longer in the library',
  reasonServiceClient: 'External service callers can’t use voices from the library',
  codeCloneRequired: 'No valid clone with this provider',
  codeNotFound: 'Voice not found',
  warning: {
    DUB_SEPARATION_NOT_CONFIGURED: 'Background not separated',
    DUB_UNITS_STALE: 'Out-of-date translations not synthesized',
    DUB_UNITS_OVERLONG: 'Some lines are too long to fit',
    DUB_UNITS_OFF_TIMELINE: 'Some original lines are no longer on the timeline',
    DUB_MUTED_UNVOICED: 'Original audio was also muted for lines that weren’t synthesized',
    DUB_BACKGROUND_MUTED: 'Background audio was muted too',
    DUB_VOICE_UNAVAILABLE: 'Some speakers’ voices are unavailable',
  } as Record<string, string>,
  separated: 'Background separated',
  separationNotConfigured: 'Separation was requested but no separation capability is set up: skipped, original audio left as is',
  notSeparated: 'Background not separated',
  originalMuted: 'Original audio muted',
  originalKept: 'Original audio unchanged',
  originalDucked: (db: number | null) => (db ? `Original audio lowered by ${db} dB while the voice-over plays` : 'Original audio lowered while the voice-over plays'),
};
export type DubProgressMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

const UNIT_LABEL: Record<DubUnitKey, string> = live(() => M.unit);

/** 收据上各句的去向（按放不放得下）：只列有句子的，放上的在前。 */
export function dubUnitRows(summary: Pick<DubSummary, 'units'>): DubUnitRow[] {
  const u = summary.units;
  const fit = Math.max(0, u.placed - u.tempo - u.extended);
  const rows: DubUnitRow[] = [
    { key: 'fit', label: UNIT_LABEL.fit, count: fit, placed: true },
    { key: 'tempo', label: UNIT_LABEL.tempo, count: u.tempo, placed: true },
    { key: 'extended', label: UNIT_LABEL.extended, count: u.extended, placed: true },
    { key: 'overlong', label: UNIT_LABEL.overlong, count: u.overlong, placed: false },
    { key: 'stale', label: UNIT_LABEL.stale, count: u.stale, placed: false },
    { key: 'offTimeline', label: UNIT_LABEL.offTimeline, count: u.offTimeline, placed: false },
    { key: 'voiceUnavailable', label: UNIT_LABEL.voiceUnavailable, count: u.voiceUnavailable, placed: false },
  ];
  return rows.filter((row) => row.count > 0);
}

/** 音色不可用的原因（Runtime 给的错误码与 `stale`、`missing` 之类的原因）。 */
export function voiceReasonText(code: string, reason: string): string {
  switch (reason) {
    case 'stale':
      return M.reasonStale;
    case 'missing':
      return M.reasonMissing;
    case 'no-consent':
      return M.reasonNoConsent;
    case 'removed':
      return M.reasonRemoved;
    case 'service-client':
      return M.reasonServiceClient;
  }
  switch (code) {
    case 'VOICE_CLONE_REQUIRED':
      return M.codeCloneRequired;
    case 'VOICE_CONSENT_REQUIRED':
      return M.reasonNoConsent;
    case 'VOICE_NOT_FOUND':
      return M.codeNotFound;
    default:
      return code;
  }
}

export interface VoiceFailure {
  speakerId: string;
  voice: string;
  code: string;
  reason: string;
  units: Id[];
}

type UnavailableUnit = DubSummary['voiceUnavailableUnits'][number];

/** 按说话人归拢音色不可用的句子（这位说话人的句子没合成）：一位说话人一行，次序照第一次出现。 */
export function voiceFailures(units: readonly UnavailableUnit[]): VoiceFailure[] {
  const out = new Map<string, VoiceFailure>();
  for (const u of units) {
    const row = out.get(u.speakerId) ?? { speakerId: u.speakerId, voice: u.voice, code: u.code, reason: u.reason, units: [] };
    row.units.push(u.unitId);
    out.set(u.speakerId, row);
  }
  return [...out.values()];
}

export interface DubFailureFacts {
  /** 所有句子的说话人音色都不可用（失败的 `details.unavailable`）。 */
  unavailable: VoiceFailure[];
  /** 合成失败的句子（`DUB_SYNTHESIS_FAILED` 的 `details.failed`）。 */
  failed: Array<{ unitId: Id; code: string; message: string }>;
  /** 停下时已经合成、还剩的句数。 */
  synthesized: number | null;
  remaining: number | null;
}

/** 失败的任务里 Runtime 给的逐句事实：哪些句子没合成、为什么；没有时空的。 */
export function dubFailureFacts(job: Pick<JobRecord, 'error'>): DubFailureFacts {
  const details = isObject(job.error?.details) ? job.error.details : {};
  const unavailable = Array.isArray(details.unavailable)
    ? details.unavailable.filter(
        (u): u is UnavailableUnit => isObject(u) && typeof u.unitId === 'string' && typeof u.speakerId === 'string' && typeof u.voice === 'string',
      )
    : [];
  const failed = Array.isArray(details.failed)
    ? details.failed
        .filter((f): f is Json => isObject(f) && typeof f.unitId === 'string')
        .map((f) => ({ unitId: f.unitId as Id, code: str(f.code) ?? 'INTERNAL', message: str(f.message) ?? '' }))
    : [];
  return {
    unavailable: voiceFailures(unavailable.map((u) => ({ ...u, code: str(u.code) ?? 'VOICE_UNAVAILABLE', reason: str(u.reason) ?? 'invalid' }))),
    failed,
    synthesized: typeof details.synthesized === 'number' ? details.synthesized : null,
    remaining: typeof details.remaining === 'number' ? details.remaining : null,
  };
}

const WARNING_TITLE: Record<string, string> = live(() => M.warning);

/** 任务上的告警（同一码只留一条）：标题与 Runtime 的原话。 */
export function dubWarnings(job: Pick<JobRecord, 'warnings'>): Array<{ code: string; title: string; detail: string }> {
  const seen = new Set<string>();
  const out: Array<{ code: string; title: string; detail: string }> = [];
  for (const w of job.warnings) {
    if (seen.has(w.code)) continue;
    seen.add(w.code);
    out.push({ code: w.code, title: WARNING_TITLE[w.code] ?? w.code, detail: localizeText(w.detail, w.detailRef) ?? '' });
  }
  return out;
}

/** 人声与背景分离的结果，如实写。 */
export function separationText(separation: DubSummary['separation']): string {
  switch (separation) {
    case 'completed':
      return M.separated;
    case 'not-configured':
      return M.separationNotConfigured;
    default:
      return M.notSeparated;
  }
}

/** 原声怎么处理的。 */
export function originalAudioText(mode: DubSummary['originalAudio'], duckDb: number | null): string {
  if (mode === 'mute') return M.originalMuted;
  if (mode === 'keep') return M.originalKept;
  return M.originalDucked(duckDb);
}
