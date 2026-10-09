import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './job-manager.zh-Hans.ts';
import { zhHant } from './job-manager.zh-Hant.ts';
import { ja } from './job-manager.ja.ts';
import { ko } from './job-manager.ko.ts';
import { es } from './job-manager.es.ts';
import { fr } from './job-manager.fr.ts';
import { de } from './job-manager.de.ts';
import { nl } from './job-manager.nl.ts';
import { ptBR } from './job-manager.pt-BR.ts';
import { it } from './job-manager.it.ts';
import { ru } from './job-manager.ru.ts';
import { pl } from './job-manager.pl.ts';
import { tr } from './job-manager.tr.ts';
import { vi } from './job-manager.vi.ts';

/** `packages/jobs/src/job-manager.ts`：提交、执行、恢复与应用任务时的错误、校验问题与警告。 */
const en = {
  // 提交与查询
  runtimeStopping: 'Runtime is shutting down',
  jobNotFound: "The task doesn't exist",
  noBundle: 'No such model bundle',
  noBundleId: (p: { bundleId: string }) => `No such model bundle: ${p.bundleId}`,
  jobIdExists: 'The task ID already exists',
  onlyHostedRerun: 'Only hosted tasks can be re-run this way',
  notEnded: "The task hasn't finished yet",
  hintTooLong: "The term hint can't be longer than 1200 characters",
  hintIgnored: (p: { model: string }) => `${p.model} doesn't take recognition hints, so the hint wasn't used`,
  onlyAudioVideo: 'Only audio or video assets can be transcribed',
  pathNotAbsolute: 'Paths must be absolute',
  trackInvalid: 'track must be a non-negative integer',
  noGeneration: "This Runtime doesn't provide generation",
  videoNotOpen: "The video isn't open",
  contentHashInvalid: 'The content hash must be sha256:<hex>',
  timescaleInvalid: 'timescale must be a positive integer',
  rangeInvalid: 'range is invalid',
  bundleCannotTranscribe: "This model bundle can't transcribe",
  bundleUnavailable: 'The model bundle is unavailable right now',
  localInferenceUnavailable: 'Local inference is unavailable',
  invalidLanguageTag: (p: { tag: string }) => `Not a valid BCP 47 language tag: ${p.tag}`,
  cannotReadInput: "Couldn't read the input file",
  // 对账与恢复
  jobReconciling: 'This task is being recovered or reconciled',
  openVideoToRetry: "The video isn't open; open it, then try again",
  openVideoToApply: "The video isn't open; open it, then apply",
  receiptUnknownLater: "Couldn't find the receipt of the last commit; try again later",
  receiptUnknown: "Couldn't find the receipt of the last commit",
  requeueCheckFailed: 'The check before re-queuing failed',
  assetVersionGone: 'The asset or its version is no longer in the video',
  assetChanged: 'The asset content changed',
  cannotRerun: "This task can't be re-run",
  cannotOpenVideoAfterRestart: "Couldn't open the video after restarting",
  videoNotOpenNoPlace: "The video isn't open, and its location is unknown",
  videoFolderGone: 'The video folder no longer exists',
  videoReplaced: 'Another video is now at the original location',
  recoverFailed: 'Recovering the task failed',
  interrupted: "The task didn't finish before Runtime stopped; you can submit it again",
  needsReconciliation:
    "An outgoing call hadn't returned when Runtime stopped, so it's unknown whether the remote side ran it or charged for it. Choose to retry or discard (it won't be resent automatically)",
  // 执行
  executeFailed: 'Running the task failed',
  providerUnavailable: 'Provider is unavailable',
  executorGone: "The task's executor is gone",
  localCrashedAfterRetry: 'The local inference process still crashed after a retry',
  transcribeFailedAfterRetry: 'Transcription still failed after a retry',
  // 生成的输出校验（进 `details.problems`）
  outputCountMismatch: (p: { actual: number; expected: number }) =>
    `There ${p.actual === 1 ? 'is 1 output' : `are ${p.actual} outputs`}, but ${p.expected} ${p.expected === 1 ? 'was' : 'were'} requested`,
  outputNotInStaging: (p: { n: number }) => `Output ${p.n} isn't in the staging folder`,
  outputMissing: (p: { n: number }) => `Output ${p.n} doesn't exist`,
  outputLengthMismatch: (p: { n: number; actual: number; declared: number }) =>
    `Output ${p.n} is ${p.actual} bytes, but ${p.declared} was declared`,
  outputShaMismatch: (p: { n: number }) => `Output ${p.n}'s sha256 doesn't match the declared one`,
  outputTypeMismatch: (p: { n: number; actual: string; expected: string }) =>
    `Output ${p.n} is ${p.actual}, but ${p.expected} was requested`,
  outputProblem: (p: { n: number; problem: string }) => `Output ${p.n}: ${p.problem}`,
  noTextResult: "The executor didn't return a text result",
  textOutputCount: (p: { actual: number }) => `There are ${p.actual} outputs; there should be 1`,
  textNotInStaging: "The output isn't in the staging folder",
  textMissing: "The output doesn't exist",
  textLengthMismatch: (p: { actual: number; declared: number }) => `The output is ${p.actual} bytes, but ${p.declared} was declared`,
  textShaMismatch: "The output's sha256 doesn't match the declared one",
  textTypeMismatch: (p: { actual: string; expected: string }) => `The output is ${p.actual}, but ${p.expected} was requested`,
  notUtf8: "The output isn't valid UTF-8",
  notJson: "The output isn't valid JSON",
  emptyOutput: 'The output is empty',
  generatedInvalid: 'The generated output failed the decode check',
  // 转写结果校验
  asrFileNotInStaging: "The output file isn't in the staging folder",
  asrFileMissing: "The output file doesn't exist",
  asrLengthMismatch: (p: { actual: number; declared: number }) => `The output is ${p.actual} bytes, but the response said ${p.declared}`,
  asrShaMismatch: "The output's sha256 doesn't match the response",
  asrContractInvalid: "The model output doesn't satisfy baocut.asr-result/v1",
  // 警告
  outputTruncated: (p: { limit: number }) => `The output hit the limit (${p.limit} tokens) and was cut off; the content is incomplete`,
  saveCopyFailed: (p: { dir: string; reason: string }) => `Couldn't write a copy in ${p.dir}: ${p.reason}`,
  // 应用到视频
  applyError: 'Writing to the video failed',
  transcribeLabel: 'Transcribe',
  voiceOverLabel: 'Generate voice-over',
  imageLabel: 'Generate image',
  videoClosed: 'The video has been closed',
  assetGone: 'The asset is no longer in the video',
  assetChangedDuringTranscribe: 'The asset content changed during transcription',
  generatedGone: 'The generated output no longer exists',
  asrGone: 'The transcription result output no longer exists',
  asrNotJson: "The transcription result output isn't valid JSON",
  asrInvalid: "The transcription result output doesn't match the contract",
  targetGone: 'The target no longer exists',
  staleGeneratedKept: (p: { reason: string }) => `${p.reason}; the generated result was kept`,
  protectedKept: (p: { generated: boolean }) =>
    `${p.generated ? 'Generation' : 'Transcription'} finished, but the result touched the "don't change" scope in the task contract, so it wasn't written to the video. The result was kept; it's up to the user whether to apply it`,
  applyFailedKept: (p: { generated: boolean }): string =>
    p.generated
      ? 'Generation finished, but importing into the video failed; the result was kept'
      : 'Transcription finished, but writing to the video failed; the result was kept',
};

export type JobsManagerMessages = typeof en;

export const JobsManager = defineCatalog('jobsManager', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
