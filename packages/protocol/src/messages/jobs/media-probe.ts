import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './media-probe.zh-Hans.ts';
import { zhHant } from './media-probe.zh-Hant.ts';
import { ja } from './media-probe.ja.ts';
import { ko } from './media-probe.ko.ts';
import { es } from './media-probe.es.ts';
import { fr } from './media-probe.fr.ts';
import { de } from './media-probe.de.ts';
import { nl } from './media-probe.nl.ts';
import { ptBR } from './media-probe.pt-BR.ts';
import { it } from './media-probe.it.ts';
import { ru } from './media-probe.ru.ts';
import { pl } from './media-probe.pl.ts';
import { tr } from './media-probe.tr.ts';
import { vi } from './media-probe.vi.ts';

/** `packages/jobs/src/media-probe.ts`：生成的音频、图片没有通过解码校验的原因（进任务错误的 `details.problems`）。 */
const en = {
  unknownMediaType: (p: { mediaType: string }) => `Unrecognized media type ${p.mediaType}`,
  unreadable: "Couldn't read the output file",
  headerMismatch: (p: { sniffed: string; mediaType: string }) => `The file header is ${p.sniffed}, but it was declared as ${p.mediaType}`,
  unrecognizedFormat: 'an unrecognized format',
  notJson: "ffprobe's output isn't JSON",
  noAudioStream: 'No audio stream',
  noImage: 'No image',
  noFrames: "Couldn't decode a single frame",
  durationNotPositive: "The duration isn't positive",
  sampleRateNotPositive: "The sample rate isn't positive",
  channelsNotPositive: "The channel count isn't positive",
  sizeNotPositive: "The width or height isn't positive",
  cannotRun: (p: { reason: string }) => `ffprobe couldn't run: ${p.reason}`,
  killedBy: (p: { signal: string }) => `killed by ${p.signal}`,
  exitCode: (p: { code: string }) => `exit code ${p.code}`,
  decodeFailed: (p: { reason: string }) => `ffprobe failed to decode (${p.reason})`,
  decodeFailedWith: (p: { reason: string; output: string }) => `ffprobe failed to decode (${p.reason}): ${p.output}`,
  noProbe: "ffprobe isn't available, so the output can't be checked",
};

export type JobsMediaProbeMessages = typeof en;

export const JobsMediaProbe = defineCatalog('jobsMediaProbe', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
