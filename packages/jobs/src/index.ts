import { fileURLToPath } from 'node:url';
export {
  JobManager,
  TaskFailure,
  type TaskRun,
  type TaskResources,
  type TaskSubmission,
  type HostedJob,
  type HostedJobControl,
  type FileJobObserver,
  type FileJobOutput,
  type FileTranscribeRequest,
  type StandaloneTranscribeRequest,
  type JobAssetSource,
  type JobManagerOptions,
  type JobManagerPaths,
  type JobVideos,
  type LiveSegmentsUpdate,
  type TranscribeRouter,
} from './job-manager.ts';
export {
  LocalTranscribeProvider,
  type LocalDiarizeOutcome,
  type LocalDiarizeRun,
  type LocalProviderOptions,
  type LocalSeparateOutcome,
  type LocalSeparateRun,
  type ProcessResources,
} from './local-provider.ts';
export { localDubSeparator, type LocalDubSeparatorOptions } from './pipelines/dub-separator.ts';
export {
  speakersApplyLabel,
  SPEAKERS_PIPELINE,
  SPEAKER_PROPOSAL_SCHEMA,
  readSpeakerProposal,
  speakerApplyOperations,
  speakersPipeline,
  type FrozenSpeakersParams,
  type SpeakerProposalFile,
  type SpeakersDeps,
  type SpeakersVideos,
} from './pipelines/speakers.ts';
export {
  ResourceExceedsCapacity,
  ResourceScheduler,
  type ResourceLease,
  type ResourceRequest,
  type ResourceSchedulerOptions,
} from './resource-scheduler.ts';
export { MachineCapacity, unifiedGpuEstimate, type CapacitySource, type MachineCapacityOptions } from './machine-capacity.ts';
export {
  audioExportDemand,
  localImageResources,
  localSeparateResources,
  localTranscribeResources,
  modelDownloadDemand,
  modelWorkerDemand,
  modelWorkerHolder,
  transcodeDemand,
  videoExportDemand,
} from './resource-profiles.ts';
export { isJobError, type JobAdmission, type JobAdmissionRequest, type JobGrantHint } from './job-admission.ts';
export { JobLedger, isTerminal, type HostedJobSpec, type PublishIntent, type StoredJob } from './job-ledger.ts';
export { ApplicationLedger, type StoredApplication, type VideoPlace } from './application-ledger.ts';
export {
  APPLY_ATTEMPTS,
  SimulatedCrash,
  StaleInput,
  taskStopped,
  type AppliedReceipt,
  type ApplicationRun,
  type JobFaultPoint,
  type JobFaults,
} from './job-application.ts';
export {
  cancellationFacts,
  isExternalProvider,
  recoveryAction,
  type RecoveryAction,
  type RemoteTaskQuery,
  type RemoteTaskStatus,
} from './job-recovery.ts';
export { RECONCILE_DECISIONS, reconcileChoices } from './job-reconcile.ts';
export { libraryVoice, transcribeGlossaries, type JobLibrary } from './job-library.ts';
export { emptySelection, readSelection, selectionBody, selectionDocument, videoSelection } from './library-selection.ts';
export { ArtifactStore, ARTIFACT_EXTENSIONS, artifactIdOf, locateArtifact, type ArtifactExtension } from './artifact-store.ts';
export { generatedImportOperation } from './generated-import.ts';
export {
  ffprobeMediaProbe,
  sniffMediaType,
  unavailableProbe,
  type MediaFacts,
  type MediaProbe,
  type MediaProbeResult,
  type ProbeToolResolver,
} from './media-probe.ts';
export {
  canonicalJson,
  generationInputHash,
  sha256Hex,
  transcribeInputHash,
  type GenerationInputSpec,
  type TaskInputSpec,
  type TranscribeInputSpec,
} from './input-hash.ts';
export { speechDocumentOperation, speechWords, type SpeechDocumentContext, type SpeechWord } from './speech-document.ts';
export { silentLog, type JobsLogger } from './jobs-logger.ts';
export {
  CallCounter,
  PipelineStepError,
  type PipelineDefinition,
  type PipelinePlan,
  type PipelineStep,
  type PipelineStepContext,
  type StepOutput,
  type StepOutputs,
  type StepResult,
} from './pipelines/pipeline.ts';
export { PIPELINE_ACTOR_ID, PipelineRunner, jobErrorOf, type PipelineRunnerOptions } from './pipelines/pipeline-runner.ts';
export { TRANSCODE_PIPELINE, transcodePipeline, type TranscodeDeps } from './pipelines/transcode.ts';
export { TRANSLATE_PIPELINE, translatePipeline, type PipelineVideos, type TranslateDeps } from './pipelines/translate.ts';
export {
  MAX_SUBTITLE_BYTES,
  SubtitleFileError,
  decodeSubtitleBytes,
  subtitleFormatOf,
  subtitleText,
} from './pipelines/subtitle-file.ts';
export { TRANSLATE_SUBTITLES_PIPELINE, translateSubtitlesPipeline, type TranslateSubtitlesDeps } from './pipelines/translate-subtitles.ts';
export {
  SPEECH_WORKER_PROTOCOL,
  resolveSpeechWorkerCommand,
  runSpeechTranslate,
  type SpeechTranslateInput,
  type SpeechTranslateOptions,
  type SpeechTranslateResult,
  type SpeechWorkerCue,
  type SpeechWorkerCues,
  type SpeechWorkerTranslation,
} from './pipelines/speech-worker.ts';
export {
  DUB_EXTENSION,
  DUB_PIPELINE,
  DUBBING_PLAN_SCHEMA,
  dubPipeline,
  type DubDeps,
  type DubSeparator,
  type DubSpeech,
  type DubVideos,
  type DubVoice,
  type FrozenDubParams,
} from './pipelines/dub.ts';
export { MAX_DUB_TEMPO, alignDub, type DubAlignment, type DubFit, type DubSlot } from './pipelines/dub-alignment.ts';
export { EditorWasmUnavailable, editorWasmAvailable } from '@baocut/editor-wasm';
export {
  TRANSLATION_SCHEMA,
  sourceSentences,
  translationProblems,
  translationShapeProblems,
  type FrozenSource,
  type SourceSentence,
} from './pipelines/translation-document.ts';
export { TOOL_CATALOGUE, TRANSCRIBE_PIPELINE, toolDefinition } from './tool-catalogue.ts';
export {
  LINK_IMPORT_PIPELINE,
  linkImportAssetOperation,
  linkImportPipeline,
  type FrozenLinkImportParams,
  type LinkImportDeps,
  type LinkImportTool,
} from './pipelines/link-import.ts';
export { FileLinkSources, type LinkSources } from './pipelines/link-sources.ts';
export { sanitizeFileName } from './pipelines/yt-dlp.ts';
export { COOKIE_BROWSER_LABELS, detectCookieBrowsers, type CookieHost } from './pipelines/cookie-browsers.ts';
export {
  OUTPUT_DESTINATION_UNAVAILABLE,
  ensureSaveDirectory,
  readableStem,
  writableDirectoryProblem,
} from './pipelines/save-location.ts';
export {
  transcribePipeline,
  parseTranscribeParams,
  mainTrackAssets,
  type CheckedTranscribeParams,
  type FrozenTranscribeParams,
  type TranscribeDeps,
} from './pipelines/transcribe.ts';
export {
  createHeldVideo,
  importMedia,
  transcribeInVideo,
  type MediaImport,
  type MediaVideos,
  type PipelineTranscriber,
} from './pipelines/video-create.ts';
export {
  CAPTION_DOCUMENT_REF,
  ORIGINAL_CAPTION_DOCUMENT_REF,
  SPEECH_CAPTION_EXTENSION,
  TRANSLATION_CAPTION_EXTENSION,
  captionPlacement,
  captionsStep,
  existingCaptionLayer,
  planCaptionLayer,
  type CaptionDocumentReader,
  type CaptionLayerOutput,
  type CaptionLayerPlan,
  type CaptionSource,
  type CaptionVideos,
} from './pipelines/caption-layer.ts';
export { CUE_PARAMS, translationCues, type CueTranslationUnit } from './pipelines/caption-cues.ts';
export {
  TARGET_STEP,
  createScopeOf,
  readVideoTarget,
  targetStep,
  type PipelineTargetSupport,
  type PipelineTargets,
  type VideoLease,
} from './pipelines/video-target.ts';
export { checkLink, isPrivateAddress, redactUrl, redactUrlsInText, type HostLookup } from './pipelines/link-url.ts';

/** 测试用的假 Model Worker 脚本的绝对路径（`node <path>` 运行）。 */
export const FAKE_MODEL_WORKER = fileURLToPath(new URL('./testing/fake-model-worker.ts', import.meta.url));
export { FAKE_YT_DLP, writeFakeYtDlp, type FakeYtDlp } from './testing/fake-tools.ts';
/** 测试用：Speech Worker 发给文本模型的请求的假答案（翻译与翻译配音的测试共用）。 */
export { fakeSpeechAnswer, requestedSentences, speechRequestKind } from './testing/fake-speech-model.ts';
