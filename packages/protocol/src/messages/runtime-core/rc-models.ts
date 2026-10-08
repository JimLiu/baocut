import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-models.zh-Hans.ts';
import { zhHant } from './rc-models.zh-Hant.ts';
import { ja } from './rc-models.ja.ts';
import { ko } from './rc-models.ko.ts';
import { es } from './rc-models.es.ts';
import { fr } from './rc-models.fr.ts';
import { de } from './rc-models.de.ts';
import { nl } from './rc-models.nl.ts';
import { ptBR } from './rc-models.pt-BR.ts';
import { it } from './rc-models.it.ts';
import { ru } from './rc-models.ru.ts';
import { pl } from './rc-models.pl.ts';
import { tr } from './rc-models.tr.ts';
import { vi } from './rc-models.vi.ts';

/** 模型（models/）的安装、目录与生成的错误。英文是键与类型的来源，译文在 `rc-models.<语言>.ts`。 */
const en = {
  // 安装与删除（model-install-service）
  offlineStrict: "Models aren't downloaded in strict offline mode",
  sizeChanged: 'The number of bytes to download has changed. Confirm again with the new plan',
  bundleInUse: 'The model package is in use. Delete it after the tasks finish or are cancelled',
  diarizationNoCheck:
    "The speaker diarization model package has no check of its own: it's used together with the recognition model package when transcribing",
  bundleUnavailable: "The model package isn't available right now",
  installFailed: 'Something went wrong while installing the model',
  noSuchBundle: (p: { bundleId: string }) => `No model package: ${p.bundleId}`,
  movingDirWait: 'The models folder is being moved. Try again after it finishes',
  dirMissing:
    "The models folder doesn't exist (this also happens when an external drive isn't connected). Connect it and try again, or choose another models folder in Settings",
  selfTestSampleLabel: 'the recognition check sample',

  // 检查（models.test）
  workerFailed: (p: { reason: string }) => `Worker failed: ${p.reason}`,
  workerCancelledCheck: 'The Worker cancelled the check itself',
  noWorkerOutput: "The Worker didn't produce any output",
  outputMissing: "The output file doesn't exist",
  outputMismatch: "The output file's length or sha256 doesn't match the Worker's response",
  namedOutputMissing: (p: { file: string }) => `The output file ${p.file} doesn't exist`,
  namedOutputMismatch: (p: { file: string }) => `The length or sha256 of ${p.file} doesn't match the Worker's response`,
  outputNotJson: "The output isn't valid JSON",
  outputNotAsrResult: "The output doesn't follow the asr-result contract",
  transcriptMissingExpected: (p: { expected: string }) => `The recognized text doesn't contain "${p.expected}"`,
  separationPassed: (p: { duration: string; sampleRate: number; ratio: string; finite: boolean }) =>
    `${p.duration} s · ${p.sampleRate} Hz · vocals ${p.finite ? `${p.ratio} dB` : 'far'} above the background`,
  speechPassed: (p: { duration: string; sampleRate: number }) => `${p.duration} s · ${p.sampleRate} Hz`,
  imagePassed: (p: { width: number; height: number; steps: number }) => `${p.width}×${p.height} · ${p.steps} steps`,

  // 模型目录（models-dir-service）
  envLocked: 'The models folder is set by the BAOCUT_MODELS_DIR environment variable. To change it, change the variable and restart BaoCut',
  movingDirWaitOrCancel: 'The models folder is being moved. Change it after the move finishes or is cancelled',
  folderMissing: "This folder doesn't exist (this also happens when an external drive isn't connected)",
  folderNotWritable: "BaoCut doesn't have permission to write to this folder",
  dirNested: 'The new location and the current models folder contain each other. Choose a folder that is neither inside it nor contains it',
  noSpaceForMove: "The disk at the new location doesn't have room for the models to move",
  noSpaceRemedy: 'Free up space, choose another location, or choose "Only switch the location"',
  dirInUse: 'Tasks are using local models. Change the models folder after they finish or are cancelled',
  sourceKept: (p: { count: number }) =>
    `${p.count} ${p.count === 1 ? 'repository' : 'repositories'} in the old folder couldn't be deleted. You can delete them manually`,
  moveNoSpace: 'The disk at the new location filled up. The move was rolled back',
  moveFailed: 'Something went wrong while moving the models. The move was rolled back',
  moveFailedRemedy: "The original models folder hasn't changed, and the models still work",

  // 配音（dub-speech）
  noAlignableFormat: (p: { modelId: string }) => `Model ${p.modelId} doesn't output an audio format that can be aligned`,
  synthOutputCount: (p: { count: number }) => `Speech synthesis produced ${p.count} outputs; it should produce 1`,
  synthOutputOutsideStaging: "The speech synthesis output isn't in the staging folder",
  dubGrantHint: (p: { recipient: string }) =>
    `Voice-over sends the transcript (the translation, plus the original where a translation is missing) to ${p.recipient}. The default grant created when a provider is turned on doesn't include transcripts, so the user has to issue a grant explicitly (with the command below, or in BaoCut's Settings), then run this voice-over again.`,
  voiceRemoved: (p: { reason: string; voice: string }) => `${p.reason}: voice ${p.voice}`,

  // 识别说话人（speakers-apply）
  notSpeakersJob: "This task isn't speaker recognition",
  jobNotForVideo: "This recognition doesn't belong to this video",
  speakersNotDone: "Speaker recognition hasn't finished",
  speakersCleaned: 'The recognition results were cleaned up. Recognize speakers again',

  // 任务恢复（model-jobs）
  recoveryPrincipalName: 'Task recovery',
};

export type RcModelsMessages = typeof en;

export const RcModels = defineCatalog('rcModels', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
