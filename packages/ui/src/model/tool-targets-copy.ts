import { defineMessages } from '@baocut/protocol';
import { zhHans } from './tool-targets-copy.zh-Hans.ts';
import { zhHant } from './tool-targets-copy.zh-Hant.ts';
import { ja } from './tool-targets-copy.ja.ts';
import { ko } from './tool-targets-copy.ko.ts';
import { es } from './tool-targets-copy.es.ts';
import { fr } from './tool-targets-copy.fr.ts';
import { de } from './tool-targets-copy.de.ts';
import { nl } from './tool-targets-copy.nl.ts';
import { ptBR } from './tool-targets-copy.pt-BR.ts';
import { it } from './tool-targets-copy.it.ts';
import { ru } from './tool-targets-copy.ru.ts';
import { pl } from './tool-targets-copy.pl.ts';
import { tr } from './tool-targets-copy.tr.ts';
import { vi } from './tool-targets-copy.vi.ts';

/** 视频工具选择器的文案：标注、置灰原因、「不覆盖」提示、可选的译文（英文是键与类型的来源，译文在 `tool-targets-copy.<语言>.ts`）。 */
const en = {
  unknownLanguage: 'Unknown language',
  langCount: (label: string, count: number) => `${label} ×${count}`,
  joinLangs: (labels: readonly string[]) => labels.join(', '),
  tagTranscript: (langs: string) => `Transcript · ${langs}`,
  tagTranslation: (langs: string) => `Translation · ${langs}`,
  tagDub: (langs: string) => `Voice-over · ${langs}`,
  tagPending: 'Still reading the content; a transcript will be picked when it starts',
  blockTranscribing: 'Transcribing now; you can re-transcribe when it finishes',
  blockQueued: 'Already queued for transcription',
  blockTranscribingWait: 'Transcribing now; you can choose it when it finishes',
  blockQueuedWait: 'Queued for transcription; you can choose it once it’s transcribed',
  blockFailed: 'The last transcription failed; transcribe it again first',
  blockNoTranscript: 'No transcript yet; transcribe it first',
  duplicateTranscript: (langs: string) =>
    `This video already has a ${langs} transcript. By default a new video is created, and this video and its translations stay as they are. Choosing “Replace this video’s transcript” swaps the current transcript: translations carry over by matching the source, sentences whose source changed are marked outdated, and it’s one change you can undo.`,
  duplicateTranslation: (lang: string) =>
    `This video already has a ${lang} translation. This adds another one and keeps the existing one; choose which to use in the editor.`,
  duplicateDub: (lang: string) => `This video already has a ${lang} voice-over. This adds another set and keeps the existing one.`,
  duplicateTitle: {
    transcribe: 'This video already has a transcript',
    'translate-subtitles': 'Existing translations are kept',
    dub: 'Existing voice-overs are kept',
  },
  translationOption: (lang: string, nth: number | null) => `${lang} translation${nth === null ? '' : ` #${nth}`}`,
  translatedFrom: (lang: string) => `From the ${lang} transcript`,
  /** 重新转录的落点（产品设计：重新转录；术语表「落点」）。 */
  destNewVideo: 'New video',
  destNewVideoNote: 'A new video in the same project that links the same asset; this video and its translations stay as they are',
  destReplace: 'Replace this video’s transcript',
  destReplaceNote:
    'Swaps out the current transcript; translations, subtitles and voice-overs carry over in the same change, which you can undo',
  /** 新建视频的默认名，与 Runtime 的 `retranscribedName` 一致。 */
  newVideoName: (name: string) => `${name} · Re-transcribed`,
  impactTranslation: (lang: string, units: number) => `${lang} · ${units} ${units === 1 ? 'sentence' : 'sentences'}`,
  impactDub: (lang: string, groups: number) =>
    `${lang} · ${groups} ${groups === 1 ? 'set' : 'sets'} · voice-overs of sentences whose translation is unchanged are kept and marked as possibly out of sync`,
  impactRule:
    'Sentences whose source is unchanged keep their translation and review status, aligned by sentence; sentences whose source changed or can’t be matched are marked outdated, to be retranslated with “Refresh outdated translations” afterwards. The exact counts are in the result.',
  impactUndo: 'One change, which you can undo',
};

export type ToolTargetsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
