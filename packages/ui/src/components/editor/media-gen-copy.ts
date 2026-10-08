import { defineMessages } from '@baocut/protocol';
import { zhAudioGen, zhImageGen, zhMark } from './media-gen-copy.zh-Hans.ts';
import { zhHantAudioGen, zhHantImageGen, zhHantMark } from './media-gen-copy.zh-Hant.ts';
import { jaAudioGen, jaImageGen, jaMark } from './media-gen-copy.ja.ts';
import { koAudioGen, koImageGen, koMark } from './media-gen-copy.ko.ts';
import { esAudioGen, esImageGen, esMark } from './media-gen-copy.es.ts';
import { frAudioGen, frImageGen, frMark } from './media-gen-copy.fr.ts';
import { deAudioGen, deImageGen, deMark } from './media-gen-copy.de.ts';
import { nlAudioGen, nlImageGen, nlMark } from './media-gen-copy.nl.ts';
import { ptBRAudioGen, ptBRImageGen, ptBRMark } from './media-gen-copy.pt-BR.ts';
import { itAudioGen, itImageGen, itMark } from './media-gen-copy.it.ts';
import { ruAudioGen, ruImageGen, ruMark } from './media-gen-copy.ru.ts';
import { plAudioGen, plImageGen, plMark } from './media-gen-copy.pl.ts';
import { trAudioGen, trImageGen, trMark } from './media-gen-copy.tr.ts';
import { viAudioGen, viImageGen, viMark } from './media-gen-copy.vi.ts';

/**
 * 素材面板里「生成语音 / 克隆声音」与「AI 生成」的文案（设计稿 panel-tts.jsx、panel-image-gen.jsx、panel-media.jsx 原文；
 * 本机引擎、注音、情绪、按句放到时间轴这些这一版没有合同的不搬）。与工具页共用的句子直接用 tools-copy.ts。
 * 译文在 `media-gen-copy.zh-Hans.ts`。
 */

const audio = {
  generate: 'Generate speech',
  clone: 'Clone voice',
  generateTip: 'Read text aloud with a cloud model and add it to the asset library',
  cloneTip: 'Read text with a voice cloned in My voices',
  back: 'Back to Audio',
  running: 'Running in the background',
  textPlaceholder: 'Text to synthesize; split into segments at periods or line breaks…',
  clonePlaceholder: 'What this voice should say…',
  cta: 'Generate',
  cloneCta: 'Generate with this voice',
  hint: (provider: string) =>
    `Sent online to ${provider} for synthesis and billed by its rules. Progress shows in the top bar and Background tasks; when done it’s added to the asset library—placing it on the timeline is a separate step. Stopping the wait doesn’t recall a request already sent.`,
  readOnly: 'This video is read-only right now, so assets can’t be generated into it',
  noVoicesTitle: 'No voices in My voices yet',
  noVoicesBody:
    'To clone a voice, first record one or import it from a file in Models › Speech synthesis › My voices, then upload it to a provider that can clone voices (ElevenLabs). Come back and pick it from the voices below.',
  goVoices: 'Open My voices',
  runTitle: (title: string) => `${title}…`,
  runNote: 'You can keep editing · synthesis runs in the background and is added to the asset library when done.',
  cancel: 'Cancel',
  cancelled: 'Cancelled',
  done: (meta: string) => `Generated · ${meta}`,
  inLibrary: (name: string) => `Added to the asset library · ${name}`,
  importing: 'Adding to the asset library…',
  add: 'Add to timeline',
  addTip: 'Place at the playhead',
  again: 'Generate another',
  backToAudio: 'Back to Audio',
  doneNote: 'The asset is in the Audio library, marked “Generated”. Drag it to the timeline or click “+” to place it; you can use it as many times as you like.',
  failed: (message: string) => `Couldn’t generate · ${message}`,
  edit: 'Edit and generate again',
  retried: 'Resubmitted',
};

export type AudioGenMessages = typeof audio;
export const AUDIO_GEN_COPY = defineMessages(audio, { 'zh-Hans': zhAudioGen, 'zh-Hant': zhHantAudioGen, ja: jaAudioGen, ko: koAudioGen, es: esAudioGen, fr: frAudioGen, de: deAudioGen, nl: nlAudioGen, 'pt-BR': ptBRAudioGen, it: itAudioGen, ru: ruAudioGen, pl: plAudioGen, tr: trAudioGen, vi: viAudioGen });

const image = {
  title: 'Images',
  segments: 'Image source',
  project: 'Video assets',
  gen: 'AI generated',
  noModelTitle: 'No image model yet',
  noModelBody:
    'Connect a cloud provider (Models › Image generation › Cloud models) or download Qwen-Image-2.1 (Models › Image generation › Local models)—either one works.',
  connect: 'Connect a cloud provider',
  downloadLocal: 'Download local model',
  fit: 'Same as the video canvas',
  recent: 'Recent',
  all: (n: number) => `All ${n} ${n === 1 ? 'batch' : 'batches'}`,
  fewer: 'Only the last 3 batches',
  empty: 'No images have been generated for this video yet. Generated images go straight into the asset library (marked “Generated”); placing them on the canvas is a separate step.',
  place: 'Place on canvas',
  placeTip: 'Place at the playhead',
  inLibrary: 'In the asset library',
  importing: 'Adding to the asset library…',
  useAsRef: 'Use as reference',
  foot: 'Generated images go straight into this video’s asset library, with their origin (model, parameters, task) recorded with the asset; the prompt stays only in the task record. Placing them on the canvas is a separate step.',
  readOnly: 'This video is read-only right now, so assets can’t be generated into it',
  charCount: (chars: number, max: number) => `${chars} / ${max} characters`,
  charCountPlain: (chars: number) => `${chars} ${chars === 1 ? 'character' : 'characters'}`,
};

export type ImageGenMessages = typeof image;
export const IMAGE_GEN_COPY = defineMessages(image, { 'zh-Hans': zhImageGen, 'zh-Hant': zhHantImageGen, ja: jaImageGen, ko: koImageGen, es: esImageGen, fr: frImageGen, de: deImageGen, nl: nlImageGen, 'pt-BR': ptBRImageGen, it: itImageGen, ru: ruImageGen, pl: plImageGen, tr: trImageGen, vi: viImageGen });

const mark = { generated: 'Generated' };
export type GeneratedMarkMessages = typeof mark;
const MARK = defineMessages(mark, { 'zh-Hans': zhMark, 'zh-Hant': zhHantMark, ja: jaMark, ko: koMark, es: esMark, fr: frMark, de: deMark, nl: nlMark, 'pt-BR': ptBRMark, it: itMark, ru: ruMark, pl: plMark, tr: trMark, vi: viMark });

/** 素材卡上生成来的那一枚标记。 */
export const generatedMark = () => MARK.generated;
