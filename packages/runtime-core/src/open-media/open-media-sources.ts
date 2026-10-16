/**
 * 公开许可的网上素材（Agent 面设计 §4.3 的 `assets_search` / `assets_download`）：两个来源的检索与解析，只做 URL 拼装与响应解读，
 * 不发请求（请求在 `open-media-http.ts`）。
 *
 * - **Wikimedia Commons**：MediaWiki 的检索（文件命名空间、`filetype:` 关键字）加 `imageinfo` 的 `extmetadata`，许可、作者、
 *   出处都由 Commons 的文件页给出，社区审核过；视频另取 `videoinfo` 的转码，原文件太大时换不超过上限高度的转码。
 * - **Internet Archive**：只检索几处策展过的公有领域集合（Prelinger、NASA、FedFlix）。别处的条目许可是上传者自己填的，常有
 *   冒充 CC 的商业影片，不收。
 *
 * 许可归成几类（`LicenseClass`），检索时去掉禁止演绎（ND）的与认不出的；`commercial` 时再去掉非商业（NC）的。署名文字按
 * 「标题、作者、许可、出处」（TASL）写成一行，导入时连同许可记进素材的 `provenance`（`origin: open-media`）。
 */

export const OPEN_MEDIA_ORIGIN = 'open-media';

/** 检索的来源：两处许可清楚的媒体库，加上 YouTube（经 yt-dlp 检索，许可多半没写，版权归上传者）。 */
export const OPEN_MEDIA_SOURCES = ['commons', 'archive', 'youtube'] as const;
export type OpenMediaSource = (typeof OPEN_MEDIA_SOURCES)[number];

/** `assets_download` 直接下载的来源；YouTube 的结果走 `download`（yt-dlp，按设置带网站登录）。 */
export const OPEN_MEDIA_DOWNLOAD_SOURCES = ['commons', 'archive'] as const;
export type OpenMediaDownloadSource = (typeof OPEN_MEDIA_DOWNLOAD_SOURCES)[number];

export const OPEN_MEDIA_KINDS = ['video', 'image', 'audio'] as const;
export type OpenMediaKind = (typeof OPEN_MEDIA_KINDS)[number];

/** Internet Archive 只收这几个集合：馆藏方确认过的公有领域。 */
export const ARCHIVE_COLLECTIONS = ['prelinger', 'nasa', 'fedflix'] as const;

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const ARCHIVE_SEARCH = 'https://archive.org/advancedsearch.php';
export const ARCHIVE_METADATA = 'https://archive.org/metadata/';

/** 下载时只认这些主机（https）；Internet Archive 的下载会重定向到 `ia8xxxxx.us.archive.org` 这类节点。 */
export function allowedDownloadHost(host: string): boolean {
  return host === 'upload.wikimedia.org' || host === 'archive.org' || host.endsWith('.archive.org');
}

/** 检索时取缩略图只认这些主机（https）。 */
export function allowedThumbnailHost(host: string): boolean {
  return (
    host === 'thumb.wikimedia.org' ||
    host === 'upload.wikimedia.org' ||
    host === 'archive.org' ||
    host.endsWith('.archive.org') ||
    host === 'i.ytimg.com'
  );
}

export type LicenseClass =
  'public-domain' | 'cc0' | 'cc-by' | 'cc-by-sa' | 'cc-by-nc' | 'cc-by-nc-sa' | 'cc-by-nd' | 'cc-by-nc-nd' | 'other' | 'unknown';

export interface LicenseInfo {
  /** 来源给的许可名（如 `CC BY-SA 4.0`、`Public domain`）。 */
  name: string;
  url: string | null;
  class: LicenseClass;
  /** 要署名（CC BY 系）。 */
  attribution: boolean;
  /** 相同方式共享：用了它的成片也得用同样的许可发布。 */
  shareAlike: boolean;
  /** 只许非商业用途。 */
  nonCommercial: boolean;
  /** 禁止演绎：不能剪、裁、调色或混进别的画面。 */
  noDerivatives: boolean;
}

export interface OpenMediaCandidate {
  source: OpenMediaSource;
  /** `assets_download` 要的 id：Commons 是文件页标题（`File:…`），Internet Archive 是条目的 identifier。 */
  id: string;
  title: string;
  kind: OpenMediaKind;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  byteLength: number | null;
  author: string | null;
  license: LicenseInfo;
  /** 一行署名（TASL）。 */
  attribution: string;
  pageUrl: string;
  thumbnailUrl: string | null;
  year: number | null;
  /** 用哪个工具下载：Commons 与 Internet Archive 用 `assets_download`，YouTube 用 `download`（`pageUrl` 作 url）。 */
  downloadWith: 'assets_download' | 'download';
}

/** 解析出的要下载的文件。 */
export interface OpenMediaFile {
  candidate: OpenMediaCandidate;
  url: string;
  /** 存盘用的扩展名（不带点）。 */
  extension: string;
  byteLength: number | null;
  /** 选了转码或缩图而不是原文件时说明是哪一个。 */
  variant: string | null;
}

export class OpenMediaError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'OpenMediaError';
    this.code = code;
    this.details = details;
  }
}

// ---- 许可 ----

/** 按许可名与链接归类。 */
export function classifyLicense(name: string | null | undefined, url: string | null | undefined): LicenseInfo {
  const label = (name ?? '').trim();
  const link = (url ?? '').trim() || null;
  const text = `${label} ${link ?? ''}`.toLowerCase();
  let cls: LicenseClass;
  if (/publicdomain\/zero|\bcc0\b|cc-zero/.test(text)) cls = 'cc0';
  else if (/public ?domain|publicdomain\/mark|\bpd\b|pd-/.test(text)) cls = 'public-domain';
  else if (/by-nc-nd|by[ -]nc[ -]nd/.test(text)) cls = 'cc-by-nc-nd';
  else if (/by-nc-sa|by[ -]nc[ -]sa/.test(text)) cls = 'cc-by-nc-sa';
  else if (/by-nd|by[ -]nd/.test(text)) cls = 'cc-by-nd';
  else if (/by-nc|by[ -]nc/.test(text)) cls = 'cc-by-nc';
  else if (/by-sa|by[ -]sa/.test(text)) cls = 'cc-by-sa';
  else if (/licenses\/by\/|\bcc[ -]by\b|attribution/.test(text)) cls = 'cc-by';
  else if (label || link) cls = 'other';
  else cls = 'unknown';
  return {
    name: label || (cls === 'unknown' ? 'unknown' : (link ?? cls)),
    url: link,
    class: cls,
    attribution: cls.startsWith('cc-by') || cls === 'other',
    shareAlike: cls.endsWith('-sa'),
    nonCommercial: cls.includes('-nc'),
    noDerivatives: cls.endsWith('-nd'),
  };
}

/** 检索结果里留不留：禁止演绎与认不出的不留；要商用时去掉非商业的。 */
export function usableLicense(license: LicenseInfo, commercial: boolean): boolean {
  if (license.noDerivatives || license.class === 'unknown') return false;
  return !(commercial && license.nonCommercial);
}

const SOURCE_LABEL: Record<OpenMediaSource, string> = { commons: 'Wikimedia Commons', archive: 'Internet Archive', youtube: 'YouTube' };

/** 一行署名：`"标题" by 作者, 许可 (链接), via 来源`。公有领域不写许可链接。 */
export function attributionLine(c: {
  title: string;
  author: string | null;
  license: LicenseInfo;
  source: OpenMediaSource;
  pageUrl: string;
}): string {
  const by = c.author ? ` by ${c.author}` : '';
  const license =
    c.license.class === 'public-domain' || c.license.class === 'cc0'
      ? c.license.class === 'cc0'
        ? 'CC0'
        : 'public domain'
      : `${c.license.name}${c.license.url ? ` (${c.license.url})` : ''}`;
  // 许可没写的（YouTube 的大多数）只写出处。
  if (c.license.class === 'unknown') return `"${c.title}"${by}, via ${SOURCE_LABEL[c.source]} (${c.pageUrl})`;
  return `"${c.title}"${by}, ${license}, via ${SOURCE_LABEL[c.source]} (${c.pageUrl})`;
}

// ---- Wikimedia Commons ----

const COMMONS_FILETYPE: Record<OpenMediaKind, string> = { video: 'video', image: 'bitmap|drawing', audio: 'audio' };
const EXTMETADATA = ['LicenseShortName', 'LicenseUrl', 'Artist', 'Credit', 'ObjectName', 'DateTimeOriginal'].join('|');

export function commonsSearchUrl(query: string, kind: OpenMediaKind, limit: number): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query} filetype:${COMMONS_FILETYPE[kind]}`,
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|mediatype|extmetadata',
    iiurlwidth: '480',
    iiextmetadatafilter: EXTMETADATA,
  });
  return `${COMMONS_API}?${params}`;
}

/** 解析一个文件时：`imageinfo`（`iiurlwidth` 是图片缩图的宽度上限）加视频的转码。 */
export function commonsFileUrl(title: string, imageWidth: number): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: title,
    prop: 'imageinfo|videoinfo',
    iiprop: 'url|size|mime|mediatype|extmetadata',
    iiurlwidth: String(imageWidth),
    iiextmetadatafilter: EXTMETADATA,
    viprop: 'derivatives',
  });
  return `${COMMONS_API}?${params}`;
}

interface CommonsMeta {
  value?: unknown;
}
interface CommonsImageInfo {
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  url?: string;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  descriptionurl?: string;
  mime?: string;
  mediatype?: string;
  extmetadata?: Record<string, CommonsMeta>;
}
interface CommonsPage {
  title?: string;
  missing?: boolean;
  imageinfo?: CommonsImageInfo[];
  videoinfo?: Array<{ derivatives?: Array<{ src?: string; type?: string; width?: number; height?: number; transcodekey?: string }> }>;
}

function commonsPages(body: unknown): CommonsPage[] {
  const pages = (body as { query?: { pages?: unknown } } | null)?.query?.pages;
  return Array.isArray(pages) ? (pages as CommonsPage[]) : [];
}

function metaText(meta: Record<string, CommonsMeta> | undefined, key: string): string | null {
  const value = meta?.[key]?.value;
  if (typeof value !== 'string') return null;
  const text = plainText(value);
  return text || null;
}

function commonsKind(info: CommonsImageInfo): OpenMediaKind | null {
  const mediatype = (info.mediatype ?? '').toUpperCase();
  const mime = info.mime ?? '';
  if (mediatype === 'VIDEO' || (mime.startsWith('video/') && (info.width ?? 0) > 0)) return 'video';
  if (mediatype === 'AUDIO' || mime.startsWith('audio/') || mime === 'application/ogg') return 'audio';
  if (mediatype === 'BITMAP' || mediatype === 'DRAWING' || mime.startsWith('image/')) return 'image';
  return null;
}

function commonsCandidate(page: CommonsPage): OpenMediaCandidate | null {
  const info = page.imageinfo?.[0];
  if (!page.title || !info?.url) return null;
  const kind = commonsKind(info);
  if (!kind) return null;
  const meta = info.extmetadata;
  const title = metaText(meta, 'ObjectName') ?? page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '');
  const author = metaText(meta, 'Artist');
  const license = classifyLicense(metaText(meta, 'LicenseShortName'), metaText(meta, 'LicenseUrl'));
  const pageUrl = info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`;
  const year = Number(/\b(1[89]\d\d|20\d\d)\b/.exec(metaText(meta, 'DateTimeOriginal') ?? '')?.[1]) || null;
  return {
    source: 'commons',
    id: page.title,
    title,
    kind,
    mediaType: info.mime ?? null,
    width: kind === 'audio' ? null : (info.width ?? null),
    height: kind === 'audio' ? null : (info.height ?? null),
    durationSeconds: typeof info.duration === 'number' ? round(info.duration) : null,
    byteLength: info.size ?? null,
    author,
    license,
    attribution: attributionLine({ title, author, license, source: 'commons', pageUrl }),
    pageUrl,
    thumbnailUrl: info.thumburl ? stripTracking(info.thumburl) : null,
    year,
    downloadWith: 'assets_download',
  };
}

export function parseCommonsSearch(body: unknown, kind: OpenMediaKind): OpenMediaCandidate[] {
  const pages = commonsPages(body).sort((a, b) => ((a as { index?: number }).index ?? 0) - ((b as { index?: number }).index ?? 0));
  return pages.map(commonsCandidate).filter((c): c is OpenMediaCandidate => c !== null && c.kind === kind);
}

/** 图片原文件能直接用的格式；别的（TIFF、SVG、GIF…）取 Commons 渲染的缩图（PNG 或 JPEG）。 */
const DIRECT_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function parseCommonsFile(body: unknown, limits: { maxHeight: number; maxImageWidth: number }): OpenMediaFile {
  const page = commonsPages(body)[0];
  if (!page || page.missing)
    throw new OpenMediaError('OPEN_MEDIA_NOT_FOUND', 'No such file on Commons: use the id from an assets_search result (File:…)');
  const candidate = commonsCandidate(page);
  const info = page.imageinfo?.[0];
  if (!candidate || !info?.url)
    throw new OpenMediaError('OPEN_MEDIA_UNSUPPORTED', 'This file is not a video, image, or audio file and cannot be imported');
  if (candidate.kind === 'image') {
    const tooWide = (info.width ?? 0) > limits.maxImageWidth;
    if ((tooWide || !DIRECT_IMAGE.has(info.mime ?? '')) && info.thumburl) {
      const url = stripTracking(info.thumburl);
      return {
        candidate,
        url,
        extension: extensionOf(url, 'png'),
        byteLength: null,
        variant: `${info.thumbwidth ?? limits.maxImageWidth}px rendition`,
      };
    }
  }
  if (candidate.kind === 'video' && (info.height ?? 0) > limits.maxHeight) {
    const derivatives = (page.videoinfo?.[0]?.derivatives ?? []).filter(
      (d) => d.src && d.transcodekey && (d.height ?? 0) <= limits.maxHeight && (d.type ?? '').startsWith('video/webm'),
    );
    derivatives.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    const best = derivatives[0];
    if (best?.src) {
      return {
        candidate: { ...candidate, width: best.width ?? null, height: best.height ?? null },
        url: stripTracking(best.src),
        extension: 'webm',
        byteLength: null,
        variant: best.transcodekey ?? null,
      };
    }
  }
  const url = stripTracking(info.url);
  return { candidate, url, extension: extensionOf(url, 'bin'), byteLength: info.size ?? null, variant: null };
}

// ---- Internet Archive ----

const ARCHIVE_MEDIATYPE: Record<OpenMediaKind, string> = { video: 'movies', image: 'image', audio: 'audio' };

export function archiveSearchUrl(query: string, kind: OpenMediaKind, limit: number): string {
  const q = `(${query}) AND mediatype:(${ARCHIVE_MEDIATYPE[kind]}) AND collection:(${ARCHIVE_COLLECTIONS.join(' OR ')})`;
  const params = new URLSearchParams({ q, rows: String(limit), output: 'json' });
  for (const field of ['identifier', 'title', 'creator', 'licenseurl', 'year', 'collection']) params.append('fl[]', field);
  return `${ARCHIVE_SEARCH}?${params}`;
}

export function archiveMetadataUrl(identifier: string): string {
  return `${ARCHIVE_METADATA}${encodeURIComponent(identifier)}`;
}

function firstText(value: unknown): string | null {
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === 'string' && one.trim() ? plainText(one) : null;
}

function archiveCandidate(doc: Record<string, unknown>, kind: OpenMediaKind): OpenMediaCandidate | null {
  const id = firstText(doc.identifier);
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return null;
  const title = firstText(doc.title) ?? id;
  const author = firstText(doc.creator);
  // 策展集合里没填 licenseurl 的条目，馆藏方的声明就是公有领域。
  const license = classifyLicense(firstText(doc.licenseurl) ? null : 'Public domain', firstText(doc.licenseurl));
  const pageUrl = `https://archive.org/details/${id}`;
  return {
    source: 'archive',
    id,
    title,
    kind,
    mediaType: null,
    width: null,
    height: null,
    durationSeconds: null,
    byteLength: null,
    author,
    license,
    attribution: attributionLine({ title, author, license, source: 'archive', pageUrl }),
    pageUrl,
    thumbnailUrl: `https://archive.org/services/img/${id}`,
    year: Number(firstText(doc.year)) || null,
    downloadWith: 'assets_download',
  };
}

export function parseArchiveSearch(body: unknown, kind: OpenMediaKind): OpenMediaCandidate[] {
  const docs = (body as { response?: { docs?: unknown } } | null)?.response?.docs;
  if (!Array.isArray(docs)) return [];
  return docs.map((doc) => archiveCandidate(doc as Record<string, unknown>, kind)).filter((c): c is OpenMediaCandidate => c !== null);
}

interface ArchiveFile {
  name?: string;
  format?: string;
  size?: string;
  length?: string;
  width?: string;
  height?: string;
  source?: string;
}

/** 视频按这个顺序挑：H.264 的派生文件最通用、也比原文件小。 */
const ARCHIVE_VIDEO_FORMATS = ['h.264', 'h.264 ia', 'mpeg4', '512kb mpeg4', 'h.264 hd'];
const ARCHIVE_AUDIO_FORMATS = ['vbr mp3', '128kbps mp3', 'mp3', 'flac', 'ogg vorbis'];
const ARCHIVE_IMAGE_FORMATS = ['jpeg', 'png'];

export function parseArchiveFile(
  body: unknown,
  kind: OpenMediaKind,
  wanted: string | undefined,
  limits: { maxHeight: number },
): OpenMediaFile {
  const meta = body as { metadata?: Record<string, unknown>; files?: ArchiveFile[] } | null;
  if (!meta?.metadata || !Array.isArray(meta.files)) {
    throw new OpenMediaError('OPEN_MEDIA_NOT_FOUND', 'No such item on the Internet Archive: use the id from an assets_search result');
  }
  const collections = ([] as unknown[]).concat(meta.metadata.collection ?? []).map(String);
  if (!collections.some((c) => (ARCHIVE_COLLECTIONS as readonly string[]).includes(c))) {
    throw new OpenMediaError(
      'OPEN_MEDIA_LICENSE_UNVERIFIED',
      `This item is not in a curated public-domain collection (${ARCHIVE_COLLECTIONS.join(', ')}), so its license cannot be verified; not downloading`,
    );
  }
  const candidate = archiveCandidate(meta.metadata, kind);
  if (!candidate) throw new OpenMediaError('OPEN_MEDIA_NOT_FOUND', 'Invalid item identifier');
  const order = kind === 'video' ? ARCHIVE_VIDEO_FORMATS : kind === 'audio' ? ARCHIVE_AUDIO_FORMATS : ARCHIVE_IMAGE_FORMATS;
  const files = meta.files.filter((f) => f.name && !f.name.includes('/') && !f.name.startsWith('__'));
  let pick: ArchiveFile | undefined;
  if (wanted !== undefined) {
    pick = files.find((f) => f.name === wanted);
    if (!pick)
      throw new OpenMediaError('OPEN_MEDIA_NOT_FOUND', `The item has no file named ${wanted}`, {
        files: files.map((f) => f.name).slice(0, 40),
      });
  } else {
    const usable = files
      .map((f) => ({ f, rank: order.indexOf((f.format ?? '').toLowerCase()) }))
      .filter(({ f, rank }) => rank >= 0 && (kind !== 'video' || Number(f.height ?? 0) <= limits.maxHeight || !f.height));
    usable.sort((a, b) => a.rank - b.rank || Number(b.f.height ?? 0) - Number(a.f.height ?? 0));
    pick = usable[0]?.f;
    if (!pick)
      throw new OpenMediaError('OPEN_MEDIA_UNSUPPORTED', `The item has no importable ${kind} file`, {
        files: files.map((f) => ({ name: f.name, format: f.format })).slice(0, 40),
      });
  }
  const name = pick.name!;
  const width = Number(pick.width) || null;
  const height = Number(pick.height) || null;
  return {
    candidate: {
      ...candidate,
      width: kind === 'audio' ? null : width,
      height: kind === 'audio' ? null : height,
      durationSeconds: Number(pick.length) ? round(Number(pick.length)) : null,
      byteLength: Number(pick.size) || null,
    },
    url: `https://archive.org/download/${encodeURIComponent(candidate.id)}/${name.split('/').map(encodeURIComponent).join('/')}`,
    extension: extensionOf(name, kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'jpg'),
    byteLength: Number(pick.size) || null,
    variant: pick.format ?? null,
  };
}

// ---- 小工具 ----

/** HTML 片段 → 纯文本（Commons 的作者与出处是带链接的 HTML）。 */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 去掉 Commons 给链接加的 `utm_*` 参数。 */
export function stripTracking(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) if (key.startsWith('utm_')) parsed.searchParams.delete(key);
    return parsed.toString();
  } catch {
    return url;
  }
}

function extensionOf(url: string, fallback: string): string {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // 本身就是文件名
  }
  const match = /\.([A-Za-z0-9]{2,5})$/.exec(decodeURIComponent(pathname));
  return match ? match[1]!.toLowerCase() : fallback;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// ---- YouTube（经 yt-dlp） ----

/** YouTube 的知识共享只有这一种：CC BY 3.0。 */
const YOUTUBE_CC = classifyLicense('CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/legalcode');

/** 许可没写：版权归上传者，用前由用户决定。 */
export const UNSTATED_LICENSE: LicenseInfo = {
  name: 'not stated (copyright belongs to the uploader)',
  url: null,
  class: 'unknown',
  attribution: true,
  shareAlike: false,
  nonCommercial: false,
  noDerivatives: false,
};

/**
 * `yt-dlp --flat-playlist --dump-single-json` 的检索结果 → 候选。`creativeCommons` 时结果页筛过知识共享，许可记为 CC BY 3.0；
 * 否则许可没写（`UNSTATED_LICENSE`）。直播与没有视频 id 的条目不收；尺寸与大小在 flat 结果里没有。
 */
export function parseYoutubeSearch(body: unknown, creativeCommons: boolean): OpenMediaCandidate[] {
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return [];
  const out: OpenMediaCandidate[] = [];
  for (const raw of entries) {
    const e = raw as Record<string, unknown>;
    const id = typeof e.id === 'string' && /^[\w-]{6,20}$/.test(e.id) ? e.id : null;
    if (!id || (typeof e.live_status === 'string' && e.live_status !== 'not_live' && e.live_status !== 'was_live')) continue;
    const title = typeof e.title === 'string' && e.title.trim() ? e.title.trim() : id;
    const author = typeof e.channel === 'string' ? e.channel : typeof e.uploader === 'string' ? e.uploader : null;
    const pageUrl = `https://www.youtube.com/watch?v=${id}`;
    const license = creativeCommons ? YOUTUBE_CC : UNSTATED_LICENSE;
    const thumbs = Array.isArray(e.thumbnails) ? (e.thumbnails as Array<{ url?: unknown; width?: unknown }>) : [];
    const thumb = thumbs.filter((t) => typeof t.url === 'string').sort((a, b) => Number(a.width ?? 0) - Number(b.width ?? 0))[0];
    out.push({
      source: 'youtube',
      id,
      title,
      kind: 'video',
      mediaType: null,
      width: null,
      height: null,
      durationSeconds: typeof e.duration === 'number' ? round(e.duration) : null,
      byteLength: null,
      author,
      license,
      attribution: attributionLine({ title, author, license, source: 'youtube', pageUrl }),
      pageUrl,
      thumbnailUrl: thumb ? String(thumb.url) : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      year: null,
      downloadWith: 'download',
    });
  }
  return out;
}
