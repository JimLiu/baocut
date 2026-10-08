import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './providers-http.zh-Hans.ts';
import { zhHant } from './providers-http.zh-Hant.ts';
import { ja } from './providers-http.ja.ts';
import { ko } from './providers-http.ko.ts';
import { es } from './providers-http.es.ts';
import { fr } from './providers-http.fr.ts';
import { de } from './providers-http.de.ts';
import { nl } from './providers-http.nl.ts';
import { ptBR } from './providers-http.pt-BR.ts';
import { it } from './providers-http.it.ts';
import { ru } from './providers-http.ru.ts';
import { pl } from './providers-http.pl.ts';
import { tr } from './providers-http.tr.ts';
import { vi } from './providers-http.vi.ts';

/**
 * 在线服务请求与响应的错误分类说明（`packages/providers`）。`label` 是服务的名字；`message`、`said`、`reply`
 * 是供应商的原话，原样传入。
 */
const en = {
  aborted: 'Request cancelled',
  rejected: (p: { label: string; status: number }) => `${p.label} rejected the request (HTTP ${p.status})`,
  unreachable: (p: { label: string }) => `Can't reach ${p.label}`,
  httpStatus: (p: { label: string; status: number }) => `${p.label} returned HTTP ${p.status}`,
  failedAfterAttempts: (p: { what: string; attempts: number }) => `${p.what}, still failing after ${p.attempts} attempts`,
  /** 一句说明后面接供应商的原话或底层错误。 */
  withMessage: (p: { text: string; message: string }) => `${p.text}: ${p.message}`,
  errorCode: (p: { message: string; code: string }) => `${p.message} (${p.code})`,
  noResponse: (p: { label: string; seconds: number }) => `${p.label} didn't respond within ${p.seconds} seconds`,
  tooManyRedirects: (p: { label: string }) => `${p.label} redirected too many times`,
  badRedirect: (p: { label: string }) => `${p.label} returned a redirect address that can't be recognized`,
  redirectProtocol: (p: { label: string }) => `${p.label} redirected to an unsupported protocol`,
  redirectOrigin: (p: { label: string }) =>
    `${p.label} redirected the request to another address. It wasn't followed, so assets aren't sent elsewhere`,
  responseTooLarge: "The provider's response is too large",
  invalidJson: (p: { label: string }) => `${p.label}'s response isn't valid JSON`,
  notObject: (p: { label: string }) => `${p.label}'s response isn't an object`,
  missingField: (p: { label: string; field: string }) => `${p.label}'s response has no ${p.field}`,
  missingText: (p: { label: string }) => `${p.label}'s response is missing text`,
  missingTranscript: (p: { label: string }) => `${p.label}'s response has no transcription result`,
  cloneNoVoiceId: (p: { label: string }) => `${p.label}'s clone response has no voice_id`,
  noB64: (p: { label: string }) => `${p.label}'s response has no b64_json (endpoints that only return image URLs aren't supported)`,
  listShape: (p: { label: string; shape: string }) => `${p.label}'s model list isn't ${p.shape}`,
  listNotArray: (p: { label: string }) => `${p.label}'s model list isn't an array`,
  voicesShape: (p: { label: string }) => `${p.label}'s voice list isn't { voices: [...] }`,
  unexpectedFinish: (p: { label: string; reason: string }) => `${p.label} returned an unexpected finish reason: ${p.reason}`,
  jsonNotAudio: (p: { label: string }) => `${p.label} returned JSON instead of audio`,
  emptyAudio: (p: { label: string }) => `${p.label} returned empty audio`,
  formatUnsupported: (p: { label: string; format: string }) => `${p.label} doesn't output ${p.format}`,
  imageCount: (p: { label: string; got: number; want: number }) => `${p.label} returned ${p.got} images, but ${p.want} were requested`,
  transcribeIncomplete: (p: { label: string; status: string }) => `${p.label} didn't finish this transcription (${p.status})`,
  generateIncomplete: (p: { label: string; status: string }) => `${p.label} didn't finish this generation (${p.status})`,
  noImageSize: (p: { label: string; model: string; size: string }) => `${p.label}'s model ${p.model} has no size ${p.size}`,
  noImageReturned: (p: { label: string }) => `${p.label} returned no image`,
  noImageReturnedSaid: (p: { label: string; said: string }) => `${p.label} returned no image: ${p.said}`,
  wrongMime: (p: { label: string; got: string; want: string }) => `${p.label} returned ${p.got}, but ${p.want} was requested`,
  emptyOutput: 'The provider returned empty output',
  requestIncomplete: "The request didn't complete",
  audioUnreadable: "The asset's audio can't be read (ffmpeg decoding failed)",
  chunkEncodeFailed: 'Encoding an audio chunk failed (ffmpeg)',
  notWav: "The decoded audio isn't WAV",
  wavMissingChunks: 'The decoded WAV is missing the fmt or data chunk',
  ffmpegMissing: 'ffmpeg not found. Online transcription needs it to prepare audio. Install it, then restart BaoCut',
  ffmpegRunFailed: (p: { error: string }) => `Couldn't run ffmpeg: ${p.error}`,
  ffmpegTimeout: 'ffmpeg timed out while processing audio',
  rangeClamped: (p: { decoded: string; requested: string }) =>
    `The requested range goes past the end of the audio: processed ${p.decoded} s, requested ${p.requested} s`,
  segmentDropped: (p: { text: string }) => `A text segment had invalid timing and was dropped: ${p.text}`,
};

export type ProvidersHttpMessages = typeof en;

export const ProvidersHttp = defineCatalog('providersHttp', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
