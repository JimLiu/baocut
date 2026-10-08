import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './dub.zh-Hans.ts';
import { zhHant } from './dub.zh-Hant.ts';
import { ja } from './dub.ja.ts';
import { ko } from './dub.ko.ts';
import { es } from './dub.es.ts';
import { fr } from './dub.fr.ts';
import { de } from './dub.de.ts';
import { nl } from './dub.nl.ts';
import { ptBR } from './dub.pt-BR.ts';
import { it } from './dub.it.ts';
import { ru } from './dub.ru.ts';
import { pl } from './dub.pl.ts';
import { tr } from './dub.tr.ts';
import { vi } from './dub.vi.ts';

/** `packages/jobs/src/pipelines/dub.ts`：「翻译配音」流程的名字、步骤、参数与运行时的错误、警告，以及写进视频的名字。 */
const en = {
  label: 'Translated voice-over',
  description:
    'Voices a transcript in the video in another language: translates it first if there is no translation, synthesizes speech sentence by sentence, aligns it to the timing of the original sentences, and applies it to the video as a voice-over group (one voice-over track). No agent is started.',
  stepFreezeSource: 'Read source',
  stepTranslate: 'Translate',
  stepAssemble: 'Assemble translation',
  stepWrite: 'Write translation',
  stepCheck: 'Check translation',
  stepSeparate: 'Separate vocals and background',
  stepSynthesize: 'Synthesize sentences',
  stepAlign: 'Align timing',
  stepApply: 'Apply voice-over',
  // 参数
  regroupConflict: (p: { params: string }) =>
    `Sentence re-voicing (regroup) takes the translation, language, voice, and original audio handling from that group's voice-over plan, so it can't be combined with ${p.params}`,
  orTranslationId: 'or translationId must be given',
  translationIdNoTranslate: "With translationId nothing is translated, so style, glossary, glossaries, textProvider, and textModel don't apply",
  mustBeBooleanValue: 'must be a boolean',
  mustBeObject: 'must be an object',
  unitsCount: (p: { max: number }) => `must have 1 to ${p.max} translation unit IDs`,
  mustBeUnique: "can't contain duplicates",
  seedInvalid: (p: { max: number }) => `must be 'new' or an integer from 0 to ${p.max}`,
  // 准备
  videoNotOpen: "The video isn't open",
  translationFromOther: (p: { translationId: string; from: string; expected: string }) =>
    `Translation ${p.translationId} was translated from ${p.from}, not ${p.expected}`,
  translationLanguage: (p: { translationId: string; language: string; expected: string }) =>
    `Translation ${p.translationId} is in ${p.language}, not ${p.expected}`,
  noDocument: (p: { documentId: string }) => `The video has no document ${p.documentId}`,
  notTranslation: (p: { documentId: string; kind: string }) => `Document ${p.documentId} is ${p.kind}, not a translation`,
  translationNotUsable: (p: { translationId: string; schema: string }) =>
    `Translation ${p.translationId} isn't ${p.schema}, so it can't be used for voice-over`,
  noPlan: (p: { groupId: string }) => `The video has no voice-over plan for this voice-over group (${p.groupId})`,
  groupGone: (p: { groupId: string }) => `This voice-over group (${p.groupId}) no longer has any items on the timeline`,
  planNoTranslation: "The voice-over plan doesn't record a translation",
  unitsNotInPlan: (p: { count: number; units: string }) =>
    `${p.count} sentences aren't in this voice-over group's plan or translation: ${p.units}`,
  planNoVoice: "The voice-over plan doesn't record the provider, model, and voice used for synthesis",
  seedNotAccepted: (p: { model: string }) => `Model ${p.model} doesn't accept a seed`,
  // 核对译文
  videoClosed: 'The video was closed',
  translationGone: 'The translation document is no longer in the video',
  translationNotSchema: (p: { schema: string }) => `The translation isn't ${p.schema}`,
  translationNotFromTranscript: "The translation wasn't made from this transcript",
  unitMissingIds: 'The translation has units without an id or sourceSentenceId',
  separationNotConfigured:
    'Separating vocals and background was requested, but no separation capability (separateAudio) is configured. This step is skipped and the original audio is handled as is',
  unitsStale: (p: { count: number }) =>
    `${p.count} translated sentences are out of date (the source or glossary changed, or they were marked out of date) and weren't synthesized`,
  nothingToDub: 'The translation has no sentences to voice over: all of them are out of date or empty',
  // 分离人声与背景
  separationUnavailable: 'Separating vocals and background is no longer available',
  noSourceAsset: "The transcript has no source asset, so it can't be separated",
  sourceAssetMissing: "The transcript's source asset isn't available",
  separationInvalid: "The separation output doesn't meet the contract",
  inputNoAudio: 'The input has no audio',
  stemNoAudio: (p: { name: string }) => `${p.name} has no audio`,
  stemSampleRate: (p: { name: string; rate: number; input: number }) =>
    `The sample rate of ${p.name} (${p.rate}) differs from the input's (${p.input})`,
  stemDuration: (p: { name: string; duration: number; input: number }) =>
    `${p.name} is ${p.duration} seconds long; the input is ${p.input} seconds`,
  // 逐句合成
  sentenceJob: (p: { n: number }) => `Sentence ${p.n}`,
  audioUndecodable: "The synthesized audio can't be decoded",
  outputNoAudio: 'The synthesized output has no audio',
  synthesisStopped: (p: { cause: string; synthesized: number; remaining: number }) =>
    `${p.cause}. ${p.synthesized} sentences were synthesized and ${p.remaining} remain; trying again synthesizes only the rest`,
  synthesisFailed: (p: { failed: number; synthesized: number }) =>
    `${p.failed} sentences failed to synthesize. The ${p.synthesized} that succeeded are kept; trying again synthesizes only the failed ones`,
  voicesUnavailableAll: (p: { speakers: string }) =>
    `The voices bound to the speakers (${p.speakers}) aren't available, so no sentence could be synthesized. Fix the voices (clone them again or add the consent statement), then try again`,
  voicesUnavailable: (p: { count: number; speakers: string }) =>
    `${p.count} sentences weren't synthesized because the voices bound to their speakers (${p.speakers}) aren't available; no other voice was used instead`,
  // 时间对齐
  mutedUnvoiced: (p: { count: number }) =>
    `${p.count} muted items also contain sentences that weren't synthesized because their voice isn't available; the original audio of those sentences was muted too`,
  unitsOverlong: (p: { count: number; tempo: number }) =>
    `${p.count} sentences still don't fit after speeding up to ${p.tempo}× and using the silence that follows, so they weren't placed on the timeline (the script needs rewriting)`,
  unitsOffTimeline: (p: { count: number }) =>
    `The original sentences of ${p.count} translated sentences are no longer on the timeline, so they weren't placed`,
  nothingPlaced: 'No voice-over sentence fits on the timeline',
  artifactGone: (p: { artifactId: string }) => `Output ${p.artifactId} no longer exists`,
  stretchNoAudio: 'No audio after changing the speed',
  // 应用
  videoClosedKept: 'The video was closed; the synthesized audio is kept in the outputs',
  videoChanged:
    'The video changed after alignment, so nothing was applied. Trying again realigns to the current timeline (the synthesized audio is reused)',
  sequenceGone: 'The sequence no longer exists',
  backgroundMuted:
    "The original audio was muted. If it mixes voices, music, and ambient sound, the background is gone too (the background wasn't separated)",
  noTrackOrPlanId: "Didn't get the ID of the voice-over track or voice-over plan after applying",
  applyRejected: 'The voice-over transaction was rejected; the synthesized audio is kept in the outputs',
  planGone: "This voice-over group's plan is no longer in the video",
  regroupRejected: 'The transaction to regenerate the voice-over was rejected; the synthesized audio is kept in the outputs',
  planNotSchema: (p: { schema: string }) => `The voice-over plan isn't ${p.schema}`,
  // 写进视频的名字与事务 label
  transactionLabel: (p: { language: string }) => `Voice-over (${p.language})`,
  regroupLabel: (p: { language: string }) => `Regenerate voice-over (${p.language})`,
  trackName: (p: { language: string }) => `Voice-over (${p.language})`,
  assetName: (p: { language: string; n: number }) => `Voice-over (${p.language}) sentence ${p.n}`,
  takeAssetName: (p: { language: string; n: number; k: number }) => `Voice-over (${p.language}) sentence ${p.n} · take ${p.k}`,
  itemName: (p: { n: number }) => `Voice-over ${p.n}`,
  backgroundName: (p: { language: string }) => `Background (${p.language})`,
  vocalsName: (p: { language: string }) => `Vocals (${p.language})`,
  planName: (p: { language: string }) => `Voice-over plan (${p.language})`,
  duckingName: (p: { language: string }) => `Voice-over (${p.language}) ducks the original audio`,
};

export type JobsDubMessages = typeof en;

export const JobsDub = defineCatalog('jobsDub', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
