import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './transcode.zh-Hans.ts';
import { zhHant } from './transcode.zh-Hant.ts';
import { ja } from './transcode.ja.ts';
import { ko } from './transcode.ko.ts';
import { es } from './transcode.es.ts';
import { fr } from './transcode.fr.ts';
import { de } from './transcode.de.ts';
import { nl } from './transcode.nl.ts';
import { ptBR } from './transcode.pt-BR.ts';
import { it } from './transcode.it.ts';
import { ru } from './transcode.ru.ts';
import { pl } from './transcode.pl.ts';
import { tr } from './transcode.tr.ts';
import { vi } from './transcode.vi.ts';

/** `packages/jobs/src/pipelines/transcode.ts` 给人看的文字。 */
const en = {
  label: 'Transcode files',
  description: "Compress video files, merge them in order, or extract audio: file to file, without creating a video, run by ffmpeg; outputs don't overwrite existing files.",
  inputNotFound: (p: { file: string }) => `Can't find input file ${p.file}`,
  stepProbe: 'Read inputs',
  stepEncode: 'Encode',
  stepVerify: 'Verify output',
  stepPublish: 'Publish',
  noAudioTrack: (p: { name: string }) => `${p.name} has no audio track`,
  noVideoTrack: (p: { name: string }) => `${p.name} has no video track`,
  verifyFailed: (p: { name: string }) => `The output of ${p.name} failed verification`,
  actionShape: 'must be compress, merge, or extract-audio',
  mergeNeedsTwo: 'needs at least two files to merge',
  audioReencode: (p: { codec: string }) => `Audio codec ${p.codec} doesn't fit a common audio container; re-encoding to AAC`,
  fileReason: (p: { name: string; reason: string }) => `${p.name}: ${p.reason}`,
  reasonSeparator: '; ',
  fieldVideoCodec: 'Video codec',
  fieldResolution: 'Resolution',
  fieldFrameRate: 'Frame rate',
  fieldPixelFormat: 'Pixel format',
  fieldAudioTrack: 'Audio track',
  fieldAudioCodec: 'Audio codec',
  fieldSampleRate: 'Sample rate',
  fieldChannels: 'Channels',
  present: 'yes',
  absent: 'none',
  fieldMismatch: (p: { field: string; values: string }) => `${p.field} differs (${p.values})`,
  videoNotMp4: (p: { codec: string }) => `Video codec ${p.codec} can't go directly into MP4`,
  audioNotMp4: (p: { codec: string }) => `Audio codec ${p.codec} can't go directly into MP4`,
  probeOutputFailed: "ffprobe can't read the output file",
  outputNoVideo: 'The output has no video track',
  outputNoAudio: 'The output has no audio track',
  durationOff: (p: { actual: string; expected: string }) => `Duration is ${p.actual} s; expected about ${p.expected} s`,
  codecMismatch: (p: { actual: string; expected: string }) => `Video codec is ${p.actual}; expected ${p.expected}`,
  heightOver: (p: { height: number; max: number }) => `Frame height ${p.height} exceeds the limit of ${p.max}`,
  tooManySameName: (p: { name: string }) => `Too many files with the same name in the output folder: ${p.name}`,
};

export type JobsTranscodeMessages = typeof en;

export const JobsTranscode = defineCatalog('jobsTranscode', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
