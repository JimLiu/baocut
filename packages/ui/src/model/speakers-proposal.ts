import {
  defineMessages,
  live,
  type Id,
  type JobRecord,
  type ModelBundleStatus,
  type ProposedSpeaker,
  type Sequence,
  type SpeakerClip,
  type SpeakersSummary,
} from '@baocut/protocol';
import { isBundleInstalled } from './models-local.ts';
import { projectSpeech } from './speech-cues.ts';
import { zhHans } from './speakers-proposal.zh-Hans.ts';
import { zhHant } from './speakers-proposal.zh-Hant.ts';
import { ja } from './speakers-proposal.ja.ts';
import { ko } from './speakers-proposal.ko.ts';
import { es } from './speakers-proposal.es.ts';
import { fr } from './speakers-proposal.fr.ts';
import { de } from './speakers-proposal.de.ts';
import { nl } from './speakers-proposal.nl.ts';
import { ptBR } from './speakers-proposal.pt-BR.ts';
import { it } from './speakers-proposal.it.ts';
import { ru } from './speakers-proposal.ru.ts';
import { pl } from './speakers-proposal.pl.ts';
import { tr } from './speakers-proposal.tr.ts';
import { vi } from './speakers-proposal.vi.ts';

/** 「识别说话人」运行态、改名与收据的文案（译文在 `speakers-proposal.<语言>.ts`）。 */
const en = {
  stages: ['Voiceprints', 'Clustering', 'Tidying up'] as readonly string[],
  nameEmpty: 'Name can’t be empty',
  nameTooLong: (max: number) => `Names can be at most ${max} characters`,
  /** 收据：`duration` 已格式化。 */
  receipt: (speakers: number, duration: string, engine: string) =>
    `Applied · Found ${speakers} ${speakers === 1 ? 'speaker' : 'speakers'} · ${duration} · ${engine}`,
};
export type SpeakersProposalMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/*
 * AI 工具「识别说话人」（原型 panel-aitools-flows.jsx `SpeakerFlow`，架构设计 §6.6）的纯函数：用哪个「说话人区分」模型包、
 * 运行到哪一段、确认页的试听片段与改名、收据上那一句。
 */

/** 这台电脑上的「说话人区分」模型包（Runtime 只列这个平台能用的那一个）；没列出时 null。 */
export function diarizePack(bundles: readonly ModelBundleStatus[]): ModelBundleStatus | null {
  return bundles.find((b) => b.capability === 'diarize') ?? null;
}

export function diarizePackReady(pack: ModelBundleStatus | null): boolean {
  return !!pack && isBundleInstalled(pack);
}

/** 运行态的三段（原型 `stages`）：声纹、聚类、整理。 */
export const SPEAKER_STAGES: readonly string[] = live(() => M.stages);

/**
 * 父任务此刻在哪一段：「整理」一步开始了算第三段；「区分说话人」那一步的子任务报到 `diarizing` 之后算聚类；其余（排队、
 * 载入模型、解码、算声纹）算第一段。
 */
export function speakersStage(job: JobRecord | null, jobs: readonly JobRecord[]): number {
  const steps = job?.pipeline?.steps ?? [];
  const propose = steps.find((s) => s.name === 'propose');
  if (propose && propose.status !== 'pending') return 2;
  const diarize = steps.find((s) => s.name === 'diarize');
  const child = diarize?.jobId ? jobs.find((j) => j.jobId === diarize.jobId) : undefined;
  if (child && (child.phase === 'diarizing' || child.phase === 'validating' || child.phase === 'finalizing')) return 1;
  return 0;
}

/** `mm:ss`（一小时以上 `h:mm:ss`）。 */
export function clockText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const CLIP_CHARS = 8;

/** 试听片段上的字（原型 `00:14 · 先从一个…`）：素材时间加这一句的开头，超过 8 个字截断。 */
export function clipLabel(clip: SpeakerClip, timescale: number): string {
  const chars = [...clip.text.trim()];
  const head = chars.length > CLIP_CHARS ? `${chars.slice(0, CLIP_CHARS).join('').trimEnd()}…` : chars.join('');
  return `${clockText(clip.start / (timescale || 1))} · ${head}`;
}

/**
 * 片段投到时间线上的区间（秒）：素材时钟上的这一句经取用这个素材的实例投过去，取第一段连着的部分；剪掉了、不在时间线上时 null。
 */
export function clipWindow(sequence: Sequence, assetId: Id, clip: SpeakerClip, timescale: number): { start: number; end: number } | null {
  const scale = timescale || 1;
  const placed = projectSpeech(sequence, assetId, [
    { id: clip.sentenceId, start: clip.start / scale, end: clip.end / scale, text: clip.text, paragraphStart: false },
  ]);
  const first = placed[0];
  return first && first.end > first.start ? { start: first.start, end: first.end } : null;
}

export const NAME_MAX = 100;

/** 改名的问题；没问题时 null。 */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return M.nameEmpty;
  if ([...trimmed].length > NAME_MAX) return M.nameTooLong(NAME_MAX);
  return null;
}

/** 提交时的 `names`：只带改过的（去掉首尾空白、与提案不同的）；一个都没改时 undefined。 */
export function changedNames(speakers: readonly ProposedSpeaker[], names: Readonly<Record<Id, string>>): Record<Id, string> | undefined {
  const out: Record<Id, string> = {};
  for (const speaker of speakers) {
    const name = names[speaker.id]?.trim();
    if (name && name !== speaker.name) out[speaker.id] = name;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 应用后的名字：改过的用改过的。 */
export function finalName(speaker: ProposedSpeaker, names: Readonly<Record<Id, string>>): string {
  return names[speaker.id]?.trim() || speaker.name;
}

/** 区分用时：`9.2s`；一分钟以上 `1m 5s`。 */
export function durationText(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

/** 收据（原型 `Receipt`）：`已应用 · 识别出 3 位说话人 · 9.2s · 本机声纹模型`。 */
export function speakersReceiptText(summary: Pick<SpeakersSummary, 'speakers' | 'diarizeMs'>, engine: string): string {
  return M.receipt(summary.speakers.length, durationText(summary.diarizeMs), engine);
}
