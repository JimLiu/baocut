import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './link-import.zh-Hans.ts';
import { zhHant } from './link-import.zh-Hant.ts';
import { ja } from './link-import.ja.ts';
import { ko } from './link-import.ko.ts';
import { es } from './link-import.es.ts';
import { fr } from './link-import.fr.ts';
import { de } from './link-import.de.ts';
import { nl } from './link-import.nl.ts';
import { ptBR } from './link-import.pt-BR.ts';
import { it } from './link-import.it.ts';
import { ru } from './link-import.ru.ts';
import { pl } from './link-import.pl.ts';
import { tr } from './link-import.tr.ts';
import { vi } from './link-import.vi.ts';

/** `packages/jobs/src/pipelines/link-import.ts` 给人看的文字。 */
const en = {
  languageTag: "must be a BCP 47 language tag",
  requiresTranscribe: "can only be given with transcribe",
  noVideoDiarize: "Without a video target, only standalone transcripts are written; speakers cannot be separated",
  noVideoCaptions: "Subtitle layers are not created without a video target",
  notWrittenToVideo: "Transcription finished but was not written into the video",

  label: 'Download video',
  description: 'Download a video to a folder with yt-dlp, optionally transcribing it to TXT and SRT. Project ownership and the save folder are independent; the older protocol still accepts a video import target. Requires installing yt-dlp and agreeing to its use.',
  offlineStrict: "Links aren't downloaded in strict offline mode",
  cannotCreateVideo: "This Runtime can't create videos",
  cannotTranscribe: "This Runtime can't transcribe",
  fileTranscribeUnavailable: 'File transcription is unavailable',
  videoNotOpen: 'The video is not open',
  sourceExpired: 'The original link is no longer available: start a new import',
  stepResolve: 'Resolve link',
  stepDownload: 'Download',
  stepVerify: 'Check that it decodes',
  stepPublish: 'Move to download folder',
  stepCreate: 'Create video',
  stepImport: 'Import into video',
  stepTranscribe: 'Transcribe',
  undecodable: "The downloaded file can't be decoded",
  noStreams: 'The downloaded file has neither picture nor sound',
  undecodableRemedy: 'The file from the source is incomplete or in an unsupported format: try again, or try another format (audioOnly)',
  noMediaFile: "The download tool didn't leave a media file",
  destinationUnwritable: (p: { dir: string }) => `Can't write to the save folder: ${p.dir}`,
  destinationRemedy:
    "Check that the save folder (the Downloads folder is setting downloads.directory; in a project it's the project's downloads/) exists and is writable",
  publishedOutside: 'The published file is outside the save folder',
  diskFull: 'Not enough disk space for the download folder',
  unsupportedBrowser: 'is not a supported browser',
  browserItems: 'must contain only supported browsers',
  noDuplicates: "can't contain duplicates",
  saveToInvalid: 'must be downloads or project',
  languageItems: 'must contain only language codes (for example en, zh-Hans)',
  projectMismatch: "doesn't match the project in target.create",
  conversationMismatch: "doesn't match the conversation in target.create",
};

export type JobsLinkImportMessages = typeof en;

export const JobsLinkImport = defineCatalog('jobsLinkImport', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
