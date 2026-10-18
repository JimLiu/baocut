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
import { prepareDownloadSave } from './download-tools.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { resolveUserPath } from './video-digest.ts';
import { FRAMES_DIR, framesDirectory } from './video-frames.ts';
import { commandIdArg, revisionArg, videoArg } from './video-tools.ts';

/**
 * 网上素材（Agent 面设计 §4.3）：`assets_search` 在 Wikimedia Commons、Internet Archive 的公有领域集合与 YouTube 里检索视频、
 * 图片与音频；`assets_download` 把 Commons 与 Internet Archive 的一条下载进视频，作为 managed 素材导入（可以同时放上时间线），
 * 许可、作者与署名记进素材的 `provenance`（`origin: open-media`），`videos_inspect` 的素材里读得回来，片尾署名照它写。
 * 不给 `video` 而给 `outDir` 时只把文件存进那个目录（按 `ToolScope.fileBase` 解析，对外服务不能给），不建素材：只新建、
 * 不覆盖，重名时加序号（与 `downloads_save` 同一套写法），返回路径、许可与署名，署名由调用方自己记下。
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
        'Search terms for a subject, place, event or era. English works best because most library descriptions are English, for example "Seoul night street" or "Apollo 11 launch".',
      ),
    kind: z.enum(OPEN_MEDIA_KINDS).optional().describe('Optional: video (default), image or audio.'),
    sources: z
      .array(sourceArg)
      .min(1)
      .max(3)
      .optional()
      .describe(
        'Optional: commons (Wikimedia Commons), archive (the Prelinger, NASA and FedFlix public-domain collections), or youtube (video only, via yt-dlp). Defaults to all three for video, otherwise commons and archive.',
      ),
    commercial: z
      .boolean()
      .optional()
      .describe('Optional: true excludes non-commercial-only (NC) media. Set for commercial work such as advertising, sales or client projects. Default false.'),
    creativeCommons: z
      .boolean()
      .optional()
      .describe('Optional, youtube only: true selects videos marked CC BY. Default false also lists videos without a stated license; copyright belongs to the uploader.'),
    limit: z.number().int().min(1).max(20).optional().describe('Optional: maximum results per source. Default 8.'),
    preview: z
      .boolean()
      .optional()
      .describe('Optional: true downloads thumbnails into a contact sheet before choosing a download. sheet.cells follows candidates order. Default false.'),
  }),
  assets_download: z.strictObject({
    video: videoArg.optional().describe('Import into this video, using a path or videoId from videos_list. Choose exactly one of video and outDir.'),
    outDir: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe(
        'Save only the file into this directory, creating it if needed. Relative paths use the working directory (current directory in CLI); ~/ is the home directory. Choose exactly one of outDir and video. Outside services cannot use outDir.',
      ),
    source: downloadSourceArg.describe('The source from assets_search: commons or archive. Use download for youtube results.'),
    id: z.string().min(1).max(500).describe('The id from assets_search: File:... for Commons, or the item identifier for Internet Archive.'),
    kind: z
      .enum(OPEN_MEDIA_KINDS)
      .optional()
      .describe('Optional: video (default), image or audio, as returned by assets_search. Used to select a file from an archive item.'),
    file: z.string().min(1).max(500).optional().describe('Optional, archive only: filename within the item. Defaults to a broadly compatible H.264 / MP3 / JPEG file.'),
    maxHeight: z
      .number()
      .int()
      .min(240)
      .max(4320)
      .optional()
      .describe('Optional: maximum video height in pixels, default 1080. If the original is taller, select a transcode within this limit.'),
    name: z.string().min(1).max(200).optional().describe('Optional: asset name, defaulting to the item title.'),
    place: z
      .strictObject({
        track: z.string().min(1).max(200).optional().describe('main (default, the first unlocked track of the same kind) or a track ID.'),
        at: z
          .string()
          .regex(/^(\d+(\.\d+)?|end)$/)
          .optional()
          .describe('Start time in timeline seconds as a decimal string, or end (default, append at the track end).'),
      })
      .optional()
      .describe('Optional: place on the timeline after import, as in assets_import. Omit to register only an asset. Requires video.'),
    revision: revisionArg.optional().describe('Optional: current video revision; reject import on mismatch. Defaults to the latest revision. Requires video.'),
    commandId: commandIdArg.optional().describe('Optional: reuse this value when retrying the same import to avoid duplicate commits. Requires video.'),
  }),
};

type ToolName = keyof typeof schemas;
type SearchArgs = z.infer<(typeof schemas)['assets_search']>;
type DownloadArgs = z.infer<(typeof schemas)['assets_download']>;

const LICENSE_RULES =
  'Licenses: public-domain and cc0 permit reuse; cc-by requires attribution; cc-by-sa requires attribution and releasing the resulting video under CC BY-SA (tell the user first); nc permits non-commercial use only. Library results exclude no-derivatives (ND) and unrecognized licenses.';

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  assets_search: {
    title: 'Search open media',
    description: [
      'Search online for video, image and audio assets.',
      'Sources: Wikimedia Commons (file-page licenses reviewed by the community); curated public-domain Prelinger, NASA and FedFlix collections on Internet Archive (other items have uploader-supplied licenses and are excluded); and YouTube (video only, via yt-dlp). Read-only; does not edit videos. Rejects in strict offline mode with OFFLINE_STRICT.',
      'Each candidate includes source, id, title, kind, mediaType, width, height, durationSeconds, byteLength (archive and youtube search lack dimensions and size until download), author, license (name, url, class, attribution, shareAlike, nonCommercial, noDerivatives), attribution (one line), pageUrl, thumbnailUrl, year and downloadWith (the download tool).',
      LICENSE_RULES,
      'YouTube uses the same browser-login setting as download (outside services are anonymous). Results often have no stated license (license.class is unknown; copyright belongs to the uploader); explain their source and copyright before use and let the user decide. creativeCommons: true selects CC BY only. For youtube LINK_LOGIN_REQUIRED (sign-in or bot verification) or LINK_COOKIES_UNAVAILABLE in errors, ask the user to sign in to YouTube in their browser and enable that browser in Settings > Video downloads; link to settingsHref in Markdown.',
      'preview: true builds a thumbnail contact sheet (sheet.file, row-major; sheet.cells[i].at is the candidate index). Inspect it before choosing; if images cannot be viewed, use title, dimensions and duration. A failed source does not block others; failures appear in errors.',
      'Download the chosen result into a video using downloadWith: assets_download (copy source and id) or download (use pageUrl as url and the target video). Search here first when real people, places, events or products need authentic footage.',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: 'Find Seoul street footage', args: { query: 'Seoul night street', kind: 'video' } },
      {
        title: 'Preview commercially usable Moon-landing images',
        args: { query: 'Apollo 11 Saturn V launch', kind: 'image', commercial: true, preview: true },
      },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'query',
  },
  assets_download: {
    title: 'Download open media',
    description: [
      'Download open media found by assets_search into a video or a folder. Give video to import it as an asset, or outDir to save only the file without adding it to a video.',
      `Refetch the license and file URL from source and id (caller-provided licenses are not trusted). Download only over HTTPS from Wikimedia and Internet Archive file hosts, up to ${OPEN_MEDIA_MAX_BYTES / 1024 / 1024 / 1024} GiB. For video taller than maxHeight (default 1080), use a transcode; for overly wide images or formats other than JPEG, PNG or WebP, use the Commons-rendered image.`,
      'With video, store managed bytes and compile importAsset (plus addItem when place is given) into one undoable edit, subject to user confirmation. Asset provenance records the source, page, license and attribution; videos_inspect returns them as credit.',
      LICENSE_RULES,
      'Returns an edits_apply receipt plus assetId, itemId (null when not placed on the timeline), license, attribution and the downloaded file (url, variant, byteLength). Retain attribution and credit each source in the video ending.',
      'With outDir, create a new file without overwriting; add a numeric suffix on name collisions. Use name or the title as the filename. Returns absolute path, license, attribution, pageUrl and file, without a receipt or assetId. Import later with assets_import path; license and attribution do not automatically transfer to the asset, so retain them yourself.',
      'Error codes: OFFLINE_STRICT, OPEN_MEDIA_NOT_FOUND, OPEN_MEDIA_UNSUPPORTED (not importable media), OPEN_MEDIA_LICENSE_UNVERIFIED, OPEN_MEDIA_LICENSE_EXCLUDED (no-derivatives or unrecognized), OPEN_MEDIA_TOO_LARGE, OPEN_MEDIA_UNAVAILABLE (unreachable; retry later), OPEN_MEDIA_REJECTED.',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      {
        title: 'Download a Commons video and append to the main track',
        args: { video: 'demo', source: 'commons', id: 'File:Seoul, central street.webm', place: {} },
      },
      {
        title: 'Download a Prelinger film as an asset only',
        args: { video: 'demo', source: 'archive', id: 'Duck_and_Cover_1951', kind: 'video' },
      },
      {
        title: 'Save only a Commons image into a folder',
        args: { source: 'commons', id: 'File:Gyeongbokgung Palace in Seoul.jpg', kind: 'image', outDir: '/Volumes/Media/references' },
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
    if ((args.video === undefined) === (args.outDir === undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', 'Pass exactly one of video (import into a video) or outDir (only save the file to a folder)');
    }
    if (args.outDir !== undefined && (args.place !== undefined || args.revision !== undefined || args.commandId !== undefined)) {
      throw new ToolError('INVALID_ARGUMENTS', 'place, revision and commandId only apply with video');
    }
    // 本机目录：对外服务在这里以 INVALID_ARGUMENTS 拒绝（`fileBase`）。
    const outDir = args.outDir !== undefined ? resolveUserPath(args.outDir, scope.fileBase(access)) : undefined;
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
    if (outDir !== undefined) return this.#saveTo(outDir, access, { name, resolved, source: args.source });
    const video = args.video!;
    const approval = await scope.confirm(access, {
      tool: 'assets_download',
      video,
      ...confirmSummary(
        RcAgentTools.openMediaDownloadSummary({
          title: candidate.title,
          source: args.source === 'commons' ? 'Wikimedia Commons' : 'Internet Archive',
          license: candidate.license.name,
          place: Boolean(args.place),
        }),
      ),
    });
    const opened = await scope.open(video, access);
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
      const current = videos.mirror(opened.ref.videoId)?.video ?? opened.snapshot.video;
      const result = await this.#apply(access, opened, principal, {
        expectedRevision: args.revision ?? current.revision,
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

  /**
   * 只存文件（`outDir`）：确认写明目标，下载到临时目录，再像 `downloads_save` 那样复制进目录（只新建、不覆盖、重名加序号、
   * 0644），不建素材。
   */
  async #saveTo(
    outDir: string,
    access: ToolAccess,
    item: { name: string; resolved: OpenMediaFile; source: OpenMediaDownloadSource },
  ) {
    const { scope } = this.#deps;
    const { candidate } = item.resolved;
    const fileName = `${fileStem(item.name)}.${item.resolved.extension}`;
    const planned = path.join(outDir, fileName);
    const approval = await scope.confirm(access, {
      tool: 'assets_download',
      targets: [planned],
      ...confirmSummary(
        RcAgentTools.openMediaSaveSummary({
          title: candidate.title,
          source: item.source === 'commons' ? 'Wikimedia Commons' : 'Internet Archive',
          license: candidate.license.name,
          target: planned,
        }),
      ),
    });
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-open-media-'));
    try {
      try {
        await this.#http.download(item.resolved.url, path.join(work, fileName), OPEN_MEDIA_MAX_BYTES);
      } catch (error) {
        throw asToolError(error);
      }
      const plan = await prepareDownloadSave({ root: work, path: fileName, downloadsDir: outDir, maxBytes: OPEN_MEDIA_MAX_BYTES });
      const saved = await plan.commit();
      return {
        path: saved.path,
        title: candidate.title,
        license: candidate.license,
        attribution: candidate.attribution,
        pageUrl: candidate.pageUrl,
        file: { url: item.resolved.url, variant: item.resolved.variant, byteLength: saved.bytes },
        ...approvalField(approval),
        next: 'Saved to path (absolute). Tell the user where it is, and keep the attribution for the credits: it is not recorded with the file. To use it in a video later, import path with assets_import.',
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
