import { defineMessages } from '@baocut/protocol';
import { zhHans } from './tool-catalog-copy.zh-Hans.ts';
import { zhHant } from './tool-catalog-copy.zh-Hant.ts';
import { ja } from './tool-catalog-copy.ja.ts';
import { ko } from './tool-catalog-copy.ko.ts';
import { es } from './tool-catalog-copy.es.ts';
import { fr } from './tool-catalog-copy.fr.ts';
import { de } from './tool-catalog-copy.de.ts';
import { nl } from './tool-catalog-copy.nl.ts';
import { ptBR } from './tool-catalog-copy.pt-BR.ts';
import { it } from './tool-catalog-copy.it.ts';
import { ru } from './tool-catalog-copy.ru.ts';
import { pl } from './tool-catalog-copy.pl.ts';
import { tr } from './tool-catalog-copy.tr.ts';
import { vi } from './tool-catalog-copy.vi.ts';

type Artifact = 'audio' | 'image' | 'doc' | 'final' | 'subtitle';

/** 产出条目在英文句子里的说法（小写名词）。 */
const ARTIFACT_NOUN: Record<Artifact, string> = { audio: 'audio', image: 'image', doc: 'document', final: 'video file', subtitle: 'subtitle' };

/** 工具目录的文案：工具名与说明、输入输出的说法、卡片上的结果句（英文是键与类型的来源，译文在 `tool-catalog-copy.<语言>.ts`）。 */
const en = {
  inputLabels: {
    file: 'Local file',
    space: 'Space',
    link: 'Link',
    text: 'Text',
    video: 'Video in Space',
    document: 'Document',
  },
  outputLabels: { video: 'Video', artifact: 'Item in Space' },
  artifactLabels: { audio: 'Audio', image: 'Image', doc: 'Document', final: 'Video file', subtitle: 'Subtitles' },
  tools: {
    transcribe: {
      name: 'Transcribe',
      desc: 'Turn a video or audio file into a transcript and subtitles; for an editable video, writes them into it and adds a subtitle layer',
    },
    'translate-subtitles': {
      name: 'Translate subtitles',
      desc: 'Translate subtitles into another language; for a transcribed video, adds a translation and a subtitle layer that can show both languages, leaving the original untouched',
    },
    dub: {
      name: 'Translated voice-over',
      desc: 'Give a transcribed video a new voice-over from its translation; the original audio can be ducked, muted or kept',
    },
    'synthesize-speech': {
      name: 'Generate speech',
      desc: 'Read text, or documents and subtitles in Space, aloud; use a preset voice, clone a recording or describe a voice',
    },
    'generate-text': {
      name: 'Generate text',
      desc: 'Describe what you need and call a text model directly for copy, scripts or summaries; you can attach documents or subtitles in Space as material',
    },
    'generate-image': {
      name: 'Generate image',
      desc: 'Describe a picture and draw it with a cloud or local image model; reference images, aspect ratio and count are optional',
    },
    'link-import': {
      name: 'Download video',
      desc: 'Paste a link to download a video to this computer; browser cookies can be used, and the download can be transcribed into a transcript and subtitles',
    },
    'compress-video': {
      name: 'Compress video',
      desc: 'Re-encode to a target size or quality; shrink it before sending or uploading',
    },
    'merge-video': {
      name: 'Merge videos',
      desc: 'Join several videos end to end into one file, in order',
    },
    'extract-audio': {
      name: 'Extract audio',
      desc: 'Drop the picture and keep only the audio track; common audio codecs are copied as is, without re-encoding',
    },
  },
  targetNone: 'Only create a transcript and subtitles',
  targetCreate: 'Create a video in a project',
  subtitleFile: 'Local subtitle file',
  groups: {
    speech: {
      label: 'Speech & subtitles',
      desc: 'Transcribe, translate subtitles, add voice-overs and read text aloud. Results are document, subtitle and audio items; choosing an editable video in Space writes into it.',
    },
    'text-image': { label: 'Text & images', desc: 'Call text and image models directly. Results are document and image items.' },
    'video-file': {
      label: 'Video files',
      desc: 'Download, compress and merge videos and extract audio with yt-dlp and ffmpeg on this computer. Results are video file and audio items.',
    },
  },
  /** 产出条目的说法：「文档与字幕条目」「音频条目」。 */
  artifactItems: (artifacts: readonly Artifact[]) => (artifacts.length ? `${artifacts.map((a) => ARTIFACT_NOUN[a]).join(' and ')} items` : 'output items'),
  resultWritesVideo: 'Result: written into the video you choose',
  resultInSpace: (items: string) => `Result: ${items} in Space`,
  resultAlsoCreate: 'can also create a new video',
  resultWritesEditable: 'writes into an editable video when you choose one',
  joinResult: (parts: readonly string[]) => parts.join('; '),
};

export type ToolCatalogMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
