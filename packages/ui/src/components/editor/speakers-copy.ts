import { defineMessages } from '@baocut/protocol';
import { zhHans } from './speakers-copy.zh-Hans.ts';
import { zhHant } from './speakers-copy.zh-Hant.ts';
import { ja } from './speakers-copy.ja.ts';
import { ko } from './speakers-copy.ko.ts';
import { es } from './speakers-copy.es.ts';
import { fr } from './speakers-copy.fr.ts';
import { de } from './speakers-copy.de.ts';
import { nl } from './speakers-copy.nl.ts';
import { ptBR } from './speakers-copy.pt-BR.ts';
import { it } from './speakers-copy.it.ts';
import { ru } from './speakers-copy.ru.ts';
import { pl } from './speakers-copy.pl.ts';
import { tr } from './speakers-copy.tr.ts';
import { vi } from './speakers-copy.vi.ts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** AI 工具「识别说话人」的文案（原型 panel-aitools-flows.jsx `SpeakerFlow`、tool-setup.jsx `ToolSetup`）。译文在 `speakers-copy.zh-Hans.ts`。 */
const en = {
  title: 'Identify speakers',
  back: 'Back',
  background: 'Running in the background',

  // 设置
  cardTitle: 'Tell who is speaking',
  cardBody: 'Re-identifies speakers by voiceprint and labels the subtitles and transcript with names. You review the result first; nothing changes until you apply it.',
  who: 'Use',
  local: 'On-device voiceprint model',
  localSub: 'Stays on this computer',
  agent: 'Hand off to the Agent',
  agentSub: 'Runs in this video’s session',
  scope: 'Scope',
  scopeAll: 'Whole video',
  scopeLocal: (scope: string) => `On-device identification covers the whole video; to identify only “${scope}”, hand it off to the Agent.`,
  packHint: (size: string | null) =>
    `The on-device voiceprint model${size ? ` (about ${size})` : ''} downloads on first run and works offline after that.`,
  packDownloading: (pct: number | null) =>
    `Downloading the on-device voiceprint model${pct === null ? '…' : ` · ${pct}%`}; identification starts when it finishes.`,
  packUnlisted: 'No on-device voiceprint model is available on this computer; only the Agent can do this.',
  noSpeech: 'This video hasn’t been transcribed yet. Transcribe it in the Subtitles panel first, then identify speakers.',
  manySpeech: 'The video has several transcripts; the first one is used',
  start: 'Start',
  startHint: 'When it finishes, a review page opens—this is the only tool you confirm before it applies.',
  agentHint: 'Sends this request to the video’s session, and the Agent starts right away.',
  readOnly: 'The video is read-only, so speakers can’t be identified.',
  web: 'Speakers can’t be identified in the browser',
  webBody: 'Identifying speakers uses the on-device voiceprint model on this computer. Use the BaoCut desktop app.',

  // 运行
  submitting: 'Submitting…',
  queued: 'Queued…',
  running: 'Identifying speakers…',
  activity: (stage: string) => `On-device voiceprint model · ${stage}`,
  runNote: 'You can keep editing · identification runs in the background and opens a review page when done; it won’t change the transcript directly.',
  cancel: 'Cancel',
  cancelled: 'Speaker identification cancelled',
  cancelFailed: (message: string) => `Couldn’t cancel: ${message}`,

  // 确认
  found: (n: number) =>
    `Found ${plural(n, 'speaker', 'speakers')}. Listen to the samples to confirm who’s who, click a name to rename, then apply.`,
  same: 'Speaker boundaries match the current labels; applying only changes names.',
  newSpeaker: 'New',
  rename: 'Rename',
  renameLabel: (name: string) => `Rename “${name}”`,
  sentences: (n: number) => plural(n, 'sentence', 'sentences'),
  clipOff: 'This sentence was cut and isn’t on the timeline',
  splitTitle: (n: number) => `${plural(n, 'translation', 'translations')} will be re-split; no retranslation needed`,
  splitBody: 'Changing speaker boundaries only affects how subtitle lines are split—the translated text stays the same.',
  skipped: (n: number) =>
    `${plural(n, 'translation', 'translations')} in an older format won’t be re-split; after applying, their sentences won’t line up and they’ll be marked out of date.`,
  apply: 'Apply',
  applyHint: 'You can undo this at any time after applying.',
  discard: 'Discard this result',

  // 收据
  engine: 'On-device voiceprint model',
  undoneReceipt: 'Undone · speaker labels restored',
  undo: 'Undo',
  redo: 'Redo',
  again: 'Run again',
  done: 'Done',
  splitDone: (n: number) => `${plural(n, 'translation was', 'translations were')} re-split at the new speaker boundaries—no retranslation.`,
  undoneTitle: 'Undone',
  undoneBody: '“Run again” starts over—your identification settings are kept.',
  captionsStale: (n: number) =>
    n === 1 ? '1 subtitle track was made from an older transcript and wasn’t updated.' : `${n} subtitle tracks were made from an older transcript and weren’t updated.`,
  gotoCaptions: 'Open Subtitles',
  noUndo: 'Nothing to undo: the result matches the current labels.',
  undoFailed: 'Couldn’t undo',
  redoFailed: 'Couldn’t redo',

  // 问题
  failed: 'Speaker identification failed',
  interrupted: 'Speaker identification was interrupted',
  submitFailed: 'Couldn’t start speaker identification',
  applyFailed: 'Couldn’t apply the result',
  applyStale: 'The transcript or translations changed after identification. Run it again, then apply.',
  badResult: 'The result couldn’t be read. Run it again.',
  retry: 'Try again',
  decide: 'Resolve in Background tasks',
  dismiss: 'OK',
  chapterScope: (n: number, label: string) => `Chapter ${n} · ${label}`,
  manySpeechNamed: (name: string) => `The video has several transcripts; using the first one, “${name}”`,
};

export type SpeakersMessages = typeof en;
export const SPEAKERS_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
