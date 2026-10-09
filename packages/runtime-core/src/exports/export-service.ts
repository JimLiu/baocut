import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_LOUDNESS_TARGET,
  PACKAGE_EXTENSION,
  RpcError,
  SUPPORTED_EXPORT_KINDS,
  burnedCaptionLanguages,
  nowIso,
  refOf,
  transcriptStamp,
  type CaptionItem,
  type ExportCreateRequest,
  type ExportFontFace,
  type ExportRange,
  type ExportRenderTextRequest,
  type ExportRenderTextResult,
  type ExportSettings,
  type ExportSnapshot,
  type FontFaceQuery,
  type GeneratedOutput,
  type Id,
  type JobRecord,
  type JobSubmitter,
  type JobWarning,
  type Localized,
  type MessageRef,
  type PackageManifest,
  type RenderedTextOutput,
  type VideoSnapshot,
} from '@baocut/protocol';
import { RcCommon, RcExport, RcPackage } from '@baocut/protocol/messages/runtime-core';
import {
  TaskFailure,
  audioExportDemand,
  canonicalJson,
  sha256Hex,
  videoExportDemand,
  type ArtifactExtension,
  type JobManager,
  type TaskResources,
  type TaskRun,
} from '@baocut/jobs';
import type { Logger } from '@baocut/harness';
import { ffmpegMissingRemedy } from '@baocut/process-host';
import { localizedOf, taskFailure } from '../localized.ts';
import type { VideoService } from '../videos/video-service.ts';
import {
  AudioValidationError,
  DEFAULT_BITRATE_KBPS,
  DEFAULT_CHANNELS,
  DEFAULT_SAMPLE_RATE,
  ToolFailure,
  missingAudioTools,
  renderAudio,
  type AudioOutputSettings,
  type ToolCommand,
} from './audio-export.ts';
import type { AudioPlanResult, PlannedAsset, PlannedDocument, TextPlan, TextPlanResult } from './export-plan.ts';
import {
  DestinationError,
  checkFixedName,
  hiddenTemp,
  prepareDirectory,
  publishFile,
  publishInPlace,
  safeFileStem,
  sourceRoot,
  withExtension,
} from './export-publish.ts';
import { checkText, renderText, type FrontMatter, type TextChapter, type TextExportOutput } from './text-export.ts';
import { sourceChapters, sourcePlan } from './text-source.ts';
import {
  DEFAULT_VIDEO_AUDIO_KBPS,
  WorkerFailure,
  checkVideo,
  masterRunner,
  probeVideo,
  runWorker,
  skippedWarning,
  workerInput,
  type UnsupportedItem,
  type VideoOutput,
  type VideoPlanResult,
  type WorkerEvent,
} from './video-export.ts';
import { audioItemSelection } from './audio-source.ts';
import { readPackage } from './package-reader.ts';
import {
  PackageAssetChanged,
  checkSpace,
  localRoots,
  planPortable,
  sha256OfFile,
  writePortable,
  type PackageFreeze,
} from './portable-export.ts';
import { renderXmeml } from './project-export.ts';
import { FALLBACK_FONT_FAMILY } from '../fonts/bundled-fonts.ts';
import { queryKey, type ExportFacePlan, type FontService } from '../fonts/font-service.ts';

/**
 * 导出服务（架构设计 §9.11、§9.13）：`exports.create` 在提交前冻结与预检，失败时不创建任务；通过后把冻结的快照存成
 * JSON 产物、交给 JobManager 排队。任务在 staging 里生成每个输出、各自校验、取消检查之后各自发布（复制到目标目录、
 * 硬链接到最终的名字、登记为产物），部分失败如实报告。
 *
 * 预检的错误放在 `RpcError.details.code`（命令与协议规范 §11.4）：`EXPORT_KIND_UNSUPPORTED`、`EXPORT_RANGE_EMPTY`、
 * `EXPORT_SOURCE_NOT_FOUND`、`EXPORT_SOURCE_AMBIGUOUS`、`EXPORT_SOURCE_UNSUPPORTED`、`EXPORT_SOURCE_UNPLACED`、
 * `EXPORT_NOTHING_TO_EXPORT`、`EXPORT_DESTINATION_EXISTS`、`EXPORT_DESTINATION_UNWRITABLE`、`EXPORT_TOOL_MISSING`、
 * `ASSET_MISSING`、`ASSET_CHANGED`。
 */

export interface ExportServiceOptions {
  jobs: JobManager;
  videos: VideoService;
  ffmpeg: () => Promise<ToolCommand>;
  ffprobe: () => Promise<ToolCommand>;
  /** Render Worker（`export-worker`）的可执行文件；找不到时 null，成片导出以 `EXPORT_TOOL_MISSING` 拒绝。 */
  exportWorker?: () => string | null;
  /** 按需下载的字体（架构设计 §9.1）：不给时只用本机字体。 */
  fonts?: FontService;
  log: Logger;
}

const SPEECH_SCHEMA = 'baocut.speech/1';
const CAPTION_SCHEMA = 'baocut.caption/1';
/** 缺 ffmpeg / ffprobe 时的补救办法（用时取，跟着当前语言）。 */
const toolRemedy = () => ffmpegMissingRemedy({ ffprobe: true });
/** 缺 Render Worker 时的补救办法（用时取，跟着当前语言）。 */
const workerRemedy = () => RcExport.workerRemedy().text;

const MEDIA_TYPES: Record<string, string> = {
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  ass: 'text/x-ssa',
  json: 'application/json',
  md: 'text/markdown',
  txt: 'text/plain',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  baocut: 'application/x-baocut-package',
  xml: 'application/xml',
};

type TextSettings = Extract<ExportSettings, { kind: 'subtitles' | 'transcript' }>;
type AudioSettings = Extract<ExportSettings, { kind: 'audio' }>;
type VideoSettings = Extract<ExportSettings, { kind: 'video' }>;
type PortableSettings = Extract<ExportSettings, { kind: 'portable' }>;
type ProjectSettings = Extract<ExportSettings, { kind: 'project' }>;

interface FrozenOutput {
  range: ExportRange;
  fileName: string;
}

/** 链接素材在预检时看到的文件状态：执行前再比一次，变了就重算摘要。 */
interface LinkedCheck {
  asset: PlannedAsset;
  size: number;
  mtimeMs: number;
}

export class ExportService {
  readonly #jobs: JobManager;
  readonly #videos: VideoService;
  readonly #options: ExportServiceOptions;
  readonly #log: Logger;

  constructor(options: ExportServiceOptions) {
    this.#options = options;
    this.#jobs = options.jobs;
    this.#videos = options.videos;
    this.#log = options.log;
  }

  get(jobId: Id): JobRecord {
    const record = this.#jobs.inspect(jobId);
    if (record.kind !== 'export') throw new RpcError('not-found', RcExport.exportTaskNotFound());
    return record;
  }

  list(videoId?: Id): JobRecord[] {
    return this.#jobs.list(videoId).filter((job) => job.kind === 'export');
  }

  /** 冻结 → 预检 → 存快照 → 排队。预检不过时抛 `RpcError`，不创建任务。 */
  async create(request: ExportCreateRequest, submitter: JobSubmitter): Promise<{ jobId: Id }> {
    const { settings } = request;
    if (!(SUPPORTED_EXPORT_KINDS as readonly string[]).includes(settings.kind)) throw kindUnsupported(settings.kind);
    if (request.commandId) {
      const existing = this.#jobs.jobForCommand(request.commandId);
      if (existing) return { jobId: existing };
    }
    const ref = this.#videos.ref(request.videoId);
    const mirror = this.#videos.mirror(request.videoId);
    if (!ref || !mirror) throw new RpcError('not-found', RcExport.videoNotOpen(), { code: 'VIDEO_NOT_OPEN' });
    const scoped = settings as TextSettings | AudioSettings | VideoSettings;
    const ranges = scoped.ranges ?? (scoped.range ? [scoped.range] : []);
    const destination = request.destination ?? {};
    if (destination.fileName !== undefined && ranges.length > 1) {
      throw new RpcError('invalid-request', RcExport.fileNameWithMultipleRanges());
    }

    const kind = settings.kind;
    if (kind === 'portable') return this.#createPortable(request, settings as PortableSettings, submitter);
    if (kind === 'project') return this.#createProject(request, settings as ProjectSettings, submitter);
    if (kind === 'audio') return this.#createAudio(request, settings as AudioSettings, ranges, submitter);
    if (kind === 'video') return this.#createVideo(request, settings as VideoSettings, ranges, submitter);
    return this.#createText(request, settings as TextSettings, ranges, mirror.video, submitter);
  }

  // ---- 字幕与文稿 ----

  /**
   * 字幕或文稿的正文，不写文件、不建任务（`exports.renderText`）：冻结、预检与写法都与 `exports.create` 是同一段代码
   * （`#planText`、`renderTextPart`），所以正文与导出的文件逐字节相同。不碰目标目录；文件名是默认目标下预计的名字。
   */
  async renderText(request: ExportRenderTextRequest): Promise<ExportRenderTextResult> {
    const settings = request.settings as ExportSettings;
    if (settings.kind !== 'subtitles' && settings.kind !== 'transcript') throw kindUnsupported(settings.kind);
    const ref = this.#videos.ref(request.videoId);
    const mirror = this.#videos.mirror(request.videoId);
    if (!ref || !mirror) throw new RpcError('not-found', RcExport.videoNotOpen(), { code: 'VIDEO_NOT_OPEN' });
    const ranges = settings.ranges ?? (settings.range ? [settings.range] : []);
    const frozen = await this.#planText(request.videoId, settings, ranges, mirror.video);
    const warnings: JobWarning[] = [];
    const outputs = frozen.plan.parts.map((_, i): RenderedTextOutput => {
      const rendered = renderTextPart(frozen, settings, i);
      const fileName = defaultFileName(frozen.plan.videoName, frozen.suffix, settings.format, ranges.length > 1, i);
      for (const warning of rendered.warnings) warnings.push(frozen.plan.parts.length > 1 ? { ...warning, segmentId: fileName } : warning);
      return {
        fileName,
        format: settings.format,
        mediaType: MEDIA_TYPES[settings.format] ?? 'text/plain',
        content: rendered.content,
        entries: rendered.entries,
        durationSec: rendered.durationSec,
        words: rendered.words,
        cjkCharacters: rendered.cjkCharacters,
      };
    });
    return { outputs, warnings };
  }

  /** 选文档、在一个引擎请求里冻结全部范围的计划、预检（文档能不能导、范围里有没有字）。 */
  async #planText(videoId: Id, settings: TextSettings, ranges: ExportRange[], video: VideoSnapshot): Promise<FrozenText> {
    const sequenceId = settings.sequenceId ?? video.rootSequenceId;
    const primaryId = settings.documentId ?? chooseDocument(video, sequenceId, settings);
    const documentIds = [primaryId];
    if (settings.bilingual) documentIds.push(chooseSecondary(video, primaryId, settings.bilingual));
    const plan = await this.#plan<TextPlanResult>(videoId, {
      kind: 'text',
      sequenceId,
      ranges,
      documentIds,
      scopeItemIds: settings.scopeItemIds ?? [],
    });
    const [primary, secondary] = plan.documents as [PlannedDocument, PlannedDocument | undefined];
    if (primary.schema !== SPEECH_SCHEMA && primary.schema !== CAPTION_SCHEMA) {
      throw new RpcError('invalid-request', RcExport.documentNotExportable({ kind: primary.kind }), {
        code: 'EXPORT_SOURCE_UNSUPPORTED',
        schema: primary.schema,
      });
    }
    for (const part of plan.parts) {
      const entries = (part.plans[0] as TextPlan).entries.length;
      if (entries === 0) {
        throw new RpcError('invalid-request', RcExport.nothingInRange(), {
          code: 'EXPORT_NOTHING_TO_EXPORT',
          range: { start: part.plans[0]!.range.startSeconds, end: part.plans[0]!.range.endSeconds },
        });
      }
    }
    // 不跳过剪掉的部分时从正文取条目：转写的正文在计划里，字幕的另外读。
    const bodies = new Map<Id, unknown>();
    if (settings.kind === 'transcript' && settings.skipCut === false) {
      for (const [i, document] of plan.documents.entries()) {
        if (plan.parts[0]?.plans[i] === null) continue;
        bodies.set(
          document.documentId,
          document.body ?? (await this.#videos.document(videoId, document.documentId, document.revision)).body,
        );
      }
    }
    const language = primary.language ?? null;
    const suffix =
      settings.kind === 'transcript'
        ? 'transcript'
        : language
          ? secondary?.language
            ? `${language}-${secondary.language}`
            : language
          : 'subtitles';
    return {
      plan,
      primary,
      secondary,
      suffix,
      bodies,
      chapters: chapterMarkers(video, plan),
      frontMatter: frontMatterOf(video, plan, primary, secondary),
    };
  }

  async #createText(
    request: ExportCreateRequest,
    settings: TextSettings,
    ranges: ExportRange[],
    video: VideoSnapshot,
    submitter: JobSubmitter,
  ): Promise<{ jobId: Id }> {
    const frozen = await this.#planText(request.videoId, settings, ranges, video);
    const { plan, suffix } = frozen;
    const extension = settings.format;
    const { dir, outputs } = await this.#destination(request, plan.videoName, suffix, extension, ranges, plan.parts.length, (i) => {
      const range = plan.parts[i]!.plans[0]!.range;
      return { start: range.startSeconds, end: range.endSeconds };
    });
    const snapshot: ExportSnapshot = {
      schema: 'baocut.export-snapshot/1',
      videoId: plan.videoId,
      videoName: plan.videoName,
      videoRevision: plan.videoRevision,
      sequenceId: plan.sequenceId,
      sequenceRevision: plan.sequenceRevision,
      settings,
      assets: [],
      documents: plan.documents.map((d) => ({
        documentId: d.documentId,
        revision: d.revision,
        kind: d.kind,
        language: d.language ?? null,
        schema: d.schema,
      })),
      parts: outputs.map((o, i) => ({ ...o, plan: plan.parts[i] })),
      output: { dir, overwrite: request.destination?.overwrite === true },
      frozenAt: nowIso(),
    };
    const run = async (task: TaskRun) => {
      const staged: Staged[] = [];
      const failed: Failed[] = [];
      for (const [i, output] of outputs.entries()) {
        throwIfAborted(task.signal);
        task.phase('generating', { done: i, total: outputs.length, unit: 'outputs' });
        const rendered = renderTextPart(frozen, settings, i);
        for (const warning of rendered.warnings) task.warn(outputs.length > 1 ? { ...warning, segmentId: output.fileName } : warning);
        const file = path.join(task.staging, `${i + 1}.${extension}`);
        await fs.writeFile(file, rendered.content, 'utf8');
        task.phase('validating', { done: i, total: outputs.length, unit: 'outputs' });
        const check = checkText(settings.format, await fs.readFile(file, 'utf8'), {
          entries: rendered.entries,
          durationSec: rendered.rangeSec,
          headings: rendered.headings,
        });
        if (!check.ok) {
          failed.push({ fileName: output.fileName, code: 'EXPORT_VALIDATION_FAILED', problems: check.problems });
          continue;
        }
        staged.push({
          file,
          fileName: output.fileName,
          format: extension,
          media: { kind: 'text', entries: check.entries, durationSec: check.durationSec },
          validation: {
            checks: ['parsed', 'entry-count', 'monotonic-times', 'within-range'],
            expectedDurationSec: rendered.rangeSec,
            durationSec: check.durationSec,
            toleranceSec: 0.001,
            expectedEntries: rendered.entries,
            entries: check.entries,
          },
        });
      }
      return this.#publish(task, staged, failed, dir, request);
    };
    return this.#submit(request, settings, snapshot, outputs, dir, submitter, run);
  }

  // ---- 音频 ----

  async #createAudio(
    request: ExportCreateRequest,
    settings: AudioSettings,
    ranges: ExportRange[],
    submitter: JobSubmitter,
  ): Promise<{ jobId: Id }> {
    const output: AudioOutputSettings = {
      format: settings.format,
      sampleRate: settings.sampleRate ?? DEFAULT_SAMPLE_RATE,
      channels: settings.channels ?? DEFAULT_CHANNELS,
      bitrateKbps: settings.bitrateKbps ?? DEFAULT_BITRATE_KBPS,
      loudness: settings.loudness ? { ...DEFAULT_LOUDNESS_TARGET, ...settings.loudness } : null,
    };
    const [ffmpeg, ffprobe] = await Promise.all([this.#options.ffmpeg(), this.#options.ffprobe()]);
    const missing = await missingAudioTools(ffmpeg, ffprobe, output);
    if (missing) {
      throw new RpcError('conflict', RcExport.audioExportNeeds({ missing }), {
        code: 'EXPORT_TOOL_MISSING',
        missing: String(missing),
        remedy: toolRemedy(),
      });
    }
    // 响度标准化由 Render Worker 的母带做。
    const workerCommand = output.loudness ? (this.#options.exportWorker?.() ?? null) : null;
    if (output.loudness && !workerCommand) {
      throw new RpcError('conflict', RcExport.loudnessNeedsWorker(), {
        code: 'EXPORT_TOOL_MISSING',
        missing: 'export-worker',
        remedy: workerRemedy(),
      });
    }
    const master = workerCommand ? masterRunner({ command: workerCommand, env: ffmpeg.env ?? process.env }) : undefined;
    const video = this.#videos.mirror(request.videoId)!.video;
    const audioItems = await audioItemSelection(video, settings.sequenceId ?? video.rootSequenceId, settings.source, async (documentId) => {
      return (await this.#videos.document(request.videoId, documentId)).body;
    });
    const plan = await this.#plan<AudioPlanResult>(request.videoId, {
      kind: 'audio',
      ...(settings.sequenceId ? { sequenceId: settings.sequenceId } : {}),
      ranges,
      ...(audioItems ? { audioItems } : {}),
    });
    const videoDir = this.#videos.ref(request.videoId)!.path;
    const assets = new Map<string, PlannedAsset>();
    const linked: LinkedCheck[] = [];
    for (const asset of plan.assets) {
      const absolute = { ...asset, path: path.isAbsolute(asset.path) ? asset.path : path.join(videoDir, asset.path) };
      assets.set(`${asset.assetId}@${asset.revision}`, absolute);
      if (absolute.storage === 'linked') linked.push(await verifyLinked(absolute));
    }
    const suffix = 'audio';
    const { dir, outputs } = await this.#destination(request, plan.videoName, suffix, settings.format, ranges, plan.parts.length, (i) => {
      const range = plan.parts[i]!.audio.range;
      return { start: range.startSeconds, end: range.endSeconds };
    });
    const snapshot: ExportSnapshot = {
      schema: 'baocut.export-snapshot/1',
      videoId: plan.videoId,
      videoName: plan.videoName,
      videoRevision: plan.videoRevision,
      sequenceId: plan.sequenceId,
      sequenceRevision: plan.sequenceRevision,
      settings,
      assets: [...assets.values()].map((a) => ({
        assetId: a.assetId,
        revision: a.revision,
        name: a.name,
        storage: a.storage,
        path: a.path,
        contentHash: a.contentHash,
        byteLength: a.byteLength,
      })),
      documents: [],
      parts: outputs.map((o, i) => ({ ...o, plan: plan.parts[i] })),
      output: { dir, overwrite: request.destination?.overwrite === true },
      frozenAt: nowIso(),
    };
    const run = async (task: TaskRun) => {
      // 执行前再核对一次链接素材（排队期间文件可能被换掉）。
      for (const check of linked) {
        throwIfAborted(task.signal);
        await recheckLinked(check);
      }
      const total = plan.parts.reduce((sum, p) => sum + p.audio.range.durationSeconds, 0);
      let done = 0;
      const warned = new Set<string>();
      const staged: Staged[] = [];
      const failed: Failed[] = [];
      for (const [i, out] of outputs.entries()) {
        throwIfAborted(task.signal);
        const audio = plan.parts[i]!.audio;
        for (const note of audio.notes) {
          const key = `${note.code}:${note.itemId}`;
          if (warned.has(key)) continue;
          warned.add(key);
          const detail = RcExport.audioNote({ itemId: note.itemId, note: audioNoteText(note.code) ?? note.code });
          task.warn({ code: note.code, detail: detail.text, detailRef: refOf(detail) });
        }
        for (const segment of audio.segments) {
          const key = `GAIN_ABOVE_PREVIEW:${segment.itemId}`;
          // 包络的折点也算：最高的那一点高于 1 时同样比预览响。
          const peak = Math.max(0, ...(segment.envelope ?? []).map(([, gain]) => gain));
          const peakDb = segment.gainDb + (peak > 1 ? 20 * Math.log10(peak) : 0);
          if (peakDb > 0 && !warned.has(key)) {
            warned.add(key);
            const detail = RcExport.gainAbovePreview({ itemId: segment.itemId, gainDb: Number(peakDb.toFixed(2)) });
            task.warn({ code: 'GAIN_ABOVE_PREVIEW', detail: detail.text, detailRef: refOf(detail) });
          }
        }
        task.phase('generating', { done, total, unit: 'seconds' });
        try {
          const rendered = await renderAudio({
            plan: audio,
            assets,
            settings: output,
            staging: task.staging,
            outName: `${i + 1}.${settings.format}`,
            ffmpeg,
            ffprobe,
            ...(master ? { master } : {}),
            signal: task.signal,
            progress: (seconds) => task.phase('generating', { done: Math.round((done + seconds) * 10) / 10, total, unit: 'seconds' }),
          });
          for (const warning of rendered.warnings) task.warn(outputs.length > 1 ? { ...warning, segmentId: out.fileName } : warning);
          staged.push({
            file: rendered.file,
            fileName: out.fileName,
            format: settings.format,
            media: rendered.media,
            validation: rendered.validation,
          });
        } catch (error) {
          if (task.signal.aborted) throw error;
          if (error instanceof AudioValidationError)
            failed.push({ fileName: out.fileName, code: 'EXPORT_VALIDATION_FAILED', problems: error.problems });
          else if (error instanceof ToolFailure && error.kind === 'missing') {
            throw toolMissing(error);
          } else if (error instanceof ToolFailure)
            failed.push({ fileName: out.fileName, code: 'EXPORT_RENDER_FAILED', problems: [error.message] });
          else if (error instanceof WorkerFailure) failed.push({ fileName: out.fileName, code: error.code, problems: [error.message] });
          else throw error;
        }
        done += audio.range.durationSeconds;
      }
      return this.#publish(task, staged, failed, dir, request);
    };
    // 峰值需求（§7.7）：按全部输出的总时长估 staging。
    const resources: TaskResources = {
      demand: audioExportDemand({
        durationSec: plan.parts.reduce((sum, p) => sum + p.audio.range.durationSeconds, 0),
        sampleRate: output.sampleRate,
        channels: output.channels,
        loudness: output.loudness !== null,
      }),
    };
    return this.#submit(request, settings, snapshot, outputs, dir, submitter, run, resources);
  }

  // ---- 成片 ----

  async #createVideo(
    request: ExportCreateRequest,
    settings: VideoSettings,
    ranges: ExportRange[],
    submitter: JobSubmitter,
  ): Promise<{ jobId: Id }> {
    const audioOptions = settings.audio ?? {};
    const audioSettings: AudioOutputSettings = {
      format: 'wav',
      sampleRate: audioOptions.sampleRate ?? DEFAULT_SAMPLE_RATE,
      channels: audioOptions.channels ?? DEFAULT_CHANNELS,
      bitrateKbps: audioOptions.bitrateKbps ?? DEFAULT_VIDEO_AUDIO_KBPS[settings.format],
      loudness: audioOptions.loudness ? { ...DEFAULT_LOUDNESS_TARGET, ...audioOptions.loudness } : null,
    };
    const [ffmpeg, ffprobe] = await Promise.all([this.#options.ffmpeg(), this.#options.ffprobe()]);
    const missing = await missingAudioTools(ffmpeg, ffprobe, audioSettings);
    if (missing) {
      throw new RpcError('conflict', RcExport.videoExportNeeds({ missing }), {
        code: 'EXPORT_TOOL_MISSING',
        missing: String(missing),
        remedy: toolRemedy(),
      });
    }
    const workerCommand = this.#options.exportWorker?.() ?? null;
    if (!workerCommand) {
      throw new RpcError('conflict', RcExport.videoExportNeedsWorker(), {
        code: 'EXPORT_TOOL_MISSING',
        missing: 'export-worker',
        remedy: workerRemedy(),
      });
    }
    const worker: ToolCommand = { command: workerCommand, env: ffmpeg.env ?? process.env };
    // 声音来源与音频导出相同：只换这一次的声音计划，画面与视频不变。
    const video = this.#videos.mirror(request.videoId)!.video;
    const audioItems = await audioItemSelection(video, settings.sequenceId ?? video.rootSequenceId, settings.source, async (documentId) => {
      return (await this.#videos.document(request.videoId, documentId)).body;
    });
    const plan = await this.#plan<VideoPlanResult>(request.videoId, {
      kind: 'video',
      ...(settings.sequenceId ? { sequenceId: settings.sequenceId } : {}),
      ranges,
      ...(audioItems ? { audioItems } : {}),
      // 输出尺寸由引擎定（宽高都给且比例与画布不同时画面居中、其余是黑边）。
      ...(settings.width !== undefined || settings.height !== undefined
        ? {
            output: {
              ...(settings.width !== undefined ? { width: settings.width } : {}),
              ...(settings.height !== undefined ? { height: settings.height } : {}),
            },
          }
        : {}),
    });
    const size = plan.output;
    const output: VideoOutput = {
      format: settings.format,
      codec: settings.codec ?? (settings.format === 'webm' ? 'vp9' : 'h264'),
      width: size.width,
      height: size.height,
      picture: size.picture,
      fps: settings.fps ?? plan.fps,
      crf: settings.crf ?? null,
      bitrateKbps: settings.bitrateKbps ?? null,
      audioBitrateKbps: audioSettings.bitrateKbps,
    };
    const onUnsupported = settings.onUnsupported ?? 'fail';
    const burnCaptions = settings.burnCaptions ?? true;
    const videoDir = this.#videos.ref(request.videoId)!.path;
    const assets = new Map<string, PlannedAsset>();
    const linked: LinkedCheck[] = [];
    for (const asset of plan.assets) {
      const absolute = { ...asset, path: path.isAbsolute(asset.path) ? asset.path : path.join(videoDir, asset.path) };
      assets.set(`${asset.assetId}@${asset.revision}`, absolute);
      if (absolute.storage === 'linked') linked.push(await verifyLinked(absolute));
    }
    // 冻结的本机字体：预检之后才知道（预检的输入里没有）。
    let fonts: ExportFontFace[] = [];
    const inputOf = (part: number, outputPath: string, audioPath: string | null) =>
      workerInput({
        plan,
        part,
        assets,
        output,
        outputPath,
        audioPath,
        burnCaptions,
        onUnsupported,
        fonts,
        ffmpeg: ffmpeg.command,
        ffprobe: ffprobe.command,
      });

    // 预检：每段范围里画不出来的内容、素材能不能解出画面、编码器在不在。不过就不创建任务。
    const preflightDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-export-preflight-'));
    const frames: number[] = [];
    const preflightWarnings: JobWarning[] = [];
    const unsupported = new Map<string, UnsupportedItem>();
    const faces = new Map<string, FontFaceQuery>();
    try {
      for (const i of plan.parts.keys()) {
        const file = path.join(preflightDir, `${i + 1}.json`);
        await fs.writeFile(file, JSON.stringify(inputOf(i, path.join(preflightDir, 'out'), path.join(preflightDir, 'audio.wav'))));
        let report: Extract<WorkerEvent, { event: 'preflight' }>;
        try {
          report = (await runWorker(worker, 'preflight', file)) as typeof report;
        } catch (error) {
          throw workerRpcError(error);
        }
        if (report.missingEncoders.length > 0) {
          const encoders = report.missingEncoders.join(RcExport.listSeparator().text);
          throw new RpcError('conflict', RcExport.videoExportNeedsEncoders({ encoders }), {
            code: 'EXPORT_TOOL_MISSING',
            missing: report.missingEncoders.join(', '),
            remedy: toolRemedy(),
          });
        }
        frames.push(report.frames);
        for (const item of report.items) unsupported.set(itemKey(item), item);
        for (const face of report.faces ?? []) faces.set(`${face.family}\u0000${face.weight}\u0000${face.italic}`, face);
        for (const warning of report.warnings) {
          if (!preflightWarnings.some((w) => w.code === warning.code && w.detail === warning.detail)) preflightWarnings.push(warning);
        }
      }
    } finally {
      await fs.rm(preflightDir, { recursive: true, force: true });
    }
    const items = [...unsupported.values()];
    if (items.length > 0 && onUnsupported === 'fail') {
      const listed = items.map((i) => i.message).join(RcExport.clauseSeparator().text);
      throw new RpcError('invalid-request', RcExport.unsupportedContent({ count: items.length, items: listed }), {
        code: 'EXPORT_UNSUPPORTED_CONTENT',
        items,
        remedy: RcExport.unsupportedContentRemedy().text,
      });
    }
    const frozenFonts = await this.#freezeFonts([...faces.values()]);
    fonts = frozenFonts.fonts;

    // 画面里烧着字幕时，默认文件名带上这些字幕的语言（「视频名.zh-Hans.mp4」），与字幕导出的后缀同一个写法。
    const sequence = video.sequences[settings.sequenceId ?? video.rootSequenceId];
    const suffix = burnCaptions && sequence ? burnedCaptionLanguages(sequence, video.documents).join('-') : '';
    const { dir, outputs } = await this.#destination(request, plan.videoName, suffix, settings.format, ranges, plan.parts.length, (i) => {
      const range = plan.parts[i]!.video.range;
      return { start: range.startSeconds, end: range.endSeconds };
    });
    const snapshot: ExportSnapshot = {
      schema: 'baocut.export-snapshot/1',
      videoId: plan.videoId,
      videoName: plan.videoName,
      videoRevision: plan.videoRevision,
      sequenceId: plan.sequenceId,
      sequenceRevision: plan.sequenceRevision,
      settings,
      assets: [...assets.values()].map((a) => ({
        assetId: a.assetId,
        revision: a.revision,
        name: a.name,
        storage: a.storage,
        path: a.path,
        contentHash: a.contentHash,
        byteLength: a.byteLength,
      })),
      fonts,
      documents: plan.documents
        .filter((d) => d.revision !== null && d.kind !== null && d.schema !== null)
        .map((d) => ({ documentId: d.documentId, revision: d.revision!, kind: d.kind!, language: null, schema: d.schema! })),
      parts: outputs.map((o, i) => ({ ...o, plan: plan.parts[i] })),
      render: { document: plan.document, documents: plan.documents },
      output: { dir, overwrite: request.destination?.overwrite === true },
      frozenAt: nowIso(),
    };
    const run = async (task: TaskRun) => {
      for (const check of linked) {
        throwIfAborted(task.signal);
        await recheckLinked(check);
      }
      // 字体目录里有、还没下载的字体：开始画之前下载，下载好的冻结进这次渲染；不下载或下载不成的照回退字体画。
      fonts = await this.#downloadFonts(task, fonts, frozenFonts.notes);
      if (size.adjusted) {
        const { width, height } = size;
        const detail =
          size.picture.width === width && size.picture.height === height
            ? RcExport.outputSizeAdjusted({ width, height, canvasWidth: plan.canvas.width, canvasHeight: plan.canvas.height })
            : RcExport.outputSizeLetterboxed({ width, height, pictureWidth: size.picture.width, pictureHeight: size.picture.height });
        task.warn({ code: 'EXPORT_SIZE_ADJUSTED', detail: detail.text, detailRef: refOf(detail) });
      }
      for (const warning of preflightWarnings) task.warn(warning);
      const total = frames.reduce((sum, n) => sum + n, 0);
      let done = 0;
      const warned = new Set<string>();
      const staged: Staged[] = [];
      const failed: Failed[] = [];
      for (const [i, out] of outputs.entries()) {
        throwIfAborted(task.signal);
        const part = plan.parts[i]!;
        task.phase('generating', { done, total, unit: 'frames' });
        try {
          // 声音：与音频导出同一套混音，写成 WAV 交给 Worker 封装。
          const audio = await renderAudio({
            plan: part.audio,
            assets,
            settings: audioSettings,
            staging: task.staging,
            outName: `${i + 1}.audio.wav`,
            ffmpeg,
            ffprobe,
            master: masterRunner(worker),
            signal: task.signal,
          });
          for (const warning of audio.warnings) task.warn(outputs.length > 1 ? { ...warning, segmentId: out.fileName } : warning);
          const outFile = path.join(task.staging, `${i + 1}.${settings.format}`);
          const inputFile = path.join(task.staging, `${i + 1}.input.json`);
          await fs.writeFile(inputFile, JSON.stringify(inputOf(i, outFile, audio.file)));
          const result = (await runWorker(worker, 'render', inputFile, {
            signal: task.signal,
            onProgress: (frame) => task.phase('generating', { done: done + frame, total, unit: 'frames' }),
          })) as Extract<WorkerEvent, { event: 'done' }>;
          for (const item of result.skipped) {
            const key = itemKey(item);
            if (warned.has(key)) continue;
            warned.add(key);
            task.warn(skippedWarning(item));
          }
          // 合成时才知道的警告（字体替换、缺字）；预检时已经报过的不重复。
          for (const warning of result.warnings) {
            const key = `warning:${warning.code}|${warning.detail}`;
            if (warned.has(key) || preflightWarnings.some((w) => w.code === warning.code && w.detail === warning.detail)) continue;
            warned.add(key);
            task.warn(warning);
          }
          this.#log.info('Video export rendered', {
            jobId: task.jobId,
            frames: result.frames,
            renderSeconds: result.renderSeconds,
            decoderRestarts: result.decoderRestarts,
            ...(result.video
              ? {
                  videoDecoder: result.video.decoder,
                  videoEncoder: result.video.encoder,
                  videoFallbacks: result.video.fallbacks.map((f) => `${f.scope}:${f.reason}${f.assetId ? `@${f.assetId}` : ''}`),
                }
              : {}),
          });
          task.phase('validating', { done: done + result.frames, total, unit: 'frames' });
          const probed = await probeVideo(ffprobe, outFile, task.signal);
          const check = checkVideo(probed, { frames: frames[i]!, output, audio: true });
          if (check.problems.length > 0) {
            failed.push({ fileName: out.fileName, code: 'EXPORT_VALIDATION_FAILED', problems: check.problems });
          } else {
            staged.push({
              file: outFile,
              fileName: out.fileName,
              format: settings.format,
              media: check.media,
              validation: { ...check.validation, ...(audio.validation.loudness ? { loudness: audio.validation.loudness } : {}) },
            });
          }
          await fs.rm(audio.file, { force: true });
        } catch (error) {
          if (task.signal.aborted) throw error;
          if (error instanceof AudioValidationError)
            failed.push({ fileName: out.fileName, code: 'EXPORT_VALIDATION_FAILED', problems: error.problems });
          else if (error instanceof ToolFailure && error.kind === 'missing') {
            throw toolMissing(error);
          } else if (error instanceof ToolFailure)
            failed.push({ fileName: out.fileName, code: 'EXPORT_RENDER_FAILED', problems: [error.message] });
          else if (error instanceof WorkerFailure) {
            // 冻结之后素材或字体变了、工具不见了：整个任务失败；画到一半出错：这一个输出失败。
            if (
              error.code === 'EXPORT_UNSUPPORTED_CONTENT' ||
              error.code === 'EXPORT_TOOL_MISSING' ||
              error.code === 'FONT_MISSING' ||
              error.code.startsWith('ASSET_')
            )
              throw taskFailureOf(error.code, error, error.details);
            failed.push({ fileName: out.fileName, code: error.code, problems: [error.message] });
          } else throw error;
        }
        done += frames[i]!;
      }
      return this.#publish(task, staged, failed, dir, request);
    };
    // 峰值需求（§7.7）：输出尺寸、帧率与全部输出的总时长；各段依次渲染，内存按一段计，staging 按全部计（发布前都留着）。
    const resources: TaskResources = {
      demand: videoExportDemand({
        width: output.width,
        height: output.height,
        fps: output.fps.num / output.fps.den,
        durationSec: plan.parts.reduce((sum, p) => sum + p.video.range.durationSeconds, 0),
        bitrateKbps: output.bitrateKbps,
        audioBitrateKbps: output.audioBitrateKbps,
        sampleRate: audioSettings.sampleRate,
        channels: audioSettings.channels,
        loudness: audioSettings.loudness !== null,
      }),
    };
    const submitted = await this.#submit(request, settings, snapshot, outputs, dir, submitter, run, resources);
    // 冻结了的下载缓存里的文件、在等下载的 face：任务结束之前不让 `fonts.remove` / `fonts.clear` 删。
    this.#options.fonts?.pin(submitted.jobId, {
      files: (snapshot.fonts ?? []).flatMap((f) => ('path' in f && f.source === 'downloaded' ? [f.path] : [])),
      faces: (snapshot.fonts ?? []).filter((f) => 'download' in f),
    });
    return submitted;
  }

  /**
   * 成片的本机字体冻结（架构设计 §9.11 的「字体」）：预检报的 face（随渲染内核的字体里没有的族）经引擎挑好，记下所在文件、
   * 第几个与整个文件的摘要和字节数（与冻结素材同一个摘要写法；几个 face 共用一个字体集合时只算一次）。找不到的记
   * `fallback`，照回退字体画、结果里有提示，不拒绝导出。
   */
  async #freezeFonts(faces: FontFaceQuery[]): Promise<{ fonts: ExportFontFace[]; notes: Map<string, string> }> {
    const frozen: ExportFontFace[] = [];
    /** 不下载的 face 的原因（`FONT_NOT_DOWNLOADED` 警告），按 `queryKey`。 */
    const notes = new Map<string, string>();
    // 引擎只接受 1–200 字的族名：别的不会是本机字体的名字。
    const asked = faces.filter((face) => {
      const family = face.family.trim();
      const usable = family.length > 0 && family.length <= 200;
      if (!usable) frozen.push({ family: face.family, weight: face.weight, italic: face.italic, fallback: 'not-found' });
      return usable;
    });
    const plans = this.#options.fonts ? await this.#options.fonts.planExport(asked) : new Map<string, ExportFacePlan>();
    const toEngine: FontFaceQuery[] = [];
    for (const face of asked) {
      const plan = plans.get(queryKey(face));
      const query = { family: face.family.trim(), weight: face.weight, italic: face.italic };
      if (plan?.kind === 'download') frozen.push({ ...query, download: 'google-fonts' });
      else {
        if (plan?.kind === 'skip') notes.set(queryKey(query), plan.reason);
        toEngine.push(query);
      }
    }
    frozen.push(...(await this.#resolveFonts(toEngine, notes)));
    return { fonts: frozen, notes };
  }

  /** 经引擎挑 face、记下文件与摘要（几个 face 共用一个字体集合时只算一次）。有不下载原因的找不到时记 `not-downloaded`。 */
  async #resolveFonts(faces: FontFaceQuery[], notes: ReadonlyMap<string, string>): Promise<ExportFontFace[]> {
    const frozen: ExportFontFace[] = [];
    const digests = new Map<string, Promise<{ contentHash: string; byteLength: number } | null>>();
    const digest = (file: string) => {
      let found = digests.get(file);
      if (!found) {
        found = Promise.all([fs.stat(file), sha256File(file)]).then(
          ([stat, contentHash]) => ({ contentHash, byteLength: stat.size }),
          () => null,
        );
        digests.set(file, found);
      }
      return found;
    };
    for (let start = 0; start < faces.length; start += 32) {
      const resolved = await this.#videos.fontFaces(faces.slice(start, start + 32));
      for (const face of resolved.faces) {
        const query = { family: face.family, weight: face.weight, italic: face.italic };
        const file = await digest(face.path);
        frozen.push(
          file
            ? {
                ...query,
                path: face.path,
                faceIndex: face.faceIndex,
                ...file,
                ...(face.source === 'downloaded' ? { source: 'downloaded' as const } : {}),
              }
            : { ...query, fallback: 'not-found' },
        );
      }
      for (const missing of resolved.missing) {
        const query = { family: missing.family, weight: missing.weight, italic: missing.italic };
        const fallback = missing.reason === 'too-large' ? 'too-large' : notes.has(queryKey(query)) ? 'not-downloaded' : 'not-found';
        frozen.push({ ...query, fallback });
      }
    }
    return frozen;
  }

  /**
   * 导出任务开始画之前（§9.1）：冻结时记 `download` 的 face 在这里下载（进度按字节、取消随任务），下载好的按同样的写法冻结
   * （文件钉住到任务结束）；下载不成的、冻结时就不下载（自动下载关着、严格离线）而本机也没有的，记一条 `FONT_NOT_DOWNLOADED`
   * 警告说明原因（`font` 带族、字重、回退族与原因），照回退字体画：不拒绝导出，也不要用户先选替代字体。
   */
  async #downloadFonts(task: TaskRun, fonts: ExportFontFace[], notes: ReadonlyMap<string, string>): Promise<ExportFontFace[]> {
    const service = this.#options.fonts;
    const warn = (face: FontFaceQuery, reason: string | Localized) => {
      const { family, weight, italic } = face;
      const detail = RcExport.fontNotDownloaded({ family, weight, italic, reason, fallback: FALLBACK_FONT_FAMILY });
      task.warn({
        code: 'FONT_NOT_DOWNLOADED',
        detail: detail.text,
        detailRef: refOf(detail),
        font: { family, weight, italic, fallback: FALLBACK_FONT_FAMILY, reason: String(reason) },
      });
    };
    for (const face of fonts) {
      if ('fallback' in face && face.fallback === 'not-downloaded') warn(face, notes.get(queryKey(face)) ?? RcExport.fontNotDownloadedReason());
    }
    const pending = fonts.filter((f) => 'download' in f).map(({ family, weight, italic }) => ({ family, weight, italic }));
    if (pending.length === 0) return fonts;
    const reasons = new Map<string, string>();
    if (service) {
      task.phase('downloading', { done: 0, total: null, unit: 'bytes' });
      const outcomes = await service.ensureForExport(pending, task.jobId, task.signal, (done, total) =>
        task.phase('downloading', { done, total, unit: 'bytes' }),
      );
      for (const [key, reason] of outcomes) if (reason) reasons.set(key, reason);
    }
    throwIfAborted(task.signal);
    const ready = pending.filter((face) => service && !reasons.has(queryKey(face)));
    const resolved = await this.#resolveFonts(ready, new Map(ready.map((face) => [queryKey(face), RcExport.fontStillMissingAfterDownload().text])));
    const byKey = new Map(resolved.map((face) => [queryKey(face), face]));
    if (service) service.pin(task.jobId, { files: resolved.flatMap((f) => ('path' in f ? [f.path] : [])) });
    return fonts.map((face) => {
      if (!('download' in face)) return face;
      const query = { family: face.family, weight: face.weight, italic: face.italic };
      const found = byKey.get(queryKey(query));
      if (found && 'path' in found) return found;
      warn(query, reasons.get(queryKey(query)) ?? (service ? RcExport.fontStillMissingAfterDownload() : RcExport.fontDownloadUnavailable()));
      return { ...query, fallback: 'not-downloaded' as const };
    });
  }

  // ---- 便携包 ----

  /**
   * 便携包（架构设计 §5.8）：引擎一次冻结快照、文档正文与素材位置；预检读不到的素材、本机路径、tar 的限制、目标与空间，
   * 都过了才排队。任务把包直接写到目标目录里的隐藏临时文件，写完从归档里重新读一遍、按清单核对每个文件，
   * 全对才挂到最终的名字上；取消与失败删掉临时文件，不留半个包。
   */
  async #createPortable(request: ExportCreateRequest, settings: PortableSettings, submitter: JobSubmitter): Promise<{ jobId: Id }> {
    const ref = this.#videos.ref(request.videoId)!;
    const freeze = await this.#videos.freezePackage<PackageFreeze>(request.videoId);
    const roots = await localRoots(freeze, [sourceRoot(ref)]);
    const plan = await planPortable(freeze, roots, settings.missingAssets ?? 'fail');
    const video = freeze.snapshot;
    const { dir, outputs } = await this.#destination(request, video.name, '', PACKAGE_EXTENSION, [], 1, () => ({ start: 0, end: 0 }));
    await checkSpace(dir, plan.bytes);
    const output = outputs[0]!;
    const snapshot: ExportSnapshot = {
      schema: 'baocut.export-snapshot/1',
      videoId: video.id,
      videoName: video.name,
      videoRevision: video.revision,
      sequenceId: video.rootSequenceId,
      sequenceRevision: video.sequences[video.rootSequenceId]?.revision ?? video.revision,
      settings,
      assets: frozenAssets(freeze),
      documents: freeze.documents.map((d) => ({
        documentId: d.documentId,
        revision: d.revision,
        kind: video.documents[d.documentId]?.kind ?? 'unknown',
        language: video.documents[d.documentId]?.language ?? null,
        schema: documentSchema(d.text),
      })),
      parts: [{ ...output, plan: { entries: plan.entries, bytes: plan.bytes } }],
      output: { dir, overwrite: request.destination?.overwrite === true },
      frozenAt: nowIso(),
    };
    const run = async (task: TaskRun) => {
      for (const warning of plan.warnings) task.warn(warning);
      const tmp = hiddenTemp(dir, output.fileName);
      try {
        task.phase('generating', { done: 0, total: plan.bytes, unit: 'bytes' });
        let manifest: PackageManifest;
        try {
          manifest = await writePortable(plan, tmp, nowIso(), task.signal, (done, total) =>
            task.phase('generating', { done, total, unit: 'bytes' }),
          );
        } catch (error) {
          throwIfAborted(task.signal);
          if (error instanceof PackageAssetChanged) {
            throw taskFailureOf('ASSET_CHANGED', error, { assetId: error.assetId, revision: error.revision });
          }
          if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
            throw taskFailure('EXPORT_INSUFFICIENT_SPACE', RcPackage.diskFullWhileWriting(), { dir });
          }
          throw error;
        }
        throwIfAborted(task.signal);
        task.phase('validating', { done: 0, total: manifest.files.length, unit: 'outputs' });
        let verified: Awaited<ReturnType<typeof readPackage>>;
        try {
          verified = await readPackage(tmp, {
            signal: task.signal,
            progress: (done, total) => task.phase('validating', { done, total, unit: 'outputs' }),
          });
        } catch (error) {
          throwIfAborted(task.signal);
          throw taskFailure('EXPORT_VALIDATION_FAILED', RcPackage.packageVerifyFailed({ error: localizedOf(error) }), {
            fileName: output.fileName,
          });
        }
        if (canonicalJson(verified.manifest) !== canonicalJson(manifest)) {
          throw taskFailure('EXPORT_VALIDATION_FAILED', RcPackage.manifestReadBackMismatch(), { fileName: output.fileName });
        }
        const artifactId = await sha256OfFile(tmp);
        const { size } = await fs.stat(tmp);
        throwIfAborted(task.signal);
        task.phase('publishing');
        let final: string;
        try {
          final = await publishInPlace(tmp, dir, output.fileName, {
            overwrite: request.destination?.overwrite === true,
            fixed: request.destination?.fileName !== undefined,
          });
        } catch (error) {
          if (error instanceof DestinationError) throw taskFailureOf(error.code, error, { path: error.path });
          throw taskFailureOf('EXPORT_PUBLISH_FAILED', error);
        }
        const result: GeneratedOutput = {
          // 包不进产物库（它已经是一个完整的文件，常常很大）：`artifactId` 是包文件的摘要。
          artifactId,
          mediaType: MEDIA_TYPES[PACKAGE_EXTENSION]!,
          byteLength: size,
          assetId: null,
          media: {
            kind: 'package',
            files: manifest.files.length,
            assets: manifest.entries.filter((e) => e.kind === 'asset' && e.inclusion === 'included').length,
            missingAssets: manifest.entries.filter((e) => e.inclusion === 'missing').length,
            documents: manifest.entries.filter((e) => e.kind === 'document').length,
          },
          path: final,
          format: PACKAGE_EXTENSION,
          validation: {
            checks: ['archive-readable', 'manifest-matches', 'file-digests', 'asset-digests'],
            expectedDurationSec: 0,
            durationSec: 0,
            toleranceSec: 0,
            package: { files: manifest.files.length, verifiedFiles: verified.files, bytes: verified.bytes },
          },
        };
        return { documentId: null, artifactId, outputs: [result] };
      } finally {
        await fs.rm(tmp, { force: true }).catch(() => {});
      }
    };
    return this.#submit(request, settings, snapshot, outputs, dir, submitter, run);
  }

  // ---- 工程 ----

  /**
   * 工程导出（架构设计 §9.13）：一条序列写成 xmeml，素材按引用（本机路径）写出；表达不了的对象逐项记成任务警告。
   * 读不到的素材不拒绝：工程里是离线的片段，警告里点名。
   */
  async #createProject(request: ExportCreateRequest, settings: ProjectSettings, submitter: JobSubmitter): Promise<{ jobId: Id }> {
    const freeze = await this.#videos.freezePackage<PackageFreeze>(request.videoId);
    const video = freeze.snapshot;
    const sequenceId = settings.sequenceId ?? video.rootSequenceId;
    if (!video.sequences[sequenceId]) {
      throw new RpcError('invalid-request', RcExport.sequenceNotFound({ sequenceId }), { code: 'EXPORT_SOURCE_NOT_FOUND', sequenceId });
    }
    const locations = new Map(
      freeze.assets.map((a) => [
        `${a.assetId}@${a.revision}`,
        a.missing || !a.path ? { missing: { reason: a.missing?.reason ?? 'missing' } } : { path: a.path },
      ]),
    );
    const rendered = renderXmeml(video, sequenceId, locations);
    if (rendered.clips === 0) {
      throw new RpcError('invalid-request', RcExport.projectNothingToExport(), {
        code: 'EXPORT_NOTHING_TO_EXPORT',
        omitted: rendered.omitted.length,
      });
    }
    const { dir, outputs } = await this.#destination(request, video.name, 'xmeml', 'xml', [], 1, () => ({
      start: 0,
      end: rendered.durationSec,
    }));
    const output = outputs[0]!;
    const snapshot: ExportSnapshot = {
      schema: 'baocut.export-snapshot/1',
      videoId: video.id,
      videoName: video.name,
      videoRevision: video.revision,
      sequenceId,
      sequenceRevision: video.sequences[sequenceId]!.revision,
      settings,
      assets: frozenAssets(freeze),
      documents: [],
      parts: [{ ...output, plan: { clips: rendered.clips, omitted: rendered.omitted } }],
      output: { dir, overwrite: request.destination?.overwrite === true },
      frozenAt: nowIso(),
    };
    const run = async (task: TaskRun) => {
      for (const o of rendered.omitted) task.warn({ code: 'PROJECT_ITEM_OMITTED', detail: o.what, ...(o.whatRef ? { detailRef: o.whatRef } : {}) });
      throwIfAborted(task.signal);
      task.phase('generating', { done: 0, total: 1, unit: 'outputs' });
      const file = path.join(task.staging, '1.xml');
      await fs.writeFile(file, rendered.xml, 'utf8');
      task.phase('validating', { done: 0, total: 1, unit: 'outputs' });
      const text = await fs.readFile(file, 'utf8');
      const clips = (text.match(/<clipitem /g) ?? []).length;
      if (!text.startsWith('<?xml') || !text.trimEnd().endsWith('</xmeml>') || clips !== rendered.clips) {
        const failed = [{ fileName: output.fileName, code: 'EXPORT_VALIDATION_FAILED', problems: [RcExport.xmlIncomplete().text] }];
        return this.#publish(task, [], failed, dir, request);
      }
      const staged: Staged = {
        file,
        fileName: output.fileName,
        format: 'xml',
        media: { kind: 'project', clips, omitted: rendered.omitted.length, durationSec: rendered.durationSec },
        validation: {
          checks: ['parsed', 'clip-count'],
          expectedDurationSec: rendered.durationSec,
          durationSec: rendered.durationSec,
          toleranceSec: 0,
          expectedEntries: rendered.clips,
          entries: clips,
        },
      };
      return this.#publish(task, [staged], [], dir, request);
    };
    return this.#submit(request, settings, snapshot, outputs, dir, submitter, run);
  }

  // ---- 字体清点（`fonts.usage`） ----

  /**
   * 视频用到的字体（架构设计 §9.1 `fonts.usage`）：与成片导出同一份冻结（整条根序列、烧字幕）交给 Render Worker 的
   * `census` 排一遍字，返回点了名的全部 face 与内核的回退族。不预检素材与编码器、不建任务、不下载。字体只看文字与字幕：
   * 不冻结素材（`skipAssets`），没有素材、素材文件不见了或变了都照样清点。
   */
  async fontCensus(params: { videoId: Id; sequenceId?: Id; burnCaptions?: boolean }): Promise<Extract<WorkerEvent, { event: 'census' }>> {
    if (!this.#videos.mirror(params.videoId)) throw new RpcError('not-found', RcExport.videoNotOpen(), { code: 'VIDEO_NOT_OPEN' });
    const workerCommand = this.#options.exportWorker?.() ?? null;
    if (!workerCommand) {
      throw new RpcError('conflict', RcExport.fontCensusNeedsWorker(), {
        code: 'EXPORT_TOOL_MISSING',
        missing: 'export-worker',
        remedy: workerRemedy(),
      });
    }
    const [ffmpeg, ffprobe] = await Promise.all([this.#options.ffmpeg(), this.#options.ffprobe()]);
    const worker: ToolCommand = { command: workerCommand, env: ffmpeg.env ?? process.env };
    let plan: VideoPlanResult;
    try {
      plan = await this.#plan<VideoPlanResult>(params.videoId, {
        kind: 'video',
        ...(params.sequenceId ? { sequenceId: params.sequenceId } : {}),
        ranges: [],
        skipAssets: true,
      });
    } catch (error) {
      // 空的序列：没有要排的字。
      if (error instanceof RpcError && (error.details as { code?: string } | undefined)?.code === 'EXPORT_RANGE_EMPTY') {
        return { event: 'census', faces: [], fallback: FALLBACK_FONT_FAMILY };
      }
      throw error;
    }
    const size = plan.output;
    const output: VideoOutput = {
      format: 'mp4',
      codec: 'h264',
      width: size.width,
      height: size.height,
      picture: size.picture,
      fps: plan.fps,
      crf: null,
      bitrateKbps: null,
      audioBitrateKbps: DEFAULT_VIDEO_AUDIO_KBPS.mp4,
    };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-font-census-'));
    const faces = new Map<string, Extract<WorkerEvent, { event: 'census' }>['faces'][number]>();
    let fallback = FALLBACK_FONT_FAMILY;
    try {
      for (const i of plan.parts.keys()) {
        const file = path.join(dir, `${i + 1}.json`);
        const input = workerInput({
          plan,
          part: i,
          assets: new Map(),
          output,
          outputPath: path.join(dir, 'out'),
          audioPath: null,
          burnCaptions: params.burnCaptions ?? true,
          onUnsupported: 'skip',
          ffmpeg: ffmpeg.command,
          ffprobe: ffprobe.command,
        });
        await fs.writeFile(file, JSON.stringify(input));
        let report: Extract<WorkerEvent, { event: 'census' }>;
        try {
          report = await runWorker(worker, 'census', file);
        } catch (error) {
          throw workerRpcError(error);
        }
        fallback = report.fallback;
        for (const face of report.faces) faces.set(`${face.family}\u0000${face.weight}\u0000${face.italic}`, face);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
    return { event: 'census', faces: [...faces.values()], fallback };
  }

  // ---- 共用 ----

  /** 引擎的冻结；引擎的错误码换成协议的（`EXPORT_*` 是请求的问题，链接素材变了是 `ASSET_CHANGED`）。 */
  async #plan<T>(videoId: Id, params: Record<string, unknown>): Promise<T> {
    try {
      return await this.#videos.exportPlan<T>(videoId, params);
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      const details = (error.details ?? {}) as { code?: string; details?: { reason?: string } };
      if (details.code === 'ASSET_MISSING' && details.details?.reason === 'changed') {
        throw new RpcError('conflict', error.message, { ...details, code: 'ASSET_CHANGED' }, error.messageRef);
      }
      if (details.code === 'ASSET_MISSING') throw new RpcError('conflict', error.message, details, error.messageRef);
      if (details.code?.startsWith('EXPORT_') || details.code === 'ITEM_NOT_FOUND')
        throw new RpcError('invalid-request', error.message, details, error.messageRef);
      throw error;
    }
  }

  /** 目标目录与每个输出的文件名；预检目录可写、给定的文件名不存在（除非覆盖）。 */
  async #destination(
    request: ExportCreateRequest,
    videoName: string,
    suffix: string,
    extension: string,
    ranges: ExportRange[],
    parts: number,
    rangeOf: (i: number) => ExportRange,
  ): Promise<{ dir: string; outputs: FrozenOutput[] }> {
    const destination = request.destination ?? {};
    const ref = this.#videos.ref(request.videoId)!;
    try {
      const dir = await prepareDirectory(destination.dir ?? path.join(sourceRoot(ref), 'exports'), destination.dir === undefined);
      const outputs = Array.from({ length: parts }, (_, i) => ({
        range: rangeOf(i),
        fileName:
          destination.fileName !== undefined
            ? withExtension(destination.fileName, extension)
            : defaultFileName(videoName, suffix, extension, ranges.length > 1, i),
      }));
      if (destination.fileName !== undefined) await checkFixedName(dir, outputs[0]!.fileName, destination.overwrite === true);
      return { dir, outputs };
    } catch (error) {
      if (error instanceof DestinationError) throw error.toRpc();
      throw error;
    }
  }

  async #submit(
    request: ExportCreateRequest,
    settings: ExportSettings,
    snapshot: ExportSnapshot,
    outputs: FrozenOutput[],
    dir: string,
    submitter: JobSubmitter,
    run: (task: TaskRun) => Promise<NonNullable<JobRecord['result']>>,
    resources?: TaskResources,
  ): Promise<{ jobId: Id }> {
    // 这台机器永远放不下的导出不建任务（`RESOURCE_ADMISSION_UNSATISFIABLE`），也不留下快照。
    const exceeded = resources ? this.#jobs.resources.check({ owner: '', label: `export:${settings.kind}`, ...resources }) : null;
    if (exceeded) {
      const { messageRef } = exceeded as { messageRef?: MessageRef };
      throw new RpcError('conflict', exceeded.message, { code: exceeded.code, dimensions: exceeded.dimensions }, messageRef);
    }
    const { artifactId } = await this.#jobs.artifacts.put(Buffer.from(`${JSON.stringify(snapshot)}\n`), 'json');
    const { jobId } = this.#jobs.submitTask(
      {
        kind: 'export',
        spec: { task: 'export', snapshotArtifactId: artifactId },
        videoId: request.videoId,
        // 输入就是冻结的快照：同一份快照得到同样的输出。
        contentHash: artifactId,
        inputHash: `sha256:${sha256Hex(canonicalJson({ task: 'export', snapshotArtifactId: artifactId }))}`,
        providerId: 'local',
        modelId: `export:${settings.kind}`,
        extra: {
          export: {
            settings,
            snapshotArtifactId: artifactId,
            videoRevision: snapshot.videoRevision,
            sequenceId: snapshot.sequenceId,
            destination: { dir, files: outputs.map((o) => o.fileName), overwrite: request.destination?.overwrite === true },
          },
        },
        ...(request.commandId ? { commandId: request.commandId } : {}),
        queue: { key: 'export', concurrency: 2 },
        ...(resources ? { resources } : {}),
        run,
      },
      submitter,
    );
    this.#log.info('Export queued', {
      jobId,
      videoId: request.videoId,
      kind: settings.kind,
      outputs: outputs.length,
      videoRevision: snapshot.videoRevision,
    });
    return { jobId };
  }

  /** 取消检查在发布之前；开始发布之后不再中途停下（发布了的文件就是结果）。每个文件各自发布、各自登记。 */
  async #publish(
    task: TaskRun,
    staged: Staged[],
    failed: Failed[],
    dir: string,
    request: ExportCreateRequest,
  ): Promise<NonNullable<JobRecord['result']>> {
    throwIfAborted(task.signal);
    task.phase('publishing');
    const outputs: GeneratedOutput[] = [];
    for (const item of staged) {
      try {
        const final = await publishFile(item.file, dir, item.fileName, {
          overwrite: request.destination?.overwrite === true,
          fixed: request.destination?.fileName !== undefined,
        });
        const artifact = await this.#jobs.artifacts.putFile(item.file, item.format as ArtifactExtension);
        outputs.push({
          artifactId: artifact.artifactId,
          mediaType: MEDIA_TYPES[item.format] ?? 'application/octet-stream',
          byteLength: artifact.byteLength,
          assetId: null,
          media: item.media,
          path: final,
          format: item.format,
          validation: item.validation,
        });
      } catch (error) {
        const code = error instanceof DestinationError ? error.code : 'EXPORT_PUBLISH_FAILED';
        failed.push({ fileName: item.fileName, code, problems: [error instanceof Error ? error.message : String(error)] });
      }
    }
    const result = outputs.length > 0 ? { documentId: null, artifactId: outputs[0]!.artifactId, outputs } : null;
    if (failed.length === 0 && result) return result;
    if (!result) {
      const code =
        failed.length === 1
          ? failed[0]!.code
          : failed.every((f) => f.code === failed[0]!.code)
            ? failed[0]!.code
            : 'EXPORT_VALIDATION_FAILED';
      const message =
        failed.length === 1
          ? RcExport.fileNotExported({
              fileName: failed[0]!.fileName,
              problems: failed[0]!.problems.join(RcExport.clauseSeparator().text),
            })
          : RcExport.noFilesExported();
      throw taskFailure(code, message, { failed });
    }
    throw taskFailure(
      'EXPORT_PARTIALLY_PUBLISHED',
      RcExport.partiallyPublished({ failed: failed.length, published: outputs.length }),
      { failed },
      result,
    );
  }
}

/** 字幕与文稿冻结好的计划与预检过的文档（`#planText`）。 */
interface FrozenText {
  plan: TextPlanResult;
  primary: PlannedDocument;
  secondary: PlannedDocument | undefined;
  /** 默认文件名的种类后缀：`transcript`，字幕的语言（双语是「主-副」），没有语言时 `subtitles`。 */
  suffix: string;
  /** 文稿不跳过剪掉的部分时，带时间的文档的正文（转写的取自计划，字幕的另外读）。 */
  bodies: Map<Id, unknown>;
  /** 序列上的章节（`kind: 'chapter'` 的标记），序列时间（秒），按开始排好。 */
  chapters: TextChapter[];
  /** 文首元信息里与范围无关的字段（时长按每一段另算）。 */
  frontMatter: Omit<FrontMatter, 'duration'> & { sourceDuration: number | null };
}

/** 序列上的章节标记：帧换成秒，按开始排，没有标题的不要。 */
function chapterMarkers(video: VideoSnapshot, plan: TextPlanResult): TextChapter[] {
  const markers = video.sequences[plan.sequenceId]?.markers ?? [];
  return markers
    .filter((m) => m.kind === 'chapter' && m.label.trim())
    .map((m) => ({ title: m.label.trim(), start: (m.frame * plan.fps.den) / plan.fps.num }))
    .sort((a, b) => a.start - b.start);
}

/**
 * 文首元信息（Markdown 文稿，`frontmatter`）：标题是视频名；出处、作者、发布日期与平台取主文档所记素材的来源
 * （从链接导入时记下的 `provenance.source`，视频格式规范 §4.5）；语言是主文档与译文的语言。视频没有简介，`description` 不写。
 */
function frontMatterOf(
  video: VideoSnapshot,
  plan: TextPlanResult,
  primary: PlannedDocument,
  secondary: PlannedDocument | undefined,
): FrozenText['frontMatter'] {
  const assetId =
    primary.sourceAssetId ?? (primary.sourceDocumentId ? video.documents[primary.sourceDocumentId]?.sourceAssetId : undefined);
  const asset = assetId ? video.assets[assetId] : undefined;
  const revision = asset?.revisions[asset.currentRevision];
  const source = (revision?.provenance.source ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const uploaded = text(source.uploadDate);
  return {
    title: plan.videoName,
    description: null,
    source: text(source.webpageUrl) ?? text(source.url),
    author: text(source.uploader),
    // 下载工具的 `YYYYMMDD` 写成 `YYYY-MM-DD`，别的写法原样。
    published: uploaded && /^\d{8}$/.test(uploaded) ? `${uploaded.slice(0, 4)}-${uploaded.slice(4, 6)}-${uploaded.slice(6)}` : uploaded,
    platform: text(source.platform),
    language: primary.language ?? null,
    translation: secondary?.language ?? null,
    sourceDuration: revision?.duration ? Number(revision.duration.ticks) / revision.duration.timescale : null,
  };
}

/** 排出第 `index` 段的正文：导出任务与 `exports.renderText` 都只经过这里。 */
function renderTextPart(frozen: FrozenText, settings: TextSettings, index: number): TextExportOutput {
  const { plan, primary, secondary } = frozen;
  const part = plan.parts[index]!;
  const transcript = settings.kind === 'transcript';
  const range = part.plans[0]!.range;
  const unprojected = transcript && settings.skipCut === false;
  // 不跳过剪掉的部分：主文档（与带时间的另一份）换成不经投影的原文，章节换到原文的时钟。
  const whole = !settings.range && !settings.ranges;
  const primaryPlan = unprojected ? sourcePlan(frozen.bodies.get(primary.documentId), part.plans[0]!, whole) : part.plans[0]!;
  const secondaryPlan = part.plans[1] ?? null;
  const inRange = frozen.chapters
    .map((c) => ({ title: c.title, start: c.start - range.startSeconds }))
    .filter((c) => c.start >= 0 && c.start < range.durationSeconds);
  const chapters =
    !transcript || settings.chapters !== true ? null : unprojected ? sourceChapters(inRange, part.plans[0]!, primaryPlan) : inRange;
  const rangeDuration = unprojected
    ? Math.max(primaryPlan.range.durationSeconds, frozen.frontMatter.sourceDuration ?? 0)
    : range.durationSeconds;
  const { sourceDuration: _, ...meta } = frozen.frontMatter;
  return renderText({
    kind: settings.kind,
    format: settings.format,
    primary: { document: primary, plan: primaryPlan },
    secondary: secondary
      ? {
          document: secondary,
          plan: secondaryPlan && unprojected ? sourcePlan(frozen.bodies.get(secondary.documentId), secondaryPlan, whole) : secondaryPlan,
        }
      : null,
    style: plan.style?.body ?? null,
    canvas: plan.canvas,
    meta: {
      videoId: plan.videoId,
      videoName: plan.videoName,
      videoRevision: plan.videoRevision,
      sequenceId: plan.sequenceId,
      sequenceRevision: plan.sequenceRevision,
    },
    rangeDuration,
    ...(settings.maxCharsPerLine !== undefined ? { maxCharsPerLine: settings.maxCharsPerLine } : {}),
    ...(transcript && settings.timestamps !== undefined ? { timestamps: settings.timestamps } : {}),
    ...(transcript && settings.speakers !== undefined ? { speakers: settings.speakers } : {}),
    chapters,
    frontMatter:
      transcript && settings.frontmatter === true && settings.format === 'md'
        ? { ...meta, duration: transcriptStamp(rangeDuration) }
        : null,
  });
}

/** 默认的文件名：「视频名.后缀.扩展名」（成片没有后缀：「视频名.mp4」），几段范围各出一份时加 `.partN`。 */
function defaultFileName(videoName: string, suffix: string, extension: string, multiple: boolean, index: number): string {
  const stem = suffix ? `${safeFileStem(videoName)}.${suffix}` : safeFileStem(videoName);
  return `${stem}${multiple ? `.part${index + 1}` : ''}.${extension}`;
}

function kindUnsupported(kind: string): RpcError {
  return new RpcError('invalid-request', RcExport.exportKindUnsupported({ kind }), {
    code: 'EXPORT_KIND_UNSUPPORTED',
    kind,
    supported: SUPPORTED_EXPORT_KINDS,
  });
}

interface Staged {
  file: string;
  fileName: string;
  format: string;
  media: GeneratedOutput['media'];
  validation: NonNullable<GeneratedOutput['validation']>;
}

interface Failed {
  fileName: string;
  code: string;
  problems: string[];
}

/** 声音计划的说明码对应的文字；认不出的码返回 null（照用码本身）。 */
function audioNoteText(code: string): Localized | null {
  switch (code) {
    case 'DUCK_NO_SPEECH':
      return RcExport.noteDuckNoSpeech();
    case 'HOLD_IS_SILENT':
      return RcExport.noteHoldIsSilent();
    case 'ASSET_HAS_NO_AUDIO':
      return RcExport.noteAssetHasNoAudio();
    case 'CROSSFADE_HANDLE_SHORT':
      return RcExport.noteCrossfadeHandleShort();
    default:
      return null;
  }
}

/** 已有的错误换成任务失败：错误带引用时一并带上，没有时照用它的文字。 */
function taskFailureOf(code: string, error: unknown, details?: unknown, result?: ConstructorParameters<typeof TaskFailure>[3]): TaskFailure {
  const message = localizedOf(error);
  return typeof message === 'string' ? new TaskFailure(code, message, details, result) : taskFailure(code, message, details, result);
}

function itemKey(item: UnsupportedItem): string {
  return [item.scope, item.itemId, item.effectId ?? '', item.transitionId ?? ''].join('|');
}

/** 任务进行中工具启动不了（提交之后被删、被挪走）：按是哪个工具给补救办法，Render Worker 不见了不叫人装 ffmpeg。 */
function toolMissing(error: ToolFailure): TaskFailure {
  if (error.tool === 'export-worker') {
    return taskFailure('EXPORT_TOOL_MISSING', RcExport.workerGone({ error: localizedOf(error) }), {
      missing: 'export-worker',
      remedy: workerRemedy(),
    });
  }
  return taskFailureOf('EXPORT_TOOL_MISSING', error, { ...(error.tool ? { missing: error.tool } : {}), remedy: toolRemedy() });
}

/** 预检时 Worker 的失败换成提交时的错误（不创建任务）。 */
function workerRpcError(error: unknown): unknown {
  if (error instanceof WorkerFailure) {
    const kind = error.code === 'EXPORT_TOOL_MISSING' || error.code.startsWith('ASSET_') ? 'conflict' : 'invalid-request';
    return new RpcError(
      kind,
      error.message,
      {
        ...error.details,
        code: error.code,
        ...(error.code === 'EXPORT_TOOL_MISSING' ? { remedy: toolRemedy() } : {}),
      },
      error.messageRef,
    );
  }
  if (error instanceof ToolFailure) {
    const details = { code: 'EXPORT_TOOL_MISSING', missing: 'export-worker', remedy: workerRemedy() };
    return new RpcError('conflict', error.message, details, error.messageRef);
  }
  return error;
}

/** 冻结时的素材版本（导出快照里记的位置；读不到的路径为空）。 */
function frozenAssets(freeze: PackageFreeze): ExportSnapshot['assets'] {
  return freeze.assets.map((a) => ({
    assetId: a.assetId,
    revision: a.revision,
    name: a.name,
    storage: a.storage,
    path: a.path ?? '',
    contentHash: a.contentHash,
    byteLength: a.byteLength,
  }));
}

/** 文档正文里的 `schema`（读不出时为空串）。 */
function documentSchema(text: string): string {
  try {
    const schema = (JSON.parse(text) as { schema?: unknown }).schema;
    return typeof schema === 'string' ? schema : '';
  } catch {
    return '';
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error(RcCommon.cancelled().text);
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest('hex')}`;
}

function assetChanged(asset: PlannedAsset): RpcError {
  return new RpcError('conflict', RcExport.linkedAssetContentChanged({ name: asset.name }), {
    code: 'ASSET_CHANGED',
    assetId: asset.assetId,
    revision: asset.revision,
    path: asset.path,
  });
}

/** 预检：链接素材的内容摘要与登记的一致（引擎只核对了存在与长度）。 */
async function verifyLinked(asset: PlannedAsset): Promise<LinkedCheck> {
  const stat = await fs.stat(asset.path).catch(() => null);
  if (!stat?.isFile()) {
    throw new RpcError('conflict', RcExport.linkedAssetMissing({ name: asset.name }), {
      code: 'ASSET_MISSING',
      assetId: asset.assetId,
      path: asset.path,
    });
  }
  if ((await sha256File(asset.path)) !== asset.contentHash) throw assetChanged(asset);
  return { asset, size: stat.size, mtimeMs: stat.mtimeMs };
}

/** 执行前：文件的长度与修改时间没变就不重算摘要。 */
async function recheckLinked(check: LinkedCheck): Promise<void> {
  const stat = await fs.stat(check.asset.path).catch(() => null);
  const { name } = check.asset;
  const fail = (code: string, message: Localized) => taskFailure(code, message, { assetId: check.asset.assetId, path: check.asset.path });
  if (!stat?.isFile()) throw fail('ASSET_MISSING', RcExport.linkedAssetGoneBeforeExport({ name }));
  if (stat.size === check.size && stat.mtimeMs === check.mtimeMs) return;
  if (stat.size !== check.asset.byteLength || (await sha256File(check.asset.path)) !== check.asset.contentHash) {
    throw fail('ASSET_CHANGED', RcExport.linkedAssetChangedBeforeExport({ name }));
  }
}

/** 默认的主文档（见 `TextExportOptions.documentId`）。 */
function chooseDocument(video: VideoSnapshot, sequenceId: Id, settings: TextSettings): Id {
  const docs = Object.values(video.documents);
  const languageOk = (language: string | undefined) =>
    settings.language === undefined ||
    (language !== undefined && (language === settings.language || language.startsWith(`${settings.language}-`)));
  const sequence = video.sequences[sequenceId];
  if (!sequence) throw new RpcError('not-found', RcExport.sequenceMissing(), { code: 'ENTITY_NOT_FOUND', sequenceId });
  const shown = [
    ...new Set(
      sequence.items
        .filter((item): item is CaptionItem => item.type === 'caption' && item.enabled)
        .map((item) => item.documentId)
        .filter((id) => video.documents[id] && languageOk(video.documents[id]!.language)),
    ),
  ];
  const speech = docs.filter((d) => d.kind === 'speech' && languageOk(d.language)).map((d) => d.id);
  const order = settings.kind === 'transcript' ? [speech, shown] : [shown, speech];
  for (const candidates of order) {
    if (candidates.length === 1) return candidates[0]!;
    // 候选把另一组也列上（字幕导出时的转写、文稿导出时显示着的字幕）：它们同样可以用 documentId 指定。
    if (candidates.length > 1) throw ambiguous(video, [...new Set([...order[0]!, ...order[1]!])]);
  }
  const message = settings.language ? RcExport.noSourceForLanguage({ language: settings.language }) : RcExport.noSource();
  throw new RpcError('not-found', message, {
    code: 'EXPORT_SOURCE_NOT_FOUND',
  });
}

/** 双语合并的另一份文档。 */
function chooseSecondary(video: VideoSnapshot, primaryId: Id, bilingual: NonNullable<TextSettings['bilingual']>): Id {
  const explicit = typeof bilingual === 'object' ? bilingual : {};
  if (explicit.documentId !== undefined) {
    if (!video.documents[explicit.documentId]) throw new RpcError('not-found', RcExport.bilingualDocumentNotFound(), { code: 'EXPORT_SOURCE_NOT_FOUND' });
    if (explicit.documentId === primaryId) throw new RpcError('invalid-request', RcExport.bilingualNeedsOtherDocument());
    return explicit.documentId;
  }
  const primary = video.documents[primaryId];
  const languageOk = (language: string | undefined) =>
    explicit.language === undefined ||
    (language !== undefined && (language === explicit.language || language.startsWith(`${explicit.language}-`)));
  const translations = Object.values(video.documents).filter(
    (d) => d.kind === 'translation' && d.sourceDocumentId === primaryId && languageOk(d.language),
  );
  if (translations.length === 1) return translations[0]!.id;
  if (translations.length > 1)
    throw ambiguous(
      video,
      translations.map((d) => d.id),
    );
  // 没有译文时：同一素材的另一种语言的字幕或转写。
  const others = Object.values(video.documents).filter(
    (d) =>
      d.id !== primaryId &&
      (d.kind === 'caption' || d.kind === 'speech') &&
      d.language !== undefined &&
      d.language !== primary?.language &&
      (explicit.language === undefined ? true : languageOk(d.language)) &&
      (primary?.sourceAssetId === undefined || d.sourceAssetId === primary.sourceAssetId),
  );
  if (others.length === 1) return others[0]!.id;
  if (others.length > 1)
    throw ambiguous(
      video,
      others.map((d) => d.id),
    );
  throw new RpcError('not-found', RcExport.noBilingualCounterpart(), { code: 'EXPORT_SOURCE_NOT_FOUND' });
}

function ambiguous(video: VideoSnapshot, ids: Id[]): RpcError {
  return new RpcError('invalid-request', RcExport.sourceAmbiguous(), {
    code: 'EXPORT_SOURCE_AMBIGUOUS',
    candidates: ids.map((id) => {
      const d = video.documents[id]!;
      return { documentId: id, kind: d.kind, name: d.name, language: d.language ?? null };
    }),
  });
}
