import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './tool-catalogue.zh-Hans.ts';
import { zhHant } from './tool-catalogue.zh-Hant.ts';
import { ja } from './tool-catalogue.ja.ts';
import { ko } from './tool-catalogue.ko.ts';
import { es } from './tool-catalogue.es.ts';
import { fr } from './tool-catalogue.fr.ts';
import { de } from './tool-catalogue.de.ts';
import { nl } from './tool-catalogue.nl.ts';
import { ptBR } from './tool-catalogue.pt-BR.ts';
import { it } from './tool-catalogue.it.ts';
import { ru } from './tool-catalogue.ru.ts';
import { pl } from './tool-catalogue.pl.ts';
import { tr } from './tool-catalogue.tr.ts';
import { vi } from './tool-catalogue.vi.ts';

/** `packages/jobs/src/tool-catalogue.ts`：工具目录里每个工具的名字与说明（`ToolDefinition.label` / `description`）。 */
const en = {
  transcribeLabel: 'Transcribe',
  transcribeDescription:
    'Transcribe a local media file or a video in the Space. For a video, writes a new transcript and creates a subtitle layer; for a file only, writes TXT and SRT to the save location, or can create a new video.',
  translateSubtitlesLabel: 'Translate subtitles',
  translateSubtitlesDescription:
    "Translate a video's transcript sentence by sentence into another language and write it into the video as a new translation. Can also translate an SRT / VTT subtitle file (a local file or a subtitle item in the Space) into a new subtitle file.",
  dubLabel: 'Translated voice-over',
  dubDescription:
    'Synthesize speech in the target language sentence by sentence from the transcript (translating first if there is no translation), align the timing, and write it into the video as a new voice-over group.',
  synthesizeSpeechLabel: 'Generate speech',
  synthesizeSpeechDescription:
    'Synthesize speech from a piece of text; the result is an audio output. Can also read a document or subtitle item in the Space (subtitles without timecodes).',
  generateTextLabel: 'Generate text',
  generateTextDescription:
    'Generate text from a prompt (optionally following a JSON Schema); the result is a text output. Documents or subtitle items in the Space can be attached as material.',
  generateImageLabel: 'Generate image',
  generateImageDescription: 'Generate an image from a description; the result is an image output.',
  linkImportLabel: 'Download video',
  linkImportDescription:
    'Download a video to this computer with yt-dlp. Browser cookies can be used, and the download can be transcribed into a transcript and subtitles.',
  compressVideoLabel: 'Compress video',
  compressVideoDescription:
    "Compress video files one by one: file to file, no video is created, and outputs don't overwrite existing files.",
  mergeVideoLabel: 'Merge videos',
  mergeVideoDescription:
    "Merge several video files into one, in order: file to file, no video is created, and outputs don't overwrite existing files.",
  extractAudioLabel: 'Extract audio',
  extractAudioDescription:
    "Take the audio track out of a video or audio file. Codecs that fit a common container are copied as is; others are re-encoded to AAC. File to file, no video is created, and outputs don't overwrite existing files.",
};

export type JobsToolCatalogueMessages = typeof en;

export const JobsToolCatalogue = defineCatalog('jobsToolCatalogue', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
