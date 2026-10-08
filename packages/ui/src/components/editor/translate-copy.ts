import { defineMessages, live, type CapabilityNotConfiguredReason } from '@baocut/protocol';
import { zhTextNotConfigured, zhTranslate } from './translate-copy.zh-Hans.ts';
import { zhHantTextNotConfigured, zhHantTranslate } from './translate-copy.zh-Hant.ts';
import { jaTextNotConfigured, jaTranslate } from './translate-copy.ja.ts';
import { koTextNotConfigured, koTranslate } from './translate-copy.ko.ts';
import { esTextNotConfigured, esTranslate } from './translate-copy.es.ts';
import { frTextNotConfigured, frTranslate } from './translate-copy.fr.ts';
import { deTextNotConfigured, deTranslate } from './translate-copy.de.ts';
import { nlTextNotConfigured, nlTranslate } from './translate-copy.nl.ts';
import { ptBRTextNotConfigured, ptBRTranslate } from './translate-copy.pt-BR.ts';
import { itTextNotConfigured, itTranslate } from './translate-copy.it.ts';
import { ruTextNotConfigured, ruTranslate } from './translate-copy.ru.ts';
import { plTextNotConfigured, plTranslate } from './translate-copy.pl.ts';
import { trTextNotConfigured, trTranslate } from './translate-copy.tr.ts';
import { viTextNotConfigured, viTranslate } from './translate-copy.vi.ts';

const sentences = (n: number) => `${n} sentence${n === 1 ? '' : 's'}`;
const subtitles = (n: number) => `${n} subtitle${n === 1 ? '' : 's'}`;

/**
 * 字幕翻译的文案（设置页、运行态、回执、双语对照）。原型：panel-aitools-flows.jsx `TranslateFlow`、panel-translate.jsx、
 * panel-substrip.jsx、model-trans-run.js。译文在 `translate-copy.zh-Hans.ts`。
 */
const en = {
  // 设置页（TranslateFlow）
  title: 'Translate to a new language',
  back: 'Back to Subtitles',
  target: 'Target language',
  targetPicker: 'Language to translate into',
  source: 'Original',
  sourcePicker: 'Transcript to translate',
  sourceLine: (language: string, count: number | null) => (count === null ? language : `${language} · ${sentences(count)}`),
  model: 'Text model',
  modelPicker: 'Text model for translation',
  manage: 'Manage text models…',
  modelsLoading: 'Loading text models…',
  noStructured: 'No structured output · can’t be used for translation',
  notConfiguredTitle: 'No text model available yet',
  notConfiguredBody:
    'Translation calls a text model batch by batch. In Settings › Models › Text generation, connect a provider (enter its key) and choose a model that supports structured output, then come back to start.',
  goModels: 'Open Settings › Models › Text generation',
  style: 'Style hint',
  stylePlaceholder: 'For example: conversational, concise; keep names in the original',
  styleHint: 'Optional; up to 500 characters.',
  glossary: 'Glossary',
  glossaryNote:
    'Checked = enabled for this video (an edit you can undo). Translation uses enabled glossaries whose direction matches; with many entries, each batch only includes the ones that appear in the original.',
  glossaryManage: 'Manage glossaries…',
  glossaryEmpty: (target: string) => `The glossary library has no translation glossaries into ${target} yet.`,
  glossaryLoading: 'Loading glossaries…',
  glossaryCount: (terms: number, hits: number) => `${terms} ${terms === 1 ? 'entry' : 'entries'} · ${hits} found in this video`,
  glossaryFailed: (message: string) => `Couldn’t read which glossaries this video has enabled: ${message}`,
  glossaryReadOnly: 'The video is read-only, so its enabled glossaries can’t be changed.',
  glossaryLimit: (max: number) => `At most ${max} glossaries can be enabled in one step`,
  glossaryOn: (name: string) => `Enabled “${name}” for this video`,
  glossaryOff: (name: string) => `Disabled “${name}” for this video`,
  glossaryWriteFailed: (message: string) => `Couldn’t change the enabled glossaries: ${message}`,
  bilingual: 'Show both languages',
  bilingualHint:
    'When translation finishes, the original and the translation appear on screen together. When off, only the translation appears and the original is taken off screen (not deleted).',
  cta: (language: string) => `Translate to ${language}`,
  ctaHint: 'When done it’s placed on screen automatically, and you can undo it at any time. Online models are billed by token.',
  noSpeechTitle: 'No transcript to translate yet',
  noSpeech:
    'Translation works sentence by sentence from a transcript. First transcribe an asset with “Generate subtitles” in the Subtitles panel; imported subtitle files have no word timings and can’t be translated directly.',
  busy: 'This video is already being translated; wait for it to finish before starting another language.',
  readOnly: 'The video is read-only, so it can’t be translated.',
  allTaken: 'All common languages already have translations.',

  // 运行态
  submitting: 'Submitting translation',
  queued: 'Queued',
  running: (from: string, to: string) => `Translating · ${from} → ${to}`,
  stepUnits: (done: number, total: number | null) => (total ? `Translated ${done} / ${total} sentences` : `Translated ${sentences(done)}`),
  cancel: 'Cancel translation',
  cancelled: 'Translation cancelled',
  cancelFailed: (message: string) => `Couldn’t cancel translation: ${message}`,
  liveNote: 'When done it’s placed on screen automatically, and you can undo it at any time. You can leave this page.',
  foreign: 'This translation wasn’t started here. When it finishes, use “Place on screen” in the comparison list.',
  agentNote: 'The Agent translates line by line and writes it to the video once done',
  agentSession: 'An Agent session is running this translation. To stop it, stop the session.',
  chipTip: (step: string) => `Translating · ${step}`,

  // 问题
  notConfigured: (reason: string) => `Can’t translate yet · ${reason}`,
  submitFailed: 'Couldn’t start translation',
  failed: 'Translation failed',
  interrupted: 'Translation was interrupted',
  retry: 'Try again',
  retrying: 'Trying again',
  retryFailed: (message: string) => `Couldn’t try again: ${message}`,
  retryCharges: 'Trying again resumes from the step where it stopped. If it stopped at the “Translate” step, the model is called again and you may be billed again.',
  retryFree: 'Trying again resumes from the step where it stopped; finished translations don’t call the model again.',
  dismiss: 'OK',
  decide: 'Resolve in Background tasks',
  emptyTitle: 'The translation has no sentences to place on screen',
  empty: 'All sentences in the translation are out of date or empty.',
  pendingTitle: 'Translation finished but isn’t on screen yet',
  pending: 'The translation is saved in the video. Click “Place on screen” in the comparison list.',
  offTimeline:
    'No clip on the timeline uses this asset, so the subtitles can’t be placed on screen. The translation is saved in the video; click “Place on screen” in the comparison list.',
  badDocument: 'The translation or transcript format isn’t recognized, so it can’t be split into subtitles.',

  // 回执
  applied: (language: string, count: number) => `Applied · translated to ${language} · ${subtitles(count)}`,
  appliedNote: (bilingual: boolean): string =>
    bilingual
      ? 'The original and the translation appear on screen together.'
      : 'Only the translation appears on screen; the original was taken off (not deleted—you can put it back from the strip).',
  undo: 'Undo',
  done: 'Done',
  undone: (language: string) => `Undone · ${language} subtitles removed from the screen`,
  undoneNote: 'The original wasn’t touched; the translation stays in the video, and you can “Place on screen” again from the comparison list.',
  undoFailed: 'Couldn’t undo: the video changed after this step. Undo in the editor.',

  // 放到画面上
  place: 'Place on screen',
  placing: 'Placing on screen',
  unnamed: 'Translation',
  placed: (language: string, count: number) => `Placed the ${language} translation on screen · ${subtitles(count)}`,
  notPlaced: 'This translation isn’t on screen yet.',

  // 对照条与列表
  list: 'List',
  modes: { src: 'Original only', bi: 'Original + translation', trans: 'Translation only' },
  compareLanguage: 'Translation to compare',
  noTranslation: 'No translations yet · use “Translate to…” on the strip first',
  original: (language: string) => `Original · ${language}`,
  translation: (language: string) => `Translation · ${language}`,
  reading: 'Loading translation…',
  unreadable: 'This translation’s format can’t be viewed here yet.',
  speechMissing: 'The transcript for this translation is no longer in the video.',
  stats: (count: number) => sentences(count),
  untranslated: (n: number) => `${sentences(n)} not translated`,
  stale: (n: number) => `${n} translated ${n === 1 ? 'sentence is' : 'sentences are'} out of date`,
  gone: (n: number) => `${n} original ${n === 1 ? 'sentence' : 'sentences'} deleted`,
  allFresh: 'All translations up to date ✓',
  refreshHint: 'Click a translation to edit it directly; edited ones no longer count as out of date. To retranslate just these sentences, hand them off to the Agent:',
  refreshOpen: 'Refresh outdated translations',
  refreshHintWeb: 'Click a translation to edit it directly; edited ones no longer count as out of date.',
  chipStale: 'Out of date',
  chipUntranslated: 'Not translated',
  chipGone: 'Original deleted',
  goneTip: 'This sentence is no longer in the transcript: its translation won’t appear on screen and can’t be edited.',
  emptyPlaceholder: '(No translation yet · click to fill in)',
  editLabel: (n: number) => `Edit the translation of sentence ${n}`,
  editing: 'Translation',
  editHint: 'Click a translated sentence to rewrite it: it saves when you click away, and Esc discards. Subtitles on screen update to match.',
  editTail: 'Click a translation to edit',
  noRows: 'This translation has no sentences yet.',
  edited: 'Rewrote this translated sentence',
  editFailed: (message: string) => `Couldn’t rewrite: ${message}`,
  seekTip: 'Move the playhead to this sentence',
  cutTip: 'The footage for this sentence has been cut',
  translateTo: (language: string) => `Translate to ${language}`,
  rewriteTranslation: 'Edit translation',
  unknownLanguage: 'Unknown language',
  targetLanguage: 'the target language',
};

export type TranslateMessages = typeof en;
export const TRANSLATE_COPY = defineMessages(en, { 'zh-Hans': zhTranslate, 'zh-Hant': zhHantTranslate, ja: jaTranslate, ko: koTranslate, es: esTranslate, fr: frTranslate, de: deTranslate, nl: nlTranslate, 'pt-BR': ptBRTranslate, it: itTranslate, ru: ruTranslate, pl: plTranslate, tr: trTranslate, vi: viTranslate });

/** `CAPABILITY_NOT_CONFIGURED` 的原因（协议 `CapabilityNotConfiguredReason`），翻译用的是文本生成。 */
const notConfigured: Record<CapabilityNotConfiguredReason, string> = {
  'no-default': 'No model chosen for text generation yet',
  'missing-credential': 'The text model’s provider has no key yet',
  'not-installed': 'The text model isn’t installed yet',
  'signed-out': 'The agent isn’t signed in yet',
  outdated: 'The agent’s version is too old',
  'not-paired': 'The remote node isn’t paired yet',
  'not-connected': 'The remote node isn’t connected',
  unsupported: 'The chosen service doesn’t support text generation',
  disabled: 'The text generation service is turned off',
};

export type TextNotConfiguredMessages = typeof notConfigured;
const NOT_CONFIGURED = defineMessages({ reasons: notConfigured }, { 'zh-Hans': { reasons: zhTextNotConfigured }, 'zh-Hant': { reasons: zhHantTextNotConfigured }, ja: { reasons: jaTextNotConfigured }, ko: { reasons: koTextNotConfigured }, es: { reasons: esTextNotConfigured }, fr: { reasons: frTextNotConfigured }, de: { reasons: deTextNotConfigured }, nl: { reasons: nlTextNotConfigured }, 'pt-BR': { reasons: ptBRTextNotConfigured }, it: { reasons: itTextNotConfigured }, ru: { reasons: ruTextNotConfigured }, pl: { reasons: plTextNotConfigured }, tr: { reasons: trTextNotConfigured }, vi: { reasons: viTextNotConfigured } });
export const TEXT_NOT_CONFIGURED_REASON: Record<CapabilityNotConfiguredReason, string> = live(() => NOT_CONFIGURED.reasons);
