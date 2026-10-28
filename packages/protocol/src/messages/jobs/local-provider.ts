import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './local-provider.zh-Hans.ts';
import { zhHant } from './local-provider.zh-Hant.ts';
import { ja } from './local-provider.ja.ts';
import { ko } from './local-provider.ko.ts';
import { es } from './local-provider.es.ts';
import { fr } from './local-provider.fr.ts';
import { de } from './local-provider.de.ts';
import { nl } from './local-provider.nl.ts';
import { ptBR } from './local-provider.pt-BR.ts';
import { it } from './local-provider.it.ts';
import { ru } from './local-provider.ru.ts';
import { pl } from './local-provider.pl.ts';
import { tr } from './local-provider.tr.ts';
import { vi } from './local-provider.vi.ts';

/** `packages/jobs/src/local-provider.ts`：本地推理（Model Worker）的失败说明与合成警告。 */
const en = {
  assetUnreadable: "Couldn't read the asset",
  notHandled: (p: { capability: string }) => `The local Provider doesn't run ${p.capability}`,
  referenceChanged: 'The reference recording changed after it was submitted',
  referenceUnreadable: "Couldn't read the reference recording",
  stemOutputWrong: (p: { file: string }) => `The separated output isn't ${p.file} in staging`,
  speakersOutputWrong: (p: { file: string }) => `The speaker identification output isn't ${p.file} in staging`,
  imageNoInput: 'Local image generation has no input file',
  imageOutputWrong: (p: { file: string }) => `The image output isn't ${p.file} in staging`,
  musicNotMusicBundle: (p: { bundleId: string }) => `${p.bundleId} is not a music model package`,
  audioCppSpawnFailed: (p: { reason: string }) => `Couldn't start the audio.cpp engine: ${p.reason}`,
  audioCppExited: (p: { code: string; tail: string }) => `The audio.cpp engine exited with ${p.code}: ${p.tail}`,
  musicNoOutput: 'The audio.cpp engine finished without writing a WAV file',
  separateNotAudioCpp: (p: { bundleId: string }) => `${p.bundleId} isn't an audio.cpp separation model package`,
  separateNoStem: (p: { stem: string }) => `The audio.cpp engine finished without writing the ${p.stem} track`,
  audioCppNotReady: (p: { seconds: number }) => `The audio.cpp engine wasn't ready within ${p.seconds} s`,
  audioCppRequestFailed: (p: { status: number; message: string }) => `The audio.cpp engine couldn't run this request (HTTP ${p.status}): ${p.message}`,
  audioCppBadOutput: (p: { problem: string }) => `The audio.cpp engine returned audio that isn't a usable WAV: ${p.problem}`,
  referenceTooLong: (p: { seconds: number; max: number }) => `The reference recording is ${p.seconds} s; with a transcript this model takes at most ${p.max} s`,
  musicTruncated: (p: { seconds: number }) => `The music hit the length limit (${p.seconds} s) and may end abruptly; raise maxDurationSec for a complete piece`,
  runtimeStopping: 'Runtime is shutting down',
  bundleRequired: 'Local inference needs a model bundle',
  bundleDisabled: 'The model bundle is disabled',
  workerBusy: "This model bundle's Worker is running another task",
  workerVersionChanged: "The Worker version differs from the first attempt, so it won't retry automatically",
  noOutput: 'job.run returned completed without an output',
  workerExitedDuringJob: 'Model Worker exited during the task',
  inferenceFailed: (p: { code: string }) => `Inference failed: ${p.code}`,
  stagingUnwritable: "Couldn't write the output to staging; check disk space",
  workerUnsupported: (p: { message: string }) => `Model Worker doesn't support this task: ${p.message}`,
  jobRunReturned: (p: { code: string }) => `job.run returned ${p.code}`,
  workerNotFound: 'Model Worker (model-worker) not found',
  workerCannotStart: "Couldn't start Model Worker",
  workerExitedOnStart: 'Model Worker exited right after starting',
  handshakeFailed: 'Model Worker handshake failed',
  contractMismatch: "Model Worker's contract version doesn't match",
  backendUnavailable: (p: { backend: string }) => `This Model Worker can't use the ${p.backend} backend`,
  cannotSeparate: "This Model Worker can't run local voice and background separation with this model yet",
  cannotGenerateImage: "This Model Worker can't generate images locally with this model yet",
  cannotDiarize: "This Model Worker can't identify speakers locally yet",
  cannotTranscribe: "This Model Worker can't transcribe locally with this model yet",
  loadFailed: (p: { reason: string }) => `Loading the model bundle failed: ${p.reason}`,
  workerExitedOnLoad: 'Model Worker exited while loading',
  crashedRepeatedly: (p: { minutes: number; count: number }) =>
    `Crashed ${p.count} ${p.count === 1 ? 'time' : 'times'} in ${p.minutes} ${p.minutes === 1 ? 'minute' : 'minutes'}`,
  /** `origin`：`user` / `phrase` / `dict` / `llm`（注记的来源，原样显示）。 */
  readingDroppedOne: (p: { at: number; reading: string; origin: string }) =>
    `Character ${p.at} wasn't synthesized with the reading "${p.reading}" (${p.origin})`,
  readingDroppedRange: (p: { from: number; to: number; reading: string; origin: string }) =>
    `Characters ${p.from}–${p.to} weren't synthesized with the reading "${p.reading}" (${p.origin})`,
};

export type JobsLocalProviderMessages = typeof en;

export const JobsLocalProvider = defineCatalog('jobsLocalProvider', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
