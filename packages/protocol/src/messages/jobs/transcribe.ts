import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './transcribe.zh-Hans.ts';
import { zhHant } from './transcribe.zh-Hant.ts';
import { ja } from './transcribe.ja.ts';
import { ko } from './transcribe.ko.ts';
import { es } from './transcribe.es.ts';
import { fr } from './transcribe.fr.ts';
import { de } from './transcribe.de.ts';
import { nl } from './transcribe.nl.ts';
import { ptBR } from './transcribe.pt-BR.ts';
import { it } from './transcribe.it.ts';
import { ru } from './transcribe.ru.ts';
import { pl } from './transcribe.pl.ts';
import { tr } from './transcribe.tr.ts';
import { vi } from './transcribe.vi.ts';

/** `packages/jobs/src/pipelines/transcribe.ts` 给人看的文字。 */
const en = {
  label: 'Transcribe',
  description:
    'Transcribe an asset in a video (or create a video and import a local media file), writing a transcript and creating a subtitle layer. If the video already has a transcript of that asset, the result goes into a new video (default) or replaces the transcript, carrying over translations, subtitles and dubbing. Given only a file, no video is created and TXT and SRT are written to the save location.',
  cannotCreateVideo: "This Runtime can't create videos",
  videoNotOpen: 'The video is not open',
  stepCreate: 'Create video',
  stepTranscribe: 'Transcribe',
  importMediaLabel: 'Import media',
  fileExcludesVideo: "can't be combined with videoId or target",
  assetIdWithFile: "can't be given with a file: the file itself is transcribed",
  captionsWithFile: "doesn't apply to a file: without a video there's no subtitle layer",
  diarizeWithFile: "doesn't apply to a file: speakers aren't separated",
  outDirFileOnly: 'can only be given with a file',
  assetIdWithCreate: "can't be given when creating a video: the imported media is transcribed",
  needVideoOrFile: 'Give one of videoId, target, or file',
  createMediaRequired: 'is required: the media file to import and transcribe in the new video',
  fileShape: 'must be an absolute path or { entryId }',
  cannotTranscribeFile: "This Runtime can't transcribe files without a video",
  mediaToTranscribeNotFound: "Can't find the media file to transcribe",
  mediaToImportNotFound: "Can't find the media file to import",
  noVideo: 'No video to transcribe',
  notApplied: "Transcription finished but wasn't written into the video",
  videoClosed: 'The video was closed, so nothing was transcribed: open the video and try again',
  noMainAsset: 'No audio or video asset on the main track: specify the asset to transcribe (assetId)',
  ambiguousMainAsset: 'More than one asset on the main track: specify which one to transcribe (assetId)',
  retranscribedName: (p: { name: string }) => `${p.name} · Re-transcribed`,
  transcriptEdited:
    'The transcript was edited after it was transcribed, and replacing it would discard those edits: use destination new-video, or pass acceptEdited: true to replace it anyway',
  transcriptEditedSinceSubmit: "The transcript changed after this run started, so it wasn't replaced: start the transcription again",
  landingNeedsVideo: 'only applies to an existing video ({ videoId } or { entryId })',
  nameNewVideoOnly: 'only applies when destination is new-video',
  replaceOnly: 'only applies when destination is replace',
  transcriptUnreadable: "Can't read the current transcript to check for edits",
  replaceDocumentGone: 'The transcript to replace is no longer in the video',
};

export type JobsTranscribeMessages = typeof en;

export const JobsTranscribe = defineCatalog('jobsTranscribe', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
