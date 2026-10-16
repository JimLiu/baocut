// i18n-ignore-file: 给模型的工具说明（跟随工具目录现有的写法，整批改英文前保持一致）
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { EditResult, LinkCookieBrowser, VideoOpenResult } from '@baocut/protocol';
import {
  classifyYtDlpFailure,
  cookieAttemptsFailure,
  runYtDlp,
  worthAnotherCookieBrowser,
  ytDlpSearchArgs,
  youtubeSearchUrl,
  type PipelineStepError,
  type YtDlpTool,
} from '@baocut/jobs';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { VideoService } from '../videos/video-service.ts';
import { videoChangeOf } from '../compositions/composition-service.ts';
import { digestReceipt } from './video-digest.ts';
import { writeContactSheet, type ContactSheet } from '../compositions/contact-sheet.ts';
import { OpenMediaHttp } from '../open-media/open-media-http.ts';
import {
  OPEN_MEDIA_DOWNLOAD_SOURCES,
  OPEN_MEDIA_KINDS,
  OPEN_MEDIA_ORIGIN,
  OPEN_MEDIA_SOURCES,
  OpenMediaError,
  allowedThumbnailHost,
  archiveMetadataUrl,
  archiveSearchUrl,
  commonsFileUrl,
  commonsSearchUrl,
  parseArchiveFile,
  parseArchiveSearch,
  parseCommonsFile,
  parseCommonsSearch,
  parseYoutubeSearch,
  usableLicense,
  type OpenMediaCandidate,
  type OpenMediaFile,
  type OpenMediaKind,
  type OpenMediaDownloadSource,
  type OpenMediaSource,
} from '../open-media/open-media-sources.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { FRAMES_DIR, framesDirectory } from './video-frames.ts';
import { commandIdArg, revisionArg, videoArg } from './video-tools.ts';

/**
 * 网上素材（Agent 面设计 §4.3）：`assets_search` 在 Wikimedia Commons、Internet Archive 的公有领域集合与 YouTube 里检索视频、
 * 图片与音频；`assets_download` 把 Commons 与 Internet Archive 的一条下载进视频，作为 managed 素材导入（可以同时放上时间线），
 * 许可、作者与署名记进素材的 `provenance`（`origin: open-media`），`videos_inspect` 的素材里读得回来，片尾署名照它写。
 *
 * 两处媒体库只取许可清楚的条目（`open-media-sources.ts`）。YouTube 经 yt-dlp 检索，网站登录按设置 › 视频下载
 * （`downloads.cookieBrowsers`，与 `download` 同一项；对外服务一律匿名），读不到 Cookie 或要登录时换下一个浏览器；许可多半没写，
 * 照常列出，由用户决定；下载走 `download`（同一套网站登录与补救）。严格离线时两个工具都拒绝。
 */

export interface OpenMediaToolsDeps {
  videos: VideoService;
  scope: ToolScope;
  offlineStrict: () => boolean;
  /** 接触表用的 ffmpeg（与代码画面同一个）。 */
  ffmpeg: () => string | Promise<string>;
  http?: OpenMediaHttp;
  /** YouTube 检索：yt-dlp（受管外部工具）与设置 › 视频下载的网站登录展开的浏览器（空的是匿名）。没有时不查 YouTube。 */
  youtube?: {
    tool: () => Promise<YtDlpTool>;
    cookieBrowsers: () => Promise<LinkCookieBrowser[]>;
  };
}

/** 下载的上限：素材是镜头的一段，不是整部影片。 */
export const OPEN_MEDIA_MAX_BYTES = 1024 * 1024 * 1024;
const THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 3840;
const IMPORT_REF = 'open-media';

const sourceArg = z.enum(OPEN_MEDIA_SOURCES);
const downloadSourceArg = z.enum(OPEN_MEDIA_DOWNLOAD_SOURCES);
const YOUTUBE_SEARCH_TIMEOUT_MS = 60_000;

const schemas = {
  assets_search: z.strictObject({
    query: z
      .string()
      .min(1)
      .max(300)
      .describe(
        '检索词：要拍到的东西、地点、事件或年代，用英文效果最好（媒体库的描述大多是英文），例如 "Seoul night street"、"Apollo 11 launch"',
      ),
    kind: z.enum(OPEN_MEDIA_KINDS).optional().describe('可选。video（默认）、image 或 audio'),
    sources: z
      .array(sourceArg)
      .min(1)
      .max(3)
      .optional()
      .describe(
        '可选。commons（Wikimedia Commons）、archive（Internet Archive 的 Prelinger、NASA、FedFlix 公有领域集合）、youtube（经 yt-dlp，只有视频）；默认 kind 为 video 时三处都查，否则查前两处',
      ),
    commercial: z
      .boolean()
      .optional()
      .describe('可选。true 时去掉只许非商业用途（NC）的；成片要商用（广告、带货、客户项目）时给。默认 false'),
    creativeCommons: z
      .boolean()
      .optional()
      .describe('可选。只用于 youtube：true 时只要标为知识共享（CC BY）的视频；默认 false，许可没写的也列出（版权归上传者）'),
    limit: z.number().int().min(1).max(20).optional().describe('可选。每处来源最多几条，默认 8'),
    preview: z
      .boolean()
      .optional()
      .describe('可选。true 时把每条的缩略图下载下来、拼成一张接触表（sheet.cells 对应 candidates 的顺序），下载前先看画面；默认 false'),
  }),
  assets_download: z.strictObject({
    video: videoArg,
    source: downloadSourceArg.describe('assets_search 结果里这一条的 source：commons 或 archive（youtube 的结果用 download）'),
    id: z.string().min(1).max(500).describe('assets_search 结果里这一条的 id（Commons 是 File:…，Internet Archive 是条目 identifier）'),
    kind: z
      .enum(OPEN_MEDIA_KINDS)
      .optional()
      .describe('可选。这一条的 kind：video（默认）、image 或 audio（assets_search 的结果里有）；archive 的条目据此挑文件'),
    file: z.string().min(1).max(500).optional().describe('可选。只用于 archive：条目里要下载的文件名；不给时挑最通用的 H.264 / MP3 / JPEG'),
    maxHeight: z
      .number()
      .int()
      .min(240)
      .max(4320)
      .optional()
      .describe('可选。视频的高度上限（像素），默认 1080：原文件更高时取不超过它的转码'),
    name: z.string().min(1).max(200).optional().describe('可选。素材名；不给时用条目的标题'),
    place: z
      .strictObject({
        track: z.string().min(1).max(200).optional().describe('main（默认，第一条未锁定的同类轨道）或轨道 ID'),
        at: z
          .string()
          .regex(/^(\d+(\.\d+)?|end)$/)
          .optional()
          .describe('开始时间：时间线上的秒数（十进制字符串），或 end（默认，接在轨道末尾）'),
      })
      .optional()
      .describe('可选。导入后放到时间线上，写法同 assets_import；不给时只登记为素材'),
    revision: revisionArg.optional().describe('可选。视频当前的版本，不一致时不导入；不给时用最新的版本'),
    commandId: commandIdArg.optional().describe('可选。同一次导入重试时带上同一个值，引擎不会重复提交'),
  }),
};

type ToolName = keyof typeof schemas;
type SearchArgs = z.infer<(typeof schemas)['assets_search']>;
type DownloadArgs = z.infer<(typeof schemas)['assets_download']>;

const LICENSE_RULES =
  '许可：public-domain 与 cc0 随便用；cc-by 要署名；cc-by-sa 要署名，用了它的成片也得用 CC BY-SA 发布（先告诉用户）；带 nc 的只许非商业用途。媒体库里禁止演绎（ND）的与许可认不出的不在结果里。';

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  assets_search: {
    title: '检索网上素材',
    description: [
      '在网上检索视频、图片与音频素材。',
      '来源：Wikimedia Commons（许可由文件页给出、社区审核过）；Internet Archive 里 Prelinger、NASA、FedFlix 这几处策展过的公有领域集合（别处条目的许可是上传者自己填的，不收）；YouTube（经 yt-dlp，只有视频）。只读，不改视频；严格离线时拒绝（OFFLINE_STRICT）。',
      '每条候选给 source、id、title、kind、mediaType、width、height、durationSeconds、byteLength（archive 与 youtube 的检索结果没有尺寸与大小，下载时才知道）、author、license（name、url、class、attribution、shareAlike、nonCommercial、noDerivatives）、attribution（一行署名）、pageUrl、thumbnailUrl、year 与 downloadWith（用哪个工具下载）。',
      LICENSE_RULES,
      'YouTube：网站登录同 download，按设置 › 视频下载里选的浏览器（对外服务匿名）。许可多半没写（license.class 为 unknown，版权归上传者），照常列出：用之前告诉用户这几条的出处与版权，由用户决定；creativeCommons: true 时只要 CC BY 的。errors 里 youtube 的 LINK_LOGIN_REQUIRED（YouTube 要求登录或确认不是机器人）或 LINK_COOKIES_UNAVAILABLE 时，提醒用户：先在浏览器里登录 YouTube，再到设置 › 视频下载确认勾选了那个浏览器（用 settingsHref 写成 Markdown 设置链接）。',
      'preview: true 时把缩略图拼成一张接触表（sheet.file，行优先，sheet.cells[i].at 是候选的序号），看过画面再挑；看不了图时按标题、尺寸与时长挑。一处来源出错不影响别处，错误在 errors 里。',
      '挑中后按 downloadWith 下载进视频：assets_download（source 与 id 照抄）或 download（url 用 pageUrl，video 给目标视频）。真实的人物、地点、事件与产品要真实画面时先在这里找。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '找首尔街景的视频', args: { query: 'Seoul night street', kind: 'video' } },
      {
        title: '找能商用的登月照片，看缩略图',
        args: { query: 'Apollo 11 Saturn V launch', kind: 'image', commercial: true, preview: true },
      },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'query',
  },
  assets_download: {
    title: '下载网上素材',
    description: [
      '把 assets_search 找到的一条网上素材下载进视频，导入为素材。',
      `按 source 与 id 重新向来源取一次许可与文件地址（不信任调用方给的许可），只从 Wikimedia 与 Internet Archive 的文件主机下载（https），上限 ${OPEN_MEDIA_MAX_BYTES / 1024 / 1024 / 1024} GiB；视频比 maxHeight（默认 1080）高时取转码，图片太宽或不是 JPEG、PNG、WebP 时取 Commons 渲染的图。`,
      'bytes 收进视频（managed），编译成 importAsset（给了 place 时再加 addItem），一笔修改、可以撤销，会向用户确认。素材的 provenance 记下来源、页面、许可与署名，videos_inspect 的素材里读得回来（credit）。',
      LICENSE_RULES,
      '返回与 edits_apply 相同的回执，另有 assetId、itemId（没有放到时间线上时为 null）、license、attribution 与实际下载的 file（url、variant、byteLength）。把 attribution 记下来，成片片尾逐条署名。',
      '错误码：OFFLINE_STRICT、OPEN_MEDIA_NOT_FOUND、OPEN_MEDIA_UNSUPPORTED（不是能导入的媒体）、OPEN_MEDIA_LICENSE_UNVERIFIED、OPEN_MEDIA_LICENSE_EXCLUDED（禁止演绎或认不出）、OPEN_MEDIA_TOO_LARGE、OPEN_MEDIA_UNAVAILABLE（连不上，稍后再试）、OPEN_MEDIA_REJECTED。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      {
        title: '下载一段 Commons 视频并接在主轨末尾',
        args: { video: 'demo', source: 'commons', id: 'File:Seoul, central street.webm', place: {} },
      },
      {
        title: '下载 Prelinger 的一部短片（只登记）',
        args: { video: 'demo', source: 'archive', id: 'Duck_and_Cover_1951', kind: 'video' },
      },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'video',
  },
};

export class OpenMediaTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: OpenMediaToolsDeps;
  readonly #http: OpenMediaHttp;

  constructor(deps: OpenMediaToolsDeps) {
    this.#deps = deps;
    this.#http = deps.http ?? new OpenMediaHttp();
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'assets_search':
        return this.#search(args as SearchArgs, principal);
      case 'assets_download':
        return this.#download(args as DownloadArgs, principal);
    }
    throw new ToolError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
  }

  #offline(): void {
    if (this.#deps.offlineStrict()) {
      throw new ToolError(
        'OFFLINE_STRICT',
        'Strict offline mode is on, so online footage cannot be searched or downloaded. Ask the user to turn off strict offline mode in Settings, or to provide the media files and import them with assets_import.',
      );
    }
  }

  async #search(args: SearchArgs, principal: ToolPrincipal) {
    const access = this.#deps.scope.authorize(principal, false);
    this.#offline();
    const kind: OpenMediaKind = args.kind ?? 'video';
    const limit = args.limit ?? 8;
    const commercial = args.commercial === true;
    const defaults: OpenMediaSource[] = kind === 'video' && this.#deps.youtube ? [...OPEN_MEDIA_SOURCES] : ['commons', 'archive'];
    const requested = [...new Set(args.sources ?? defaults)];
    const warnings: string[] = [];
    const sources = requested.filter((source) => {
      if (source !== 'youtube') return true;
      if (kind !== 'video') warnings.push('youtube only has videos; skipped it for this kind.');
      else if (!this.#deps.youtube) warnings.push('YouTube search is not available on this surface.');
      else return true;
      return false;
    });
    const errors: SourceError[] = [];
    const excluded = { noDerivativesOrUnknown: 0, nonCommercial: 0 };
    const lists = await Promise.all(
      sources.map(async (source) => {
        try {
          if (source === 'youtube')
            return await this.#youtube(args.query, limit, args.creativeCommons === true, access.principal.kind === 'service');
          // 多要一些：去掉许可不合的之后仍凑得够。
          const want = Math.min(50, limit * 2);
          const body = await this.#http.json(
            source === 'commons' ? commonsSearchUrl(args.query, kind, want) : archiveSearchUrl(args.query, kind, want),
          );
          const all = source === 'commons' ? parseCommonsSearch(body, kind) : parseArchiveSearch(body, kind);
          const kept: OpenMediaCandidate[] = [];
          for (const candidate of all) {
            if (usableLicense(candidate.license, commercial)) kept.push(candidate);
            else if (candidate.license.noDerivatives || candidate.license.class === 'unknown') excluded.noDerivativesOrUnknown++;
            else excluded.nonCommercial++;
          }
          return kept.slice(0, limit);
        } catch (error) {
          errors.push({ source, ...sourceError(error) });
          return [];
        }
      }),
    );
    const candidates = lists.flat();
    if (candidates.length === 0 && sources.length > 0 && errors.length === sources.length) {
      throw new ToolError(errors[0]!.code, errors.map((e) => `${e.source}: ${e.message}`).join('; '), {
        errors,
        next: searchNext([], errors),
      });
    }
    let sheet: ContactSheet | undefined;
    if (args.preview && candidates.length) {
      try {
        sheet = await this.#thumbnailSheet(access, candidates);
      } catch (error) {
        warnings.push(`Could not build the thumbnail contact sheet: ${describe(error).message}`);
      }
    }
    return {
      query: args.query,
      kind,
      candidates,
      ...(sheet ? { sheet } : {}),
      excluded,
      ...(errors.length ? { errors } : {}),
      ...(warnings.length ? { warnings } : {}),
      next: searchNext(candidates, errors),
    };
  }

  /** YouTube 检索：按设置的浏览器逐个试网站登录（对外服务匿名），读不到 Cookie 或要登录时换下一个，同 `download` 的解析。 */
  async #youtube(query: string, limit: number, creativeCommons: boolean, service: boolean): Promise<OpenMediaCandidate[]> {
    const youtube = this.#deps.youtube!;
    const tool = await youtube.tool();
    const browsers = service ? [] : await youtube.cookieBrowsers();
    const url = youtubeSearchUrl(query, creativeCommons);
    const signal = AbortSignal.timeout(YOUTUBE_SEARCH_TIMEOUT_MS);
    const attempts: Array<{ browser: LinkCookieBrowser; error: PipelineStepError }> = [];
    for (const browser of browsers.length ? browsers : [null]) {
      const run = await runYtDlp(tool, ytDlpSearchArgs(url, limit, browser ?? undefined), { signal, keepStdout: true });
      if (run.code === 0) {
        let body: unknown;
        try {
          body = JSON.parse(run.stdout);
        } catch {
          throw new OpenMediaError('OPEN_MEDIA_UNAVAILABLE', 'yt-dlp did not return JSON for the YouTube search');
        }
        return parseYoutubeSearch(body, creativeCommons).slice(0, limit);
      }
      const error = classifyYtDlpFailure(run.stderr, run.code);
      if (browser === null || !worthAnotherCookieBrowser(error)) throw error;
      attempts.push({ browser, error });
    }
    throw cookieAttemptsFailure(attempts);
  }

  async #thumbnailSheet(access: ToolAccess, candidates: OpenMediaCandidate[]): Promise<ContactSheet | undefined> {
    const dir = await framesDirectory(this.#deps.scope.saveRoot(access), 'open-media', null);
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-open-media-thumbs-'));
    try {
      const frames: Array<{ file: string; at: string }> = [];
      await Promise.all(
        candidates.map(async (candidate, index) => {
          if (!candidate.thumbnailUrl) return;
          const file = path.join(work, `${index}.img`);
          try {
            await this.#http.download(candidate.thumbnailUrl, file, THUMBNAIL_MAX_BYTES, undefined, allowedThumbnailHost);
            frames.push({ file, at: String(index) });
          } catch {
            // 缩略图取不到的那一格空着：cells 里没有它。
          }
        }),
      );
      if (!frames.length) return undefined;
      frames.sort((a, b) => Number(a.at) - Number(b.at));
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
      return await writeContactSheet(await this.#deps.ffmpeg(), frames, { width: 320, height: 180 }, path.join(dir, `search-${stamp}.png`));
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  async #download(args: DownloadArgs, principal: ToolPrincipal) {
    const { scope, videos } = this.#deps;
    const access = scope.authorize(principal, true);
    this.#offline();
    const kind: OpenMediaKind = args.kind ?? 'video';
    const limits = { maxHeight: args.maxHeight ?? 1080, maxImageWidth: MAX_IMAGE_WIDTH };
    let resolved: OpenMediaFile;
    try {
      resolved =
        args.source === 'commons'
          ? parseCommonsFile(await this.#http.json(commonsFileUrl(args.id, MAX_IMAGE_WIDTH)), limits)
          : parseArchiveFile(await this.#http.json(archiveMetadataUrl(args.id)), kind, args.file, limits);
    } catch (error) {
      throw asToolError(error);
    }
    const { candidate } = resolved;
    if (!usableLicense(candidate.license, false)) {
      throw new ToolError(
        'OPEN_MEDIA_LICENSE_EXCLUDED',
        `"${candidate.title}" is licensed ${candidate.license.name}, which forbids derivatives or is unrecognized; it cannot be edited into a video`,
        {
          license: candidate.license,
          next: 'Pick another item with a clear license that allows derivatives',
        },
      );
    }
    if (resolved.byteLength !== null && resolved.byteLength > OPEN_MEDIA_MAX_BYTES) {
      throw asToolError(
        new OpenMediaError(
          'OPEN_MEDIA_TOO_LARGE',
          `The file is ${Math.ceil(resolved.byteLength / 1024 / 1024)} MiB, over the ${OPEN_MEDIA_MAX_BYTES / 1024 / 1024} MiB limit`,
          {},
        ),
      );
    }
    const name = args.name ?? candidate.title;
    const approval = await scope.confirm(access, {
      tool: 'assets_download',
      video: args.video,
      ...confirmSummary(
        RcAgentTools.openMediaDownloadSummary({
          title: candidate.title,
          source: args.source === 'commons' ? 'Wikimedia Commons' : 'Internet Archive',
          license: candidate.license.name,
          place: Boolean(args.place),
        }),
      ),
    });
    const opened = await scope.open(args.video, access);
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-open-media-'));
    try {
      const file = path.join(work, `${fileStem(name)}.${resolved.extension}`);
      let byteLength: number;
      try {
        byteLength = await this.#http.download(resolved.url, file, OPEN_MEDIA_MAX_BYTES);
      } catch (error) {
        throw asToolError(error);
      }
      const provenance = {
        origin: OPEN_MEDIA_ORIGIN,
        source: {
          source: candidate.source,
          id: candidate.id,
          title: candidate.title,
          author: candidate.author,
          pageUrl: candidate.pageUrl,
          fileUrl: resolved.url,
          variant: resolved.variant,
          license: candidate.license,
          attribution: candidate.attribution,
          retrievedAt: new Date().toISOString(),
        },
      };
      const operations: Record<string, unknown>[] = [
        { type: 'importAsset', path: file, name, storage: 'managed', provenance, ref: IMPORT_REF },
      ];
      if (args.place) {
        const { track, at } = args.place;
        operations.push({
          type: 'addItem',
          asset: { ref: IMPORT_REF },
          ...(track !== undefined && track !== 'main' ? { trackId: track } : {}),
          ...(at !== undefined && at !== 'end' ? { at: Number(at) } : {}),
          name,
        });
      }
      const video = videos.mirror(opened.ref.videoId)?.video ?? opened.snapshot.video;
      const result = await this.#apply(access, opened, principal, {
        expectedRevision: args.revision ?? video.revision,
        label: RcAgentTools.importAssetLabel({ name, place: Boolean(args.place) }).text,
        operations,
        commandId: args.commandId,
      });
      const after = videos.mirror(opened.ref.videoId)?.video ?? opened.snapshot.video;
      const created = new Set(result.receipt.createdIds);
      const item = args.place ? (after.sequences[after.rootSequenceId]?.items.find((it) => created.has(it.id)) ?? null) : null;
      return {
        ...digestReceipt(result.receipt, after.sequences[after.rootSequenceId]!.fps, result.replayed),
        assetId: result.receipt.refs?.[IMPORT_REF] ?? null,
        itemId: item?.id ?? null,
        title: candidate.title,
        license: candidate.license,
        attribution: candidate.attribution,
        pageUrl: candidate.pageUrl,
        file: { url: resolved.url, variant: resolved.variant, byteLength },
        ...approvalField(approval),
      };
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  async #apply(
    access: ToolAccess,
    opened: VideoOpenResult,
    principal: ToolPrincipal,
    edit: { expectedRevision: string; label: string; operations: Record<string, unknown>[]; commandId?: string | undefined },
  ): Promise<EditResult> {
    const { videos, scope } = this.#deps;
    const videoId = opened.ref.videoId;
    const taskId = (access as { taskId?: unknown }).taskId;
    const result = await videos.apply(
      {
        videoId,
        commandId: scope.commandId(access, edit.commandId),
        expectedRevision: edit.expectedRevision,
        operations: edit.operations as never,
        label: edit.label,
      },
      principal,
      { ...(typeof taskId === 'string' ? { taskId } : {}), protections: scope.protections?.(access, videoId) ?? [] },
    );
    scope.recordChange(access, videoChangeOf(videos, opened, result));
    return result;
  }
}

/** `FRAMES_DIR` 下检索缩略图的目录名（说明里提到）。 */
export const OPEN_MEDIA_THUMBS_DIR = path.join(FRAMES_DIR, 'open-media');

interface SourceError {
  source: OpenMediaSource;
  code: string;
  message: string;
  /** 给人看的补救（yt-dlp 的失败、外部工具不可用时有）。 */
  remedy?: string;
  /** 设置 › 视频下载的地址：要登录或读不到 Cookie 时有。 */
  settingsHref?: string;
}

/** 一处来源的失败：代码、原话，与 yt-dlp / 外部工具给的补救。 */
function sourceError(error: unknown): Omit<SourceError, 'source'> {
  const { code, message } = describe(error);
  const details = (error as { details?: Record<string, unknown> } | null)?.details ?? {};
  return {
    code,
    message,
    ...(typeof details.remedy === 'string' ? { remedy: details.remedy } : {}),
    ...(typeof details.settingsHref === 'string' ? { settingsHref: details.settingsHref } : {}),
  };
}

function searchNext(candidates: OpenMediaCandidate[], errors: SourceError[]): string {
  const parts: string[] = [];
  if (candidates.length) {
    parts.push(
      'Download a pick by its downloadWith: assets_download (copy source and id; pass kind for archive items), or download with url set to pageUrl and video set to the target video.',
      'Licenses with nc allow non-commercial use only; with sa the finished video must use the same license. YouTube results with license.class unknown belong to their uploaders: tell the user where each one comes from and let them decide before using it.',
    );
  } else {
    parts.push(
      'No usable results. Retry with a more specific or broader English query, use generated images or code scenes instead, or ask the user for media.',
    );
  }
  const login = errors.find((e) => e.code === 'LINK_LOGIN_REQUIRED' || e.code === 'LINK_COOKIES_UNAVAILABLE');
  if (login) {
    parts.push(
      `YouTube search failed without usable browser cookies (${login.code}). Tell the user: sign in to YouTube in a browser, then make sure that browser is checked under Settings › Video downloads (link: ${login.settingsHref ?? 'settings'}, written as a Markdown link in the user's language), and search again.`,
    );
  } else if (errors.some((e) => e.source === 'youtube' && e.remedy)) {
    parts.push('YouTube search failed: relay errors[].remedy to the user.');
  }
  return parts.join(' ');
}

function describe(error: unknown): { code: string; message: string } {
  if (error instanceof OpenMediaError || error instanceof ToolError) return { code: error.code, message: error.message };
  if (error instanceof Error) {
    // yt-dlp 的失败（PipelineStepError：LINK_*）与外部工具不可用（RpcError，details.code 是 TOOL_*）照原样报。
    const { code, details } = error as { code?: unknown; details?: { code?: unknown } };
    const known = typeof details?.code === 'string' ? details.code : typeof code === 'string' && /^[A-Z][A-Z_]+$/.test(code) ? code : null;
    return { code: known ?? 'OPEN_MEDIA_UNAVAILABLE', message: error.message };
  }
  return { code: 'OPEN_MEDIA_UNAVAILABLE', message: String(error) };
}

function asToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  const { code, message } = describe(error);
  const next =
    code === 'OPEN_MEDIA_UNAVAILABLE'
      ? 'The network or source is temporarily unavailable. Try again later; if it still fails, use another footage source.'
      : code === 'OPEN_MEDIA_TOO_LARGE'
        ? 'Pick a shorter, smaller item, or pass a smaller maxHeight'
        : 'Pick a different assets_search result';
  return new ToolError(code, message, { ...(error instanceof OpenMediaError ? error.details : {}), next });
}

/** 存盘的文件名：去掉路径与控制字符，截到 80 个字符。 */
function fileStem(name: string): string {
  const stem = [...name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim()].slice(0, 80).join('');
  return stem || 'open-media';
}
