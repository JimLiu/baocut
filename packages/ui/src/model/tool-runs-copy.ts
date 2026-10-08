import { defineMessages } from '@baocut/protocol';
import { zhHans } from './tool-runs-copy.zh-Hans.ts';
import { zhHant } from './tool-runs-copy.zh-Hant.ts';
import { ja } from './tool-runs-copy.ja.ts';
import { ko } from './tool-runs-copy.ko.ts';
import { es } from './tool-runs-copy.es.ts';
import { fr } from './tool-runs-copy.fr.ts';
import { de } from './tool-runs-copy.de.ts';
import { nl } from './tool-runs-copy.nl.ts';
import { ptBR } from './tool-runs-copy.pt-BR.ts';
import { it } from './tool-runs-copy.it.ts';
import { ru } from './tool-runs-copy.ru.ts';
import { pl } from './tool-runs-copy.pl.ts';
import { tr } from './tool-runs-copy.tr.ts';
import { vi } from './tool-runs-copy.vi.ts';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** 视频工具一次运行的文案：进度短语、授权卡、结果页（英文是键与类型的来源，译文在 `tool-runs-copy.<语言>.ts`）。 */
const en = {
  diarizeStep: 'Identify speakers',

  // 进度
  phaseDone: 'Done',
  phaseQueued: 'Queued',
  phaseCancelled: 'Cancelled',
  phaseUnfinished: 'Not finished',
  phasePreparing: 'Preparing',
  stepAt: (cur: number, total: number) => `Step ${cur} of ${total}`,
  cancelledAt: (step: string, at: string) => `Cancelled at “${step}” · ${at}`,
  stoppedAt: (step: string, at: string) => `Stopped at “${step}” · ${at}`,
  runningAt: (step: string, at: string) => `${step} · ${at}`,
  stepDone: 'Done',
  stepStopped: 'Stopped here',
  stepRunning: 'In progress',
  stepWaiting: 'Waiting',

  // 授权卡
  costEstimate: (amount: number | string, currency: string) => `About ${amount} ${currency}`,
  costSubscription: (recipient: string) => `Included in your ${recipient} subscription`,
  costFree: 'Free',
  costMetered: (recipient: string) => `Billed at ${recipient}’s rates; no estimate available here`,
  grantWhat: (kinds: readonly string[], purpose: string) => `${kinds.join(', ')} (${purpose})`,
  grantLoop: 'You already approved these, but the Runtime still refuses. Check these permissions in Settings › Privacy, or switch to another model.',

  noStructuredOutput: 'This model doesn’t support structured output, so it can’t translate',

  // 结果页：字幕层
  captionsCreated: (p: { language: string | null; bilingual: boolean; disabled: boolean }) =>
    `Created ${p.language ? `a ${p.language} subtitle layer` : 'an editable subtitle layer'}${p.bilingual ? ', shown bilingually' : ''}${
      p.disabled ? ' (this asset already shows subtitles, so the new layer starts turned off)' : ''
    }`,
  captionsExistingTranslation: 'This translation already has a subtitle layer, so no new one was created',
  captionsExistingTranscript: 'This transcript already has a subtitle layer, so no new one was created',
  captionsNotOnTimeline: 'No clip on the timeline uses this asset, so no subtitle layer was created',
  captionsEmpty: 'There are no subtitles to show, so no subtitle layer was created',
  originalAudio: { duck: 'Original audio ducked', mute: 'Original audio muted', keep: 'Original audio kept' },

  // 结果页：各流程
  thisVideo: 'this video',
  newVideo: 'New video',
  fallbackVideo: 'Video',
  media: 'media',
  savedFiles: (names: readonly string[]) => `Transcript and subtitles saved: ${names.join(', ')}`,
  transcriptLanguage: (language: string, model: string | null) => `Transcript language: ${language}${model ? ` (${model})` : ''}`,
  createdVideoLinked: (video: string, project: string | null) =>
    `Created video “${video}”${project ? ` in “${project}”` : ''}; the asset stays where it is and is only linked`,
  wroteTranscript: (video: string) => `Added a transcript to “${video}”`,
  speakersFound: (n: number) => `Found ${n} ${plural(n, 'speaker', 'speakers')}; subtitles and transcript are labeled with names`,
  wroteTranslation: (video: string, language: string, source: string | null) =>
    `Added a ${language} translation to “${video}”${source ? ` (from the ${source} transcript)` : ''}; the original is unchanged`,
  unitCount: (n: number) => `${n} ${plural(n, 'sentence', 'sentences')}`,
  subtitleFileWritten: (file: string, dir: string) => `Translated subtitle file ${file} saved in ${dir}; cue count and timecodes unchanged`,
  bilingualLayout: 'Bilingual: original on top, translation below',
  markupStripped: (n: number) => `Removed inline markup from ${n} original ${plural(n, 'cue', 'cues')}`,
  dubTranslated: (language: string) => `Translated into ${language} first: added a new translation`,
  dubReusedTranslation: (language: string) => `Used the existing ${language} translation`,
  dubWritten: (video: string, language: string, engine: string) =>
    `Added a new ${language} voice-over to “${video}”${engine ? ` (${engine})` : ''}; earlier voice-overs are kept`,
  dubPlaced: (placed: number, total: number) => `${placed} of ${total} sentences placed on the timeline`,
  linkCreatedVideo: (video: string, project: string | null) =>
    `Created video “${video}”${project ? ` in “${project}”` : ''}; the downloaded media is on the timeline`,
  linkAddedTo: (file: string, video: string) => `Added ${file} to “${video}”; the file stays in your downloads folder`,
  linkDownloaded: (file: string, dir: string | null) => `Downloaded ${file}${dir ? ` to ${dir}` : ''}`,
  linkTranscribedFiles: 'Transcription done; saved a TXT transcript and SRT subtitles',
  linkTranscribed: 'Transcription done; added a transcript. This path doesn’t create a subtitle layer; you can generate one in the editor’s Subtitles panel',
  replacedTranscript: (video: string) => `Replaced the transcript of “${video}”: one change you can undo`,
  newVideoFrom: (video: string, project: string | null, original: string | null) =>
    `Created video “${video}”${project ? ` in “${project}”` : ''}, linking the same asset; ${original ? `“${original}”` : 'the original video'} and its translations are unchanged`,
  carryTranslation: (language: string, kept: number, reviewed: number, stale: number) =>
    `${language} translation · kept: ${kept} (reviewed: ${reviewed}) · outdated: ${stale}`,
  carryPins: (reanchored: number, orphaned: number) => `Subtitle pins · re-anchored: ${reanchored} · orphaned: ${orphaned}`,
  carryDub: (language: string, kept: number, stale: number) => `${language} voice-over · kept: ${kept} · outdated: ${stale}`,
  nothingToCarry: 'This video had no translations, subtitle pins or voice-overs to carry over',
  refreshHint: 'Retranslate the outdated sentences with “Refresh outdated translations”',
};

export type ToolRunsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
