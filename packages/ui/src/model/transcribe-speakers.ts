import { defineMessages, type Id, type JobRecord, type ModelBundleStatus, type ModelCapabilitiesView, type ModelRef, type TranscribeModelInfo } from '@baocut/protocol';
import { bundleName, isBundleInstalled } from './models-local.ts';
import { zhHans } from './transcribe-speakers.zh-Hans.ts';
import { zhHant } from './transcribe-speakers.zh-Hant.ts';
import { ja } from './transcribe-speakers.ja.ts';
import { ko } from './transcribe-speakers.ko.ts';
import { es } from './transcribe-speakers.es.ts';
import { fr } from './transcribe-speakers.fr.ts';
import { de } from './transcribe-speakers.de.ts';
import { nl } from './transcribe-speakers.nl.ts';
import { ptBR } from './transcribe-speakers.pt-BR.ts';
import { it } from './transcribe-speakers.it.ts';
import { ru } from './transcribe-speakers.ru.ts';
import { pl } from './transcribe-speakers.pl.ts';
import { tr } from './transcribe-speakers.tr.ts';
import { vi } from './transcribe-speakers.vi.ts';

/** 「识别说话人」开关的文案（译文在 `transcribe-speakers.<语言>.ts`）。 */
const en = {
  packFallback: 'Speaker diarization',
  builtinNote: (model: string) => `${model} tells speakers apart on its own, during transcription`,
  builtinSummary: 'Identify speakers · built into the model',
  noneNote: (model: string) => `${model} doesn’t tell speakers apart. If you need it, switch to a local model or a service that has it built in`,
  missingNote: (pack: string, size: string | null) => `Download “${pack}”${size ? ` (${size})` : ''} first to tell speakers apart`,
  missingSummary: 'Identify speakers · download the model first',
  onNote: 'After transcribing, “Speaker diarization” labels each sentence with its speaker, and subtitles and transcripts include the names',
  summaryOn: 'Identify speakers',
  offNote: 'Speakers aren’t told apart; subtitles and transcripts won’t include names',
  summaryOff: 'Don’t identify speakers',
  /** 下载门卡上那一行：`pct` 为 null 时还不知道进度。 */
  downloading: (pack: string, pct: number | null) => `Downloading “${pack}”${pct === null ? '…' : ` · ${pct}%`}`,
};
export type TranscribeSpeakersMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/*
 * 语音模型下面「更多选项 › 识别说话人」（产品设计 §2.7，设计稿 model-tool-runs.js `speakerSwitch` / `speakerCopy`、
 * tool-transcribe.jsx `AsrMoreOptions`）。转录工具页与重新转录共用。
 * - 模型自己区分（`speakers: 'native'`，MOSS Transcribe）：开着、锁住；
 * - 转写后用「说话人区分」模型包区分（描述里有 `diarizationPack`，Qwen3-ASR、Whisper）：可以拨；包装好了默认开，没装默认关，
 *   拨开了又没装要先下载；
 * - 不区分（在线服务、没登记模型包的）：关着、锁住。
 * 用户亲手拨过的值（`pick`）跨模型保留；没拨过时按上面的默认。
 */

export type SpeakerKind = 'builtin' | 'pack' | 'none';

export interface SpeakerSwitch {
  kind: SpeakerKind;
  /** 这次识别不识别说话人：提交时原样作为 `diarize`。 */
  on: boolean;
  /** 不能拨（模型自带或不区分）。 */
  locked: boolean;
  /** 开着而「说话人区分」还没装：先下载，否则开始不了。 */
  missing: boolean;
  /** 转写之后单列「识别说话人」一步（模型自带区分时不单列）。 */
  step: boolean;
}

/** 这只模型转写后要用的「说话人区分」模型包；模型自带区分或不区分时 null。 */
export function speakerPackId(info: TranscribeModelInfo | null | undefined): string | null {
  if (!info || info.speakers === 'native') return null;
  return info.diarizationPack ?? null;
}

/** 模型包装好了没有；这台电脑上没列出这只模型包时按模型描述（`speakers: 'pack'` 即装好了）。 */
export function speakerPackInstalled(info: TranscribeModelInfo | null | undefined, pack: ModelBundleStatus | null): boolean {
  return pack ? isBundleInstalled(pack) : info?.speakers === 'pack';
}

/**
 * 开关此刻的样子。`pick`：用户亲手拨的值，null 为没拨过；`installed`：「说话人区分」装好了没有（`speakerPackInstalled`）。
 * 模型描述里有 `diarizationPack` 或已是 `speakers: 'pack'` 的才可拨。
 */
export function speakerSwitch(info: TranscribeModelInfo | null | undefined, pick: boolean | null, installed: boolean): SpeakerSwitch {
  const kind: SpeakerKind =
    info?.speakers === 'native' ? 'builtin' : info && (info.diarizationPack || info.speakers === 'pack') ? 'pack' : 'none';
  if (kind === 'builtin') return { kind, on: true, locked: true, missing: false, step: false };
  if (kind === 'none') return { kind, on: false, locked: true, missing: false, step: false };
  const on = pick === null ? installed : pick;
  return { kind, on, locked: false, missing: on && !installed, step: on };
}

/** 「说话人区分」那一行：名字与体积（下载计划给的总量，没有时用模型包随附清单估的 `estimatedBytes`；都没有时不写）。 */
export interface SpeakerPackFacts {
  name: string;
  size: string | null;
}

export function speakerPackFacts(pack: ModelBundleStatus | null, size: (bytes: number) => string): SpeakerPackFacts {
  const total = pack?.install?.totalBytes || pack?.estimatedBytes || null;
  return { name: pack ? bundleName(pack) : M.packFallback, size: total ? size(total) : null };
}

/** 开关下面那一句，与折叠标题上的状态。`name`：语音模型给人看的名字。 */
export function speakerCopy(s: SpeakerSwitch, name: string, pack: SpeakerPackFacts): { note: string; summary: string } {
  if (s.kind === 'builtin') return { note: M.builtinNote(name), summary: M.builtinSummary };
  if (s.kind === 'none') return { note: M.noneNote(name), summary: M.summaryOff };
  if (s.missing) return { note: M.missingNote(pack.name, pack.size), summary: M.missingSummary };
  if (s.on) return { note: M.onNote, summary: M.summaryOn };
  return { note: M.offNote, summary: M.summaryOff };
}

/** 下载门卡上那一行：`说话人区分 · 23 MB`，下载中 `正在下载「说话人区分」· 40%`。 */
export function speakerGateLine(pack: SpeakerPackFacts, downloadingPct: number | null | undefined): string {
  if (downloadingPct !== undefined) return M.downloading(pack.name, downloadingPct);
  return pack.size ? `${pack.name} · ${pack.size}` : pack.name;
}

// ---- 运行视图 ----

/** 一次转录运行里真正做转写的那个任务（`models.transcribe`，由流程提交，提交者是父任务）；还没提交时 null。 */
export function transcribeJobOf(parentJobId: Id, jobs: readonly JobRecord[]): JobRecord | null {
  let hit: JobRecord | null = null;
  for (const j of jobs) {
    if (j.kind !== 'transcribe' || j.submitter.kind !== 'pipeline' || j.submitter.id !== parentJobId) continue;
    if (!hit || j.createdAt > hit.createdAt) hit = j;
  }
  return hit;
}

/**
 * 这次转录的步骤表要不要单列「识别说话人」：只在 `diarize: true` 且由「说话人区分」模型包来做时（模型自带区分时不单列）。
 * 用的模型取转写任务记下的；还没提交时按冻结的参数，再按生效的默认值。认不出模型时不单列。
 */
export function diarizeStepOf(job: JobRecord, jobs: readonly JobRecord[], view: ModelCapabilitiesView | null): boolean {
  const pipeline = job.pipeline;
  if (!pipeline || pipeline.name !== 'transcribe' || pipeline.params.diarize !== true || !view) return false;
  const child = transcribeJobOf(job.jobId, jobs);
  const params = pipeline.params;
  const ref = child
    ? { providerId: child.providerId, modelId: child.modelId }
    : typeof params.provider === 'string' && typeof params.model === 'string'
      ? { providerId: params.provider, modelId: params.model }
      : view.transcribe.effective;
  return ref ? speakerPackId(transcribeModelInfo(view, ref)) !== null : false;
}

/** 能力视图里的一只语音识别模型（按 Provider 与模型 ID）；找不到时 null。 */
export function transcribeModelInfo(view: ModelCapabilitiesView, ref: ModelRef): TranscribeModelInfo | null {
  const provider = view.transcribe.providers.find((p) => p.providerId === ref.providerId);
  return provider?.models.find((m) => m.modelId === ref.modelId) ?? null;
}
