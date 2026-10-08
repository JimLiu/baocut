import { defineMessages } from '@baocut/protocol';
import { zhHans } from './tools-transcode-copy.zh-Hans.ts';
import { zhHant } from './tools-transcode-copy.zh-Hant.ts';
import { ja } from './tools-transcode-copy.ja.ts';
import { ko } from './tools-transcode-copy.ko.ts';
import { es } from './tools-transcode-copy.es.ts';
import { fr } from './tools-transcode-copy.fr.ts';
import { de } from './tools-transcode-copy.de.ts';
import { nl } from './tools-transcode-copy.nl.ts';
import { ptBR } from './tools-transcode-copy.pt-BR.ts';
import { it } from './tools-transcode-copy.it.ts';
import { ru } from './tools-transcode-copy.ru.ts';
import { pl } from './tools-transcode-copy.pl.ts';
import { tr } from './tools-transcode-copy.tr.ts';
import { vi } from './tools-transcode-copy.vi.ts';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** 文件转码工具（压缩、合并、提取音频）的文案（英文是键与类型的来源，译文在 `tools-transcode-copy.<语言>.ts`）。 */
const en = {
  quality: {
    smaller: { name: 'Smaller', sub: 'Good enough for messaging and cloud storage' },
    balanced: { name: 'Balanced', sub: 'Hard to tell the difference' },
    high: { name: 'High quality', sub: 'Keep it for editing later' },
  },
  heightOriginal: 'Original',
  heightOriginalLong: 'Original resolution',
  codecSub: {
    h264: 'Plays everywhere',
    hevc: '40% smaller at the same quality; older devices may not play it',
  },

  // 加文件
  notVideoFiles: (names: readonly string[]) => `${names.join(', ')} ${plural(names.length, 'is not a video file', 'are not video files')}`,
  notAbsolute: (paths: readonly string[]) => `${paths.join(', ')} ${plural(paths.length, 'is not an absolute path', 'are not absolute paths')}`,
  alreadyListed: (names: readonly string[]) => `${names.join(', ')} ${plural(names.length, 'is already in the list', 'are already in the list')}`,
  overflow: (limit: number, extra: number) => `Up to ${limit} files at a time; ${extra} more ${plural(extra, 'was', 'were')} not added`,
  joinNotices: (bits: readonly string[]) => bits.join('; '),

  // 提交前的问题
  needTwoVideos: 'Add at least two videos',
  needMediaFile: 'Choose a video or audio file first',
  needVideoFile: 'Choose a video file first',
  needOneMore: 'Merging needs at least two videos; add one more',
  tooManyFiles: (limit: number) => `Up to ${limit} files at a time`,
  videoKbpsRange: (min: number, max: number) => `Video bitrate must be between ${min} and ${max} kbps`,
  audioKbpsRange: (min: number, max: number) => `Audio bitrate must be between ${min} and ${max} kbps`,
  outDirAbsolute: 'The output folder must be an absolute path',
  ffmpegUnusable: (message: string) => `ffmpeg is unavailable: ${message}`,
  audioKbps: (kbps: number) => `Audio ${kbps} kbps`,

  // ffmpeg
  ffmpegNeeded: 'Install ffmpeg first',
  ffmpegInstallHint: 'Install ffmpeg, or set its path with BAOCUT_FFMPEG',
  ffmpegReady: (version: string) => `ffmpeg${version} is ready`,
  ffmpegOutdated: (version: string) => `ffmpeg${version} is too old`,
  ffmpegCannotRun: 'ffmpeg can’t run',

  // 记录
  filesTitle: (first: string, count: number) => `${first} and ${count - 1} more`,
  defaultTitle: 'File conversion',
  mergeTitle: (first: string, more: number) => `${first} + ${more} more`,
  qualityWithCrf: (name: string, crf: number) => `${name} (CRF ${crf})`,
  mergeStreamCopy: (n: number) => `Merge ${n} clips · Stream copy`,
  extractAudioMany: (n: number) => `Extract audio from ${n} files`,
  extractAudio: 'Extract audio',
  mergeClips: (n: number) => `Merge ${n} clips`,
  compressMany: (n: number) => `Compress ${n} files`,
  compress: 'Compress',
  stepQueued: (step: string, detail: string | null) => `${step} · ${detail ?? 'Queued'}`,
  stepOf: (step: string, cur: number, total: number) => `${step} · Step ${cur} of ${total}`,
  noAudioTrack: 'No audio',
  mergedSize: (after: string, before: string) => `${after} (sources total ${before})`,
  savedSize: (before: string, after: string, saved: number | null) =>
    `${before} → ${after} (${saved === null ? 'not smaller' : saved === 0 ? 'about the same' : `${saved}% smaller`})`,
  streamCopyLine: 'All clips match: stream-copied without re-encoding, quality unchanged',
  reencodeLine: (reason: string | null) => (reason ? `Re-encoded: ${reason}` : 'Re-encoded'),
  underASecond: 'Under 1 second',
  took: (duration: string) => `Took ${duration}`,
  stateQueued: 'Queued',
  stateProcessing: 'Processing',

  // 没做成
  remedyThenRetry: (remedy: string) => `${remedy}, then try again`,
  inputUnreadable: 'Couldn’t read any frames from this file. Make sure it plays in a media player, or choose another file',
  transcodeFailed: 'ffmpeg failed partway; the original output is below. If the disk is full, free up space; if a source file moved, choose it again',
  validationFailed: 'The output failed validation and was discarded, so nothing was written to the output folder. Try again or change the settings',
};

export type ToolsTranscodeMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
