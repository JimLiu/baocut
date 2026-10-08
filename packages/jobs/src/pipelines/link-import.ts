import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  nowIso,
  type EditOperation,
  type GeneratedOutput,
  type Id,
  type JobRecord,
  type LinkImportParams,
  type LinkImportSummary,
  type PipelineCreateTarget,
} from '@baocut/protocol';
import { JobsLinkImport } from '@baocut/protocol/messages/jobs/link-import.ts';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';
import { captionsStep, captionsSummary, type CaptionLayerOutput, type CaptionVideos } from './caption-layer.ts';
import { downloadTranscript } from './download-transcript.ts';
import { probeMedia, type MediaToolResolver } from './ffmpeg.ts';
import { checkLink, checkResolvedHost, redactUrl, systemLookup, type HostLookup } from './link-url.ts';
import type { LinkSources } from './link-sources.ts';
import { ParamReader, invalid } from './params.ts';
import { PipelineStepError, type PipelineDefinition, type PipelineStepContext } from './pipeline.ts';
import { publishFile } from './transcode.ts';
import { createHeldVideo, importMedia, transcribeInVideo, type MediaVideos, type PipelineTranscriber } from './video-create.ts';
import { createScopeOf, readCreateTarget, targetSchema, targetStep, type PipelineTargets } from './video-target.ts';
import {
  COOKIE_BROWSERS,
  linkFailureRemedy,
  type CookieBrowser,
  ProgressTracker,
  classifyFailure,
  cookieAttemptsFailure,
  downloadArgs,
  parseMetadata,
  parseProgressLine,
  resolveArgs,
  runYtDlp,
  sanitizeFileName,
  worthAnotherCookieBrowser,
  type LinkMetadata,
} from './yt-dlp.ts';

/**
 * 从链接导入（架构设计 §7.9）：解析目标 → 解析链接 → 下载 → 校验 → 发布 →（新建视频时）新建视频 →（给了目标时）导入视频
 * →（可选）转写。
 *
 * - 参数在提交时校验并冻结：链接规范化、脱敏（`link-url.ts`），原始链接只在 `LinkSources` 里；下载目录在提交时确定。
 * - 下载工具由 `tool()` 给出：每一步之前重新确认它已安装、同意有效（撤回之后，重试也被拒绝）。严格离线时拒绝。
 * - 浏览器 Cookie（`cookieBrowsers`）：解析链接时按顺序逐个用，读不到 Cookie 或网站仍要求登录时换下一个，别的失败不换；
 *   用上的那个记在解析的结果里，下载沿用它，下载失败不再换浏览器。
 * - 下载写进 staging 的固定位置（`<staging>/dl/media.<ext>`）；发布时文件名取自标题（清理过），按真实路径确认落在下载目录里，
 *   不覆盖已有的文件。取消时杀掉进程（整个进程组），staging 随之删除；失败与中断时保留，重试时 yt-dlp 接着 `.part` 续传。
 * - 导入视频是链接素材（文件留在下载目录里），来源（`origin: 'link-import'`）记脱敏的链接、平台的元数据、工具与版本、下载时间。
 * - 目标（`target`）：`{ videoId }`、`{ entryId }`（`PipelineRunner` 在提交时解析）或 `{ create }`。新建视频在发布之后，
 *   名字默认取页面标题，在项目目录或会话的来源目录里新建（与 `videos.create` 同一条路径），流程持有它的租约；导入时同一笔事务把素材放上主轨，
 *   从 0 开始、覆盖整段媒体。新建完成之后重试不再新建。导入已有的视频时，时间线还空着（根序列上没有片段）同样放上主轨，已经有片段
 *   时只导入素材。
 * - 转写（`transcribe`）：语言、Provider 与模型、提示、说话人与转录流程（`transcribe.ts`）的同名参数相同，Provider 与模型在提交时
 *   选定并冻结；转进视频时套用视频里启用的转写术语表（对外服务启动的不套），`captions` 打开时再建字幕层（与转录流程同一步）。
 */

export const LINK_IMPORT_PIPELINE = 'link-import';

/** 媒体与字幕文件能接受的扩展名；别的文件（工具的临时文件）不发布。 */
const MEDIA_EXTENSIONS = new Set(['mp4', 'm4v', 'mkv', 'webm', 'mov', 'm4a', 'mp3', 'opus', 'ogg', 'oga', 'wav', 'flac', 'aac']);
const SUBTITLE_EXTENSIONS = new Set(['vtt', 'srt', 'ass', 'ssa', 'ttml']);
const MEDIA_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
};
const LANGUAGE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{1,8}){0,3}$/;
/** 识别提示的上限，与转录流程的 `hint` 相同。 */
const HINT_MAX = 1200;
const PROGRESS_INTERVAL_MS = 250;

/** 流程用的下载工具：已安装、同意有效；否则抛 `RpcError('conflict')`（`details.code` 是 `TOOL_*`）。 */
export interface LinkImportTool {
  command: string;
  version: string;
  source: string;
  env?: NodeJS.ProcessEnv;
}

export interface LinkImportDeps {
  tool(): Promise<LinkImportTool>;
  /**
   * 下载目录（绝对路径）：默认按设置；`saveTo: 'project'` 时是归属项目里的目录（见 `LinkImportParams.saveTo`）。
   * 不存在的项目或会话 `not-found`。
   */
  destination(target: { projectId?: Id; conversationId?: Id; videoId?: Id; saveTo?: 'project' }): Promise<string>;
  sources: LinkSources;
  /** 导入用；`rootSequence` 看导入的已有视频时间线空不空（空的放上主轨）；建字幕层也用它。 */
  videos: MediaVideos & CaptionVideos;
  /** 新建视频（`target.create`）。没有时 `create` 被拒绝。 */
  targets?: Pick<PipelineTargets, 'reserve' | 'create'>;
  ffprobe: MediaToolResolver;
  /** 给 yt-dlp 合并音视频用的 ffmpeg（只在明确指定时传）；null 时 yt-dlp 自己在 PATH 里找。 */
  ffmpegLocation?: () => Promise<string | null>;
  offlineStrict(): boolean;
  /** 转写：提交前检查配置（`CAPABILITY_NOT_CONFIGURED`）、提交与等待。没有时 `transcribe: true` 被拒绝。 */
  transcribe?: PipelineTranscriber;
  /** 视频里启用、此刻还在库里的转写术语表（与转录流程相同）；不给时不套术语表。 */
  enabledGlossaries?: (videoId: Id) => Promise<Id[]>;
  lookup?: HostLookup;
  /** 发布时先试硬链接（见 `publishFile`）。 */
  hardLink?: boolean;
}

/** 冻结的参数：链接已脱敏，下载目录已确定。 */
export interface FrozenLinkImportParams {
  url: string;
  /** 原始链接在 `LinkSources` 里的引用；规范化没有改变链接时 null。 */
  sourceRef: string | null;
  host: string;
  projectId?: Id;
  conversationId?: Id;
  videoId?: Id;
  /** 新建视频（`target.create`）：在这个项目或会话的来源目录里，名字不给时取页面标题。 */
  create?: PipelineCreateTarget;
  /** 按顺序尝试的浏览器 Cookie；不用 Cookie 时没有。 */
  cookieBrowsers?: CookieBrowser[];
  /** 之前的版本冻结的是一个浏览器（等同只有它的 `cookieBrowsers`）。 */
  cookieBrowser?: CookieBrowser;
  transcription?: { providerId: string; modelId: string };
  audioOnly: boolean;
  subtitleLanguages: string[];
  transcribe: boolean;
  /** 转写的断言语言、提示与说话人（见 `LinkImportParams`）；之前的版本没有。 */
  language?: string;
  hint?: string;
  diarize?: boolean;
  /** 转写之后建字幕层；之前的版本没有（不建）。 */
  captions?: boolean;
  /** 转进视频时套用视频里启用的转写术语表：启动它的不是对外服务的客户端。之前的版本没有（不套）。 */
  videoGlossaries?: boolean;
  outDir: string;
}

/** 校验过、还没冻结的参数（原始链接还在）。 */
interface CheckedLinkImportParams extends Omit<LinkImportParams, 'target' | 'cookieBrowser'> {
  create?: PipelineCreateTarget;
  raw: string;
  canonical: string;
  host: string;
}

const PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
    url: { type: 'string', description: '视频页面的链接（http/https）' },
    projectId: { type: 'string', description: '归属的项目；不影响下载目录' },
    conversationId: { type: 'string', description: '归属的会话；不影响下载目录' },
    videoId: { type: 'string', description: '下载之后导入这个已打开的视频（等同 target: { videoId }）' },
    target: targetSchema('导入的目标：已打开的视频、Space 里的视频条目，或新建视频（放上时间线）；不给时只下载', {
      projectId: '新建在这个项目里',
      conversationId: '新建在这个会话的来源目录里（会话属于项目时是那个项目）；与 projectId 给一个',
      name: '视频的名字，默认取页面标题',
    }),
    audioOnly: { type: 'boolean', default: false },
    subtitleLanguages: { type: 'array', items: { type: 'string' }, maxItems: 10, description: '一并下载的字幕语言' },
    cookieBrowsers: {
      type: 'array',
      items: { type: 'string', enum: COOKIE_BROWSERS },
      uniqueItems: true,
      maxItems: COOKIE_BROWSERS.length,
      description: '本次下载按顺序尝试这些浏览器的登录信息：读不到 Cookie 或网站仍要求登录时换下一个；不填时匿名',
    },
    cookieBrowser: { type: 'string', enum: COOKIE_BROWSERS, description: '旧写法：只用这一个浏览器，等同 cookieBrowsers: [它]' },
    transcribe: { type: 'boolean', default: false, description: '下载后转录；无视频目标时保存 TXT 和 SRT' },
    language: { type: 'string', description: '转写的断言语言（BCP 47）；不给时自动检测。只与 transcribe 一起给' },
    provider: { type: 'string', description: '转写的 Provider；不给时用默认值。只与 transcribe 一起给' },
    model: { type: 'string', description: '转写的模型；不给时用 Provider 的默认模型。只与 transcribe 一起给' },
    hint: { type: 'string', maxLength: HINT_MAX, description: '识别提示（同 models.transcribe 的 hint）。只与 transcribe 一起给' },
    diarize: { type: 'boolean', description: '区分说话人；不给时按模型。只与 transcribe 和视频目标一起给' },
    captions: { type: 'boolean', default: false, description: '转写之后建立字幕层。只与 transcribe 和视频目标一起给' },
    saveTo: {
      type: 'string',
      enum: ['downloads', 'project'],
      default: 'downloads',
      description:
        '文件放在哪里：downloads 是下载目录；project 是归属项目（项目、导入的视频或新建视频所在的）里的 downloads/，没有项目时仍是下载目录',
    },
    // i18n-ignore-end
  },
  required: ['url'],
  additionalProperties: false,
};

interface ResolveOutput extends Record<string, unknown> {
  metadata: LinkMetadata;
  tool: { version: string; source: string };
  /** 解析成功时用的浏览器 Cookie，匿名时 null；之前的版本没有（按冻结参数的第一个）。 */
  cookieBrowser?: CookieBrowser | null;
}

interface DownloadOutput extends Record<string, unknown> {
  media: string;
  subtitles: Array<{ file: string; language: string; ext: string }>;
  tool: { version: string; source: string };
  downloadedAt: string;
}

interface VerifyOutput extends Record<string, unknown> {
  media: GeneratedOutput['media'];
}

interface PublishOutput extends Record<string, unknown> {
  media: string;
  subtitles: string[];
  output: GeneratedOutput;
}

interface CreateOutput extends Record<string, unknown> {
  videoId: Id;
  place: Record<string, unknown>;
}

interface ImportOutput extends Record<string, unknown> {
  assetId: Id;
}

interface TranscribeOutput extends Record<string, unknown> {
  jobId: Id;
  /** 转进视频时写入的文稿；之前的版本没有。 */
  documentId?: Id | null;
  files?: string[];
  outputs?: GeneratedOutput[];
}

export function linkImportPipeline(deps: LinkImportDeps): PipelineDefinition<FrozenLinkImportParams, CheckedLinkImportParams> {
  const lookup = deps.lookup ?? systemLookup;

  const requireOnline = () => {
    if (deps.offlineStrict()) throw new RpcError('conflict', JobsLinkImport.offlineStrict(), { code: 'OFFLINE_STRICT' });
  };

  return {
    name: LINK_IMPORT_PIPELINE,
    label: () => JobsLinkImport.label(),
    description: () => JobsLinkImport.description(),
    paramsSchema: PARAMS_SCHEMA,
    target: { create: { media: false } },
    parse: parseLinkImportParams,
    async prepare(params, { retry, submitter }) {
      requireOnline();
      const tool = await deps.tool();
      if (params.create && !deps.targets) {
        throw new RpcError('invalid-request', JobsLinkImport.cannotCreateVideo(), { code: 'PIPELINE_TARGET_UNSUPPORTED' });
      }
      let transcription;
      if (params.transcribe) {
        if (!deps.transcribe) throw new RpcError('conflict', JobsLinkImport.cannotTranscribe(), { code: 'CAPABILITY_NOT_CONFIGURED' });
        if (!params.videoId && !params.create && !deps.transcribe.submitFile) throw new RpcError('conflict', JobsLinkImport.fileTranscribeUnavailable(), { code: 'CAPABILITY_NOT_CONFIGURED' });
        // 重试时用冻结的选择；第一次提交时用给定的 Provider 与模型（不给时默认值）。
        const frozenSelection = retry ? (params as FrozenLinkImportParams).transcription : undefined;
        const given: { provider?: string; model?: string } = retry ? {} : (params as CheckedLinkImportParams);
        transcription = await deps.transcribe.check(
          frozenSelection
            ? { provider: frozenSelection.providerId, model: frozenSelection.modelId }
            : given.provider !== undefined || given.model !== undefined
              ? {
                  ...(given.provider !== undefined ? { provider: given.provider } : {}),
                  ...(given.model !== undefined ? { model: given.model } : {}),
                }
              : undefined,
        );
      }
      if (params.videoId !== undefined && !deps.videos.state(params.videoId)) throw new RpcError('not-found', JobsLinkImport.videoNotOpen());
      await checkResolvedHost(params.host, lookup);
      let frozen: FrozenLinkImportParams;
      if (retry) {
        frozen = params as FrozenLinkImportParams;
        if (frozen.sourceRef && !(await deps.sources.get(frozen.sourceRef))) {
          throw new RpcError('conflict', JobsLinkImport.sourceExpired(), { code: 'LINK_SOURCE_EXPIRED' });
        }
      } else {
        const checked = params as CheckedLinkImportParams;
        const projectId = checked.create ? checked.create.projectId : checked.projectId;
        const conversationId = checked.create ? checked.create.conversationId : checked.conversationId;
        const outDir = await deps.destination({
          ...(projectId !== undefined ? { projectId } : {}),
          ...(conversationId !== undefined ? { conversationId } : {}),
          ...(checked.videoId !== undefined ? { videoId: checked.videoId } : {}),
          ...(checked.saveTo === 'project' ? { saveTo: 'project' as const } : {}),
        });
        const sourceRef = checked.raw === checked.canonical ? null : `sha256:${sha256Hex(checked.raw)}`;
        frozen = {
          url: checked.canonical,
          sourceRef,
          host: checked.host,
          ...(checked.projectId !== undefined ? { projectId: checked.projectId } : {}),
          ...(checked.conversationId !== undefined ? { conversationId: checked.conversationId } : {}),
          ...(checked.videoId !== undefined ? { videoId: checked.videoId } : {}),
          ...(checked.create ? { create: checked.create } : {}),
          ...(checked.cookieBrowsers?.length ? { cookieBrowsers: checked.cookieBrowsers } : {}),
          ...(transcription ? { transcription } : {}),
          audioOnly: checked.audioOnly ?? false,
          subtitleLanguages: checked.subtitleLanguages ?? [],
          transcribe: checked.transcribe ?? false,
          ...(checked.language !== undefined ? { language: checked.language } : {}),
          ...(checked.hint !== undefined ? { hint: checked.hint } : {}),
          ...(checked.diarize !== undefined ? { diarize: checked.diarize } : {}),
          ...(checked.captions ? { captions: true } : {}),
          ...(checked.transcribe && submitter?.kind !== 'service' ? { videoGlossaries: true } : {}),
          outDir,
        };
        // 最后一步才写：前面的检查不过时不留下原始链接。
        if (sourceRef) await deps.sources.put(sourceRef, checked.raw);
      }
      return {
        params: frozen,
        providerId: 'yt-dlp',
        modelId: tool.version,
        videoId: frozen.videoId ?? null,
        contentHash: `sha256:${sha256Hex(canonicalJson({ url: frozen.url, sourceRef: frozen.sourceRef }))}`,
      };
    },
    steps: [
      targetStep(),
      {
        name: 'resolve',
        label: () => JobsLinkImport.stepResolve(),
        run: async ({ params, signal, progress }) => {
          requireOnline();
          progress(null, 'probing');
          const tool = await deps.tool();
          const url = await rawUrl(deps, params);
          const browsers = cookieBrowsersOf(params);
          const attempts: Array<{ browser: CookieBrowser; error: PipelineStepError }> = [];
          for (const browser of browsers.length > 0 ? browsers : [null]) {
            const run = await runYtDlp(tool, resolveArgs(url, browser ?? undefined), { signal, keepStdout: true });
            if (run.code === 0) {
              const metadata = parseMetadata(run.stdout);
              if (metadata.webpageUrl) metadata.webpageUrl = redactUrl(metadata.webpageUrl);
              return { output: { metadata, tool: { version: tool.version, source: tool.source }, cookieBrowser: browser } satisfies ResolveOutput };
            }
            const error = classifyFailure(run.stderr, run.code);
            if (browser === null || !worthAnotherCookieBrowser(error)) throw error;
            attempts.push({ browser, error });
          }
          throw cookieAttemptsFailure(attempts);
        },
      },
      {
        name: 'download',
        label: () => JobsLinkImport.stepDownload(),
        run: (context) => download(deps, context, requireOnline),
        reusable: async (output, { staging }) => {
          const out = output as DownloadOutput;
          for (const file of [out.media, ...out.subtitles.map((s) => s.file)]) {
            if (!isInside(file, staging) || !(await fs.stat(file).catch(() => null))) return false;
          }
          return true;
        },
      },
      {
        name: 'verify',
        label: () => JobsLinkImport.stepVerify(),
        // 用 ffprobe 读一遍（与引擎导入素材用的同一个）：找不到 ffprobe 时以 `MEDIA_TOOL_UNAVAILABLE` 失败，不跳过校验。
        run: async ({ outputs, signal, progress }) => {
          const downloaded = outputs.download as DownloadOutput;
          progress(null, 'validating');
          let probed;
          try {
            probed = await probeMedia(deps.ffprobe, downloaded.media, signal);
          } catch (error) {
            if (error instanceof PipelineStepError && error.code === 'INPUT_UNREADABLE') {
              throw new PipelineStepError('LINK_DOWNLOAD_UNREADABLE', JobsLinkImport.undecodable(), {
                remedy: JobsLinkImport.undecodableRemedy().text,
              });
            }
            throw error;
          }
          if (!probed.video && !probed.audio) {
            throw new PipelineStepError('LINK_DOWNLOAD_UNREADABLE', JobsLinkImport.noStreams(), {
              remedy: JobsLinkImport.undecodableRemedy().text,
            });
          }
          const media: GeneratedOutput['media'] = probed.video
            ? {
                kind: 'video',
                durationSec: probed.durationSec,
                width: probed.video.width,
                height: probed.video.height,
                videoCodec: probed.video.codec,
                audioCodec: probed.audio?.codec ?? null,
              }
            : { kind: 'audio', durationSec: probed.durationSec, sampleRate: probed.audio!.sampleRate, channels: probed.audio!.channels };
          return { output: { media } satisfies VerifyOutput };
        },
      },
      {
        name: 'publish',
        label: () => JobsLinkImport.stepPublish(),
        run: (context) => publish(deps, context),
        reusable: async (output) => {
          const out = output as PublishOutput;
          for (const file of [out.media, ...out.subtitles]) if (!(await fs.stat(file).catch(() => null))) return false;
          return true;
        },
      },
      {
        name: 'create',
        label: () => JobsLinkImport.stepCreate(),
        holdsVideo: true,
        when: (params) => params.create !== undefined,
        run: (context) => createVideo(deps, context),
      },
      {
        name: 'import',
        label: () => JobsLinkImport.stepImport(),
        when: (params) => params.videoId !== undefined || params.create !== undefined,
        run: (context) => importIntoVideo(deps, context),
      },
      {
        name: 'transcribe',
        label: () => JobsLinkImport.stepTranscribe(),
        when: (params) => params.transcribe,
        run: (context) => transcribe(deps, context),
      },
      captionsStep<FrozenLinkImportParams>(deps.videos, {
        pipeline: LINK_IMPORT_PIPELINE,
        enabled: (params) => params.captions === true,
        videoId: (params, outputs) => (outputs.import ? targetVideo(params, outputs) : null),
        source: (_params, outputs) => {
          const documentId = (outputs.transcribe as TranscribeOutput | undefined)?.documentId;
          return documentId ? { kind: 'speech', documentId } : null;
        },
      }),
    ],
    async complete({ params, outputs }) {
      const resolved = outputs.resolve as ResolveOutput;
      const downloaded = outputs.download as DownloadOutput;
      const published = outputs.publish as PublishOutput;
      const imported = (outputs.import as ImportOutput | null) ?? null;
      const created = (outputs.create as CreateOutput | null) ?? null;
      const transcribed = (outputs.transcribe as TranscribeOutput | null) ?? null;
      const summaryVideo = params.videoId ?? created?.videoId ?? null;
      if (params.sourceRef) await deps.sources.delete(params.sourceRef);
      const summary: LinkImportSummary = {
        url: params.url,
        title: resolved.metadata.title,
        platform: resolved.metadata.platform,
        uploader: resolved.metadata.uploader,
        durationSec: resolved.metadata.durationSec,
        description: summaryDescription(resolved.metadata.description),
        sourceChapters: resolved.metadata.chapters?.length ?? 0,
        files: { media: published.media, subtitles: published.subtitles },
        tool: { name: 'yt-dlp', version: downloaded.tool.version, source: downloaded.tool.source },
        cookieBrowser: usedCookieBrowser(params, resolved),
        downloadedAt: downloaded.downloadedAt,
        videoId: params.videoId ?? created?.videoId ?? null,
        assetId: imported?.assetId ?? null,
        createdVideo: created !== null,
        transcribeJobId: transcribed?.jobId ?? null,
        ...(transcribed?.files ? { transcriptFiles: transcribed.files } : {}),
        ...(transcribed && !transcribed.files ? { documentId: transcribed.documentId ?? null } : {}),
        ...(params.captions && transcribed?.documentId && summaryVideo
          ? {
              captions: captionsSummary(
                deps.videos,
                true,
                (outputs.captions as CaptionLayerOutput | undefined) ?? null,
                summaryVideo,
                transcribed.documentId,
              ),
            }
          : {}),
      };
      const output = { ...published.output, assetId: imported?.assetId ?? null };
      return { summary: { ...summary }, result: { documentId: null, artifactId: output.artifactId, outputs: [output, ...(transcribed?.outputs ?? [])] } };
    },
  };
}

export function parseLinkImportParams(raw: Record<string, unknown>): CheckedLinkImportParams {
  const reader = new ParamReader(raw, [
    'url',
    'projectId',
    'conversationId',
    'videoId',
    'target',
    'audioOnly',
    'subtitleLanguages',
    'transcribe',
    'cookieBrowsers',
    'cookieBrowser',
    'saveTo',
    'language',
    'provider',
    'model',
    'hint',
    'diarize',
    'captions',
  ]);
  const url = reader.string('url', { max: 4096 });
  const checked = checkLink(url);
  const projectId = reader.string('projectId', { max: 200, optional: true });
  const conversationId = reader.string('conversationId', { max: 200, optional: true });
  const videoId = reader.string('videoId', { max: 200, optional: true });
  const audioOnly = bool(raw, 'audioOnly');
  const transcribe = bool(raw, 'transcribe');
  const cookieBrowser = reader.string('cookieBrowser', { optional: true }) as CookieBrowser | undefined;
  if (cookieBrowser !== undefined && !COOKIE_BROWSERS.includes(cookieBrowser)) throw invalid('cookieBrowser', JobsLinkImport.unsupportedBrowser());
  const browserList = reader.array('cookieBrowsers', { max: COOKIE_BROWSERS.length, optional: true });
  if (browserList !== undefined && cookieBrowser !== undefined) throw invalid('cookieBrowsers', JobsParams.onlyOneOf({ other: 'cookieBrowser' }));
  const cookieBrowsers = browserList?.map((browser) => {
    if (typeof browser !== 'string' || !COOKIE_BROWSERS.includes(browser as CookieBrowser)) throw invalid('cookieBrowsers', JobsLinkImport.browserItems());
    return browser as CookieBrowser;
  }) ?? (cookieBrowser !== undefined ? [cookieBrowser] : undefined);
  if (cookieBrowsers && new Set(cookieBrowsers).size !== cookieBrowsers.length) throw invalid('cookieBrowsers', JobsLinkImport.noDuplicates());
  const saveTo = reader.string('saveTo', { optional: true });
  if (saveTo !== undefined && saveTo !== 'downloads' && saveTo !== 'project') throw invalid('saveTo', JobsLinkImport.saveToInvalid());
  const languages = reader.array('subtitleLanguages', { max: 10, optional: true });
  const subtitleLanguages = languages?.map((lang) => {
    if (typeof lang !== 'string' || !LANGUAGE.test(lang)) throw invalid('subtitleLanguages', JobsLinkImport.languageItems());
    return lang;
  });
  // `{ videoId }` 与 `{ entryId }` 的目标由 PipelineRunner 换成了顶层的 `videoId`；这里只剩新建。
  const create = raw.target === undefined ? undefined : createOf(raw.target);
  // 转写的参数：只与 transcribe 一起给；说话人与字幕层要有视频。
  const language = reader.string('language', { max: 35, optional: true });
  if (language !== undefined && !LANGUAGE.test(language)) throw invalid('language', JobsLinkImport.languageTag());
  const provider = reader.string('provider', { max: 200, optional: true });
  const model = reader.string('model', { max: 200, optional: true });
  const hint = reader.string('hint', { max: HINT_MAX, optional: true })?.trim();
  const diarize = bool(raw, 'diarize');
  const captions = bool(raw, 'captions');
  const recognition = { language, provider, model, hint, diarize, captions };
  if (!transcribe) {
    const given = Object.entries(recognition).find(([, value]) => value !== undefined);
    if (given) throw invalid(given[0], JobsLinkImport.requiresTranscribe());
  }
  if (videoId === undefined && !create) {
    if (diarize !== undefined) throw invalid('diarize', JobsLinkImport.noVideoDiarize());
    if (captions !== undefined) throw invalid('captions', JobsLinkImport.noVideoCaptions());
  }
  if (create && videoId !== undefined) throw invalid('target', JobsParams.createExcludesVideoId());
  // 新建视频时顶层的项目或会话可以不给；给了要与新视频所在的一致。
  if (create && projectId !== undefined && projectId !== create.projectId) throw invalid('projectId', JobsLinkImport.projectMismatch());
  if (create && conversationId !== undefined && conversationId !== create.conversationId) {
    throw invalid('conversationId', JobsLinkImport.conversationMismatch());
  }
  if (projectId !== undefined && conversationId !== undefined) throw invalid('conversationId', JobsParams.onlyOneOf({ other: 'projectId' }));
  return {
    url: checked.canonical,
    raw: checked.raw,
    canonical: checked.canonical,
    host: checked.host,
    ...(projectId !== undefined ? { projectId } : {}),
    ...(conversationId !== undefined ? { conversationId } : {}),
    ...(videoId !== undefined ? { videoId } : {}),
    ...(create ? { create } : {}),
    ...(audioOnly !== undefined ? { audioOnly } : {}),
    ...(subtitleLanguages !== undefined ? { subtitleLanguages } : {}),
    ...(transcribe !== undefined ? { transcribe } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(hint ? { hint } : {}),
    ...(diarize !== undefined ? { diarize } : {}),
    ...(captions !== undefined ? { captions } : {}),
    ...(cookieBrowsers?.length ? { cookieBrowsers } : {}),
    ...(saveTo !== undefined ? { saveTo: saveTo as 'downloads' | 'project' } : {}),
  };
}

/** 冻结的参数里按顺序要试的浏览器：之前的版本只有一个 `cookieBrowser`。不用 Cookie 时空。 */
function cookieBrowsersOf(params: FrozenLinkImportParams): CookieBrowser[] {
  return params.cookieBrowsers ?? (params.cookieBrowser ? [params.cookieBrowser] : []);
}

/** 用上的浏览器：解析的结果里记着；之前的版本没记，按冻结参数的第一个。 */
function usedCookieBrowser(params: FrozenLinkImportParams, resolved: ResolveOutput): CookieBrowser | null {
  return resolved.cookieBrowser !== undefined ? resolved.cookieBrowser : (cookieBrowsersOf(params)[0] ?? null);
}

function createOf(target: unknown): PipelineCreateTarget {
  if (typeof target !== 'object' || target === null || Array.isArray(target) || Object.keys(target).join() !== 'create') {
    throw invalid('target', JobsParams.targetShape());
  }
  return readCreateTarget((target as { create: unknown }).create, false);
}

function bool(raw: Record<string, unknown>, key: string): boolean | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw invalid(key, JobsParams.mustBeBoolean());
  return value;
}

async function rawUrl(deps: LinkImportDeps, params: FrozenLinkImportParams): Promise<string> {
  if (!params.sourceRef) return params.url;
  const raw = await deps.sources.get(params.sourceRef);
  if (!raw) throw new PipelineStepError('LINK_SOURCE_EXPIRED', JobsLinkImport.sourceExpired(), {});
  return raw;
}

async function download(
  deps: LinkImportDeps,
  { params, outputs, signal, progress, staging }: PipelineStepContext<FrozenLinkImportParams>,
  requireOnline: () => void,
): Promise<{ output: DownloadOutput }> {
  requireOnline();
  const tool = await deps.tool();
  const url = await rawUrl(deps, params);
  const dir = path.join(staging, 'dl');
  await fs.mkdir(dir, { recursive: true });
  const ffmpegLocation = (await deps.ffmpegLocation?.()) ?? null;
  const cookieBrowser = usedCookieBrowser(params, outputs.resolve as ResolveOutput);
  const args = downloadArgs(url, {
    output: path.join(dir, 'media.%(ext)s'),
    audioOnly: params.audioOnly,
    subtitleLanguages: params.subtitleLanguages,
    ffmpegLocation,
    ...(cookieBrowser ? { cookieBrowser } : {}),
  });
  const tracker = new ProgressTracker();
  let last = 0;
  progress(null, 'downloading');
  const run = await runYtDlp(tool, args, {
    signal,
    onLine: (line) => {
      const sample = parseProgressLine(line);
      if (!sample) return;
      const now = Date.now();
      const value = tracker.update(sample);
      if (now - last < PROGRESS_INTERVAL_MS) return;
      last = now;
      progress({ done: value.done, total: value.total, unit: 'bytes' }, 'downloading');
    },
  });
  if (run.code !== 0) throw classifyFailure(run.stderr, run.code);
  const files = await collectDownloads(dir);
  if (!files.media) {
    throw new PipelineStepError('LINK_DOWNLOAD_FAILED', JobsLinkImport.noMediaFile(), { remedy: linkFailureRemedy('LINK_DOWNLOAD_FAILED') });
  }
  const output: DownloadOutput = {
    media: files.media,
    subtitles: files.subtitles,
    tool: { version: tool.version, source: tool.source },
    downloadedAt: nowIso(),
  };
  return { output };
}

/** staging 里下载得到的文件：只认普通文件（不跟随符号链接）、固定的名字与允许的扩展名，真实路径在 staging 里。 */
async function collectDownloads(dir: string): Promise<{ media: string | null; subtitles: DownloadOutput['subtitles'] }> {
  const real = await fs.realpath(dir);
  let media: string | null = null;
  const subtitles: DownloadOutput['subtitles'] = [];
  for (const name of (await fs.readdir(dir)).sort()) {
    const file = path.join(dir, name);
    const stat = await fs.lstat(file);
    if (!stat.isFile()) continue;
    if (!isInside(await fs.realpath(file), real)) continue;
    const match = /^media\.(?:([A-Za-z0-9_-]{1,32})\.)?([a-z0-9]{2,5})$/.exec(name);
    if (!match) continue;
    const [, language, ext] = match;
    if (!language && MEDIA_EXTENSIONS.has(ext!)) {
      // 合并后只剩一个；万一有多个（没有 ffmpeg 合并时），取最大的那个。
      if (!media || stat.size > (await fs.stat(media)).size) media = file;
    } else if (language && SUBTITLE_EXTENSIONS.has(ext!)) {
      subtitles.push({ file, language, ext: ext! });
    }
  }
  return { media, subtitles };
}

async function publish(
  deps: LinkImportDeps,
  { params, outputs, progress, jobId, signal }: PipelineStepContext<FrozenLinkImportParams>,
): Promise<{ output: PublishOutput; result: NonNullable<JobRecord['result']> }> {
  const resolved = outputs.resolve as ResolveOutput;
  const downloaded = outputs.download as DownloadOutput;
  const verified = outputs.verify as VerifyOutput;
  progress(null, 'publishing');
  try {
    await fs.mkdir(params.outDir, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOSPC') throw diskFull();
    throw new PipelineStepError('LINK_DESTINATION_UNAVAILABLE', JobsLinkImport.destinationUnwritable({ dir: params.outDir }), {
      remedy: JobsLinkImport.destinationRemedy().text,
    });
  }
  const realDir = await fs.realpath(params.outDir);
  const stem = sanitizeFileName(resolved.metadata.title ?? resolved.metadata.mediaId);
  const ext = path.extname(downloaded.media);
  const hardLink = deps.hardLink ?? true;
  const placed: string[] = [];
  const place = async (source: string, name: string, extension: string): Promise<string> => {
    signal.throwIfAborted();
    let file: string;
    try {
      file = await publishFile(source, realDir, name, extension, jobId, hardLink);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') throw diskFull();
      throw error;
    }
    placed.push(file);
    if (!isInside(await fs.realpath(file), realDir)) {
      await fs.rm(file, { force: true });
      throw new PipelineStepError('LINK_DESTINATION_UNAVAILABLE', JobsLinkImport.publishedOutside(), {});
    }
    return file;
  };
  try {
    const media = await place(downloaded.media, stem, ext);
    const base = path.basename(media, ext);
    const subtitles: string[] = [];
    for (const sub of downloaded.subtitles) subtitles.push(await place(sub.file, `${base}.${sub.language}`, `.${sub.ext}`));
    const { size, digest } = await digestFile(media);
    const output: GeneratedOutput = {
      artifactId: `sha256:${digest}`,
      mediaType: MEDIA_TYPES[ext.slice(1)] ?? 'application/octet-stream',
      byteLength: size,
      assetId: null,
      media: verified.media,
      path: media,
    };
    return { output: { media, subtitles, output }, result: { documentId: null, artifactId: output.artifactId, outputs: [output] } };
  } catch (error) {
    for (const file of placed) await fs.rm(file, { force: true }).catch(() => {});
    throw error;
  }
}

/** 新建视频（`target.create`）：在项目或会话的来源目录里新建、交给流程持有；名字不给时取页面标题，再没有时取下载的文件名。 */
async function createVideo(deps: LinkImportDeps, context: PipelineStepContext<FrozenLinkImportParams>): Promise<{ output: CreateOutput }> {
  const { params, outputs, progress } = context;
  const create = params.create!;
  if (!deps.targets) throw new PipelineStepError('PIPELINE_TARGET_UNSUPPORTED', JobsLinkImport.cannotCreateVideo(), {});
  const resolved = outputs.resolve as ResolveOutput;
  const published = outputs.publish as PublishOutput;
  progress(null, 'applying');
  const name = create.name ?? resolved.metadata.title?.trim() ?? path.basename(published.media, path.extname(published.media));
  const lease = await createHeldVideo(deps.targets, context, {
    ...createScopeOf(create),
    name: name || path.basename(published.media),
  });
  return { output: { videoId: lease.videoId, place: lease.place } };
}

/** 导入的视频：给定的（`videoId`），或这次新建的。 */
function targetVideo(params: FrozenLinkImportParams, outputs: PipelineStepContext<FrozenLinkImportParams>['outputs']): Id {
  return params.videoId ?? (outputs.create as CreateOutput).videoId;
}

async function importIntoVideo(
  deps: LinkImportDeps,
  context: PipelineStepContext<FrozenLinkImportParams>,
): Promise<{ output: ImportOutput }> {
  const { params, outputs, parentJobId, progress } = context;
  const resolved = outputs.resolve as ResolveOutput;
  const downloaded = outputs.download as DownloadOutput;
  const published = outputs.publish as PublishOutput;
  progress(null, 'applying');
  // 新建的视频：同一笔事务把素材放上主轨（第一条同类轨道），从 0 开始、覆盖整段媒体。已有的视频时间线还空着时也放（对外服务
  // 先 `videos_create` 再下载进去，架构设计 §4.8），已经有片段时只导入素材。
  const { assetId } = await importMedia(deps.videos, context, {
    videoId: targetVideo(params, outputs),
    file: published.media,
    name: resolved.metadata.title ?? path.basename(published.media),
    place: params.create !== undefined ? true : 'if-empty',
    label: JobsLinkImport.label().text,
    provenance: linkImportProvenance(params.url, resolved.metadata, downloaded, parentJobId),
  });
  return { output: { assetId } };
}

/** 摘要里的简介最多保留的字符数（素材来源里是完整的）。 */
const SUMMARY_DESCRIPTION_CHARS = 1200;

/** 摘要里的简介：截到 1200 个字符（按码点，截掉时末尾加省略号）；没有时 null。 */
function summaryDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const chars = [...description];
  return chars.length <= SUMMARY_DESCRIPTION_CHARS ? description : `${chars.slice(0, SUMMARY_DESCRIPTION_CHARS).join('')}…`;
}

/** 下载的素材的来源（视频格式规范 §4.5）：流程自己的导入与之后按产物导入（`linkImportAssetOperation`）记的完全相同。 */
function linkImportProvenance(
  url: string,
  meta: LinkMetadata,
  downloaded: Pick<DownloadOutput, 'tool' | 'downloadedAt'>,
  jobId: Id,
): { origin: string; source: Record<string, unknown> } {
  return {
    origin: 'link-import',
    source: {
      url,
      webpageUrl: meta.webpageUrl,
      platform: meta.platform,
      mediaId: meta.mediaId,
      title: meta.title,
      uploader: meta.uploader,
      uploadDate: meta.uploadDate,
      durationSec: meta.durationSec,
      // 简介与平台章节：润色、识别说话人与采用来源章节（`chapters_adopt`）读它们；之前的运行记录里没有，没有时不写。
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.chapters?.length ? { chapters: meta.chapters } : {}),
      tool: { name: 'yt-dlp', version: downloaded.tool.version, source: downloaded.tool.source },
      downloadedAt: downloaded.downloadedAt,
      jobId,
    },
  };
}

/**
 * 只下载（没有视频目标）的从链接导入之后，按产物把下载的媒体导入视频的那一个操作（智能体经 `edits_apply` 的
 * `importAsset` + `artifactId`）。bytes 收进视频目录（`managed`），与生成的产物一样：之后用户挪动或删掉下载目录里的文件，
 * 视频不受影响；来源与流程自己导入时相同（`origin: 'link-import'`，带这次运行）。`file` 是核对过内容的文件
 * （`locateArtifact`）。不是这个流程的记录、或产物不是它下载的媒体（例如转写的文稿）时 null。
 */
export function linkImportAssetOperation(
  record: JobRecord,
  output: { artifactId: string; file: string },
  options: { name?: string; ref?: string } = {},
): EditOperation | null {
  const run = record.pipeline;
  if (record.kind !== 'pipeline' || run?.name !== LINK_IMPORT_PIPELINE) return null;
  const step = (name: string) => run.steps.find((s) => s.name === name && s.status === 'completed')?.output ?? null;
  const resolved = step('resolve') as ResolveOutput | null;
  const downloaded = step('download') as DownloadOutput | null;
  const published = step('publish') as PublishOutput | null;
  if (!resolved || !downloaded || !published || published.output.artifactId !== output.artifactId) return null;
  const url = typeof run.params.url === 'string' ? run.params.url : '';
  return {
    type: 'importAsset',
    path: output.file,
    name: options.name ?? resolved.metadata.title ?? path.basename(published.media),
    ...(options.ref !== undefined ? { ref: options.ref } : {}),
    storage: 'managed',
    provenance: linkImportProvenance(url, resolved.metadata, downloaded, record.jobId),
  };
}

async function transcribe(
  deps: LinkImportDeps,
  context: PipelineStepContext<FrozenLinkImportParams>,
): Promise<{ output: TranscribeOutput }> {
  const jobs = deps.transcribe;
  if (!jobs) throw new PipelineStepError('CAPABILITY_NOT_CONFIGURED', JobsLinkImport.cannotTranscribe(), {});
  const { params, outputs } = context;
  if (!params.videoId && !params.create) {
    return { output: await downloadTranscript(jobs, context, {
      file: (outputs.publish as PublishOutput).media, directory: path.dirname((outputs.publish as PublishOutput).media),
      ...(params.transcription ? { provider: params.transcription.providerId, model: params.transcription.modelId } : {}),
      ...(params.language !== undefined ? { language: params.language } : {}),
      ...(params.hint !== undefined ? { hint: params.hint } : {}),
    }) };
  }
  const assetId = (outputs.import as ImportOutput).assetId;
  const videoId = targetVideo(params, outputs);
  // 视频里启用的转写术语表（§5.9）：与转录流程一样在提交转写时读出，版本由转写 Job 冻结。
  const glossaries = params.videoGlossaries && deps.enabledGlossaries ? await deps.enabledGlossaries(videoId) : [];
  const { jobId, documentId } = await transcribeInVideo(jobs, context, {
    videoId,
    assetId,
    ...(params.transcription ? { provider: params.transcription.providerId, model: params.transcription.modelId } : {}),
    ...(params.language !== undefined ? { language: { mode: 'assert' as const, tag: params.language } } : {}),
    ...(params.hint !== undefined ? { hint: params.hint } : {}),
    ...(params.diarize !== undefined ? { diarize: params.diarize } : {}),
    ...(glossaries.length ? { glossaries: glossaries.map((id) => ({ id })) } : {}),
  });
  if (params.captions && !documentId) throw new PipelineStepError('APPLY_FAILED', JobsLinkImport.notWrittenToVideo(), { jobId });
  return { output: { jobId, documentId } };
}

function diskFull(): PipelineStepError {
  return new PipelineStepError('LINK_DISK_FULL', JobsLinkImport.diskFull(), { remedy: linkFailureRemedy('LINK_DISK_FULL') });
}

function isInside(file: string, dir: string): boolean {
  const relative = path.relative(dir, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function digestFile(file: string): Promise<{ size: number; digest: string }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { size, digest: hash.digest('hex') };
}
