import { defineMessages, type AssetRecord, type BrandContent, type BrandKind, type BrandMediaKind, type DocumentRecord, type Id, type LibrarySource, type Sequence } from '@baocut/protocol';
import { placeBox, type VisualLayer } from './new-items.ts';
import { zhHans } from './library-brand.zh-Hans.ts';
import { zhHant } from './library-brand.zh-Hant.ts';
import { ja } from './library-brand.ja.ts';
import { ko } from './library-brand.ko.ts';
import { es } from './library-brand.es.ts';
import { fr } from './library-brand.fr.ts';
import { de } from './library-brand.de.ts';
import { nl } from './library-brand.nl.ts';
import { ptBR } from './library-brand.pt-BR.ts';
import { it } from './library-brand.it.ts';
import { ru } from './library-brand.ru.ts';
import { pl } from './library-brand.pl.ts';
import { tr } from './library-brand.tr.ts';
import { vi } from './library-brand.vi.ts';

/** 品牌库模型的文案（英文是键与类型的来源，译文在 `library-brand.zh-Hans.ts`）。 */
const en = {
  videoTitle: 'Videos',
  videoEmpty: 'No videos saved yet',
  videoHint: 'Intros, outros, transitions, and other video clips you use in every video.',
  imageTitle: 'Images',
  imageEmpty: 'No images saved yet',
  imageHint: 'Logos, QR codes, avatars, and other images you use often.',
  stickerTitle: 'Stickers',
  stickerEmpty: 'No stickers uploaded yet',
  stickerHint: 'Accepts images (PNG, WebP, GIF, JPG) and Lottie animations (.json or .lottie). The type is detected from the file contents, not the extension.',
  colorTitle: 'Brand colors',
  colorEmpty: 'No brand colors yet',
  colorHint: 'Brand colors appear in every color picker in the Inspector.',
  fontTitle: 'Brand fonts',
  fontEmpty: 'No brand fonts yet',
  fontHint: 'Accepts TTF, OTF, and WOFF2 (not WOFF). Adding one to a video copies it into the asset library.',
  captionStyleTitle: 'Subtitle styles',
  captionStyleEmpty: 'No subtitle styles saved yet',
  captionStyleHint: 'Save this video’s current subtitle style here and apply it to other videos in one click.',
  filterImages: 'Images',
  filterVideos: 'Videos',
  filterStickers: 'Images and Lottie animations',
  filterFonts: 'Fonts',
  untitled: 'Untitled',
  captionStyle: 'Subtitle style',
  lottie: 'Lottie animation',
  image: 'Image',
  noRevision: 'This asset has no usable version',
  embedded: 'This asset has already been copied into the video folder, so the original file isn’t available. Please add the original file from your computer.',
  styleEmpty: 'The subtitle style document is empty',
  styleNoSchema: 'The subtitle style document has no schema, so it can’t be saved to the brand kit',
  styleTooLarge: 'The subtitle style is larger than 64 KiB',
};
export type LibraryBrandMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 编辑器 › 品牌的纯模型（产品设计 §13.7，设计稿 designs/baocut/app/panel-brand.jsx）：品牌库里的视频、图片、贴纸、
 * 品牌色、字体与字幕样式。品牌库在 Runtime Home 里、跨视频复用（架构设计 §5.9）；放进视频时拷一份，
 * 之后库里的修改与删除不影响视频。模板（`overlayTemplate`）只保留种类，这里不做。
 */

export type BrandSectionKind = Exclude<BrandKind, 'overlayTemplate'>;

export interface BrandSection {
  kind: BrandSectionKind;
  title: string;
  empty: string;
  hint: string;
}

/** 各节的次序与说明（设计稿：视频、图片、贴纸、品牌色、品牌字体、字幕样式）。 */
export const BRAND_SECTIONS: readonly BrandSection[] = [
  {
    kind: 'video',
    get title() { return M.videoTitle; },
    get empty() { return M.videoEmpty; },
    get hint() { return M.videoHint; },
  },
  {
    kind: 'image',
    get title() { return M.imageTitle; },
    get empty() { return M.imageEmpty; },
    get hint() { return M.imageHint; },
  },
  {
    kind: 'sticker',
    get title() { return M.stickerTitle; },
    get empty() { return M.stickerEmpty; },
    get hint() { return M.stickerHint; },
  },
  {
    kind: 'color',
    get title() { return M.colorTitle; },
    get empty() { return M.colorEmpty; },
    get hint() { return M.colorHint; },
  },
  {
    kind: 'font',
    get title() { return M.fontTitle; },
    get empty() { return M.fontEmpty; },
    get hint() { return M.fontHint; },
  },
  {
    kind: 'captionStyle',
    get title() { return M.captionStyleTitle; },
    get empty() { return M.captionStyleEmpty; },
    get hint() { return M.captionStyleHint; },
  },
];

export const BRAND_MEDIA_KINDS: readonly BrandMediaKind[] = ['image', 'video', 'sticker', 'font'];

export function isBrandMediaKind(kind: string): kind is BrandMediaKind {
  return (BRAND_MEDIA_KINDS as readonly string[]).includes(kind);
}

/** 打开对话框里的文件类型（只是收窄候选；真正的类型由 Runtime 按内容判）。 */
export const BRAND_FILE_FILTERS: Record<BrandMediaKind, { name: string; extensions: string[] }[]> = {
  image: [{ get name() { return M.filterImages; }, extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  video: [{ get name() { return M.filterVideos; }, extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }],
  sticker: [{ get name() { return M.filterStickers; }, extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'json', 'lottie'] }],
  font: [{ get name() { return M.filterFonts; }, extensions: ['ttf', 'otf', 'woff2'] }],
};

/** 名字的上限（与 Runtime 一致）。 */
export const BRAND_NAME_MAX = 200;

/** 条目名去掉首尾空白，截到上限（按字符，不切开代理对）。 */
export function clipBrandName(name: string): string {
  return [...name.trim()].slice(0, BRAND_NAME_MAX).join('');
}

/** 本机文件的默认条目名：文件名去掉扩展名。 */
export function nameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const name = base.replace(/\.[^.]+$/, '').trim() || base.trim();
  return [...name].slice(0, BRAND_NAME_MAX).join('') || M.untitled;
}

/** 品牌色只收 `#RRGGBB` 或 `#RRGGBBAA`（Runtime 存成大写）。`#RGB` 展开成六位；不合法时 null。 */
export function normalizeColor(text: string): string | null {
  const raw = text.trim().replace(/^#/, '');
  const hex = /^[0-9a-f]{3}$/i.test(raw) ? [...raw].map((c) => c + c).join('') : raw;
  return /^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

/** 色值换成 CSS 能读的 `rgba()`：八位 hex 在一些取色控件里读不出不透明度。 */
export function colorCss(value: string): string {
  const hex = normalizeColor(value) ?? '#000000';
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const alpha = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 1000) / 1000})`;
}

/** Lottie 动画的媒体类型：bodymovin JSON 与 `.lottie` 压缩包（zip）。 */
const LOTTIE_MEDIA_TYPES: readonly string[] = ['application/json', 'application/zip'];

/** 贴纸是 Lottie 动画（不是图片）。 */
export function isLottieSticker(content: BrandContent): boolean {
  return content.kind === 'sticker' && LOTTIE_MEDIA_TYPES.includes(content.file.mediaType);
}

/**
 * 元素页里一张品牌库贴纸进哪一页（设计稿 `BC_STSRC.isDynamicPage`，两页互补、不重复）：Lottie 与 GIF 进「动态贴纸」
 * （预览与导出都按 GIF 自己的帧时间播放），其余图片进「贴纸」。
 */
export function isDynamicSticker(content: BrandContent): boolean {
  return isLottieSticker(content) || (content.kind === 'sticker' && content.file.mediaType === 'image/gif');
}

/**
 * 元素页搜索品牌库贴纸：名字，「我的贴纸」「品牌库」，以及它那一页的名字与种类词（与内置格按分节名命中同一口径：
 * 搜「贴纸」两页的都在）。
 */
export function stickerMatches(name: string, dynamic: boolean, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // i18n-ignore-start: 检索关键词，中英两种说法都收，与界面语言无关
  const words = dynamic ? '动态贴纸 lottie 动画 animation' : '贴纸 sticker 图片 image';
  return `${name}\n我的贴纸 品牌库 brand ${words}`.toLowerCase().includes(q);
  // i18n-ignore-end
}

/** 一条品牌条目的说明：贴纸写图片还是动画，文件写大小。 */
export function brandMeta(content: BrandContent): string {
  if (content.kind === 'color') return content.value;
  if (content.kind === 'captionStyle') return M.captionStyle;
  const size = formatSize(content.file.byteLength);
  if (content.kind === 'sticker') return `${isLottieSticker(content) ? M.lottie : M.image} · ${size}`;
  return size;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// ---- 从这个视频的素材存进品牌库 ----

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/** 生成的素材在来源里记着产物 ID（`provenance.source.artifactId`）。 */
function artifactIdOf(source: unknown): string | null {
  const id = source && typeof source === 'object' ? (source as { artifactId?: unknown }).artifactId : undefined;
  return typeof id === 'string' && id.trim() ? id : null;
}

/**
 * 素材的文件从哪里来：生成的素材用产物库里的那一份，链接的素材用登记的绝对路径。
 * 导入时已经复制进视频目录的素材，Runtime 不给出它在磁盘上的位置，这时说明原因，让用户改从本机文件添加。
 */
export function assetLibrarySource(asset: AssetRecord): { source: LibrarySource } | { reason: string } {
  const revision = asset.revisions[asset.currentRevision];
  if (!revision) return { reason: M.noRevision };
  const artifactId = artifactIdOf(revision.provenance.source);
  if (artifactId) return { source: { artifactId } };
  if (revision.storage.mode === 'linked' && isAbsolutePath(revision.storage.locator.path)) {
    return { source: { path: revision.storage.locator.path } };
  }
  return { reason: M.embedded };
}

/**
 * 素材在品牌库里算哪一类；不能存的（音频、文档等）返回 null。Lottie 动画素材算贴纸；早先把 Lottie 记成 `other` 的 JSON
 * 素材也算（存进库时 Runtime 再按内容认）。
 */
export function brandKindForAsset(asset: AssetRecord): BrandMediaKind | null {
  if (asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'font') return asset.kind;
  if (asset.kind === 'lottie') return 'sticker';
  const revision = asset.revisions[asset.currentRevision];
  return revision?.mediaType === 'application/json' ? 'sticker' : null;
}

export interface BrandCandidate {
  asset: AssetRecord;
  source: LibrarySource | null;
  /** 存不进来的原因。 */
  reason: string | null;
}

/** 这个视频里能存进某一节的素材（贴纸一节收图片与 Lottie）。按名字排。 */
export function brandCandidates(assets: Record<Id, AssetRecord>, kind: BrandMediaKind): BrandCandidate[] {
  return Object.values(assets)
    .filter((asset) => {
      const own = brandKindForAsset(asset);
      return kind === 'sticker' ? own === 'sticker' || own === 'image' : own === kind;
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((asset) => {
      const found = assetLibrarySource(asset);
      return 'source' in found ? { asset, source: found.source, reason: null } : { asset, source: null, reason: found.reason };
    });
}

// ---- 拷进视频之后怎么放 ----

/**
 * 拷进视频的素材放到哪里：图片、视频与图片贴纸放到播放头处的时间线上；Lottie 贴纸用内置的 Lottie 播放器；
 * 字体只进素材库（文字的字体框还不能选素材里的字体）。
 */
export type BrandPlacement = 'asset' | 'lottie' | 'import-only';

export function brandPlacement(content: BrandContent): BrandPlacement {
  if (content.kind === 'image' || content.kind === 'video') return 'asset';
  if (content.kind === 'sticker') return isLottieSticker(content) ? 'lottie' : 'asset';
  return 'import-only';
}

/**
 * Lottie 贴纸的一层画面：素材贴纸指向素材的当前版本，循环播放；宽 18%，高按动画的宽高比，放在画面中央。
 */
export function lottieLayer(name: string, asset: AssetRecord, _canvas: { width: number; height: number }): VisualLayer {
  return {
    type: 'sticker',
    name,
    place: placeBox({ x: 50, y: 50, w: 18 }),
    assetRef: { id: asset.id, revision: asset.currentRevision },
    sticker: { source: 'asset', loop: 'loop' },
  };
}

/** Lottie 贴纸落多长（秒）：与内置贴纸一样。 */
export const LOTTIE_SECONDS = 3;

// ---- 字幕样式 ----

/** 字幕样式正文的上限（与 Runtime 一致）。 */
export const CAPTION_STYLE_MAX_BYTES = 64 * 1024;

/** 字幕样式正文能不能存进品牌库：要是带字符串 `schema` 的对象，不超过 64 KiB。 */
export function captionStyleProblem(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return M.styleEmpty;
  if (typeof (body as { schema?: unknown }).schema !== 'string') return M.styleNoSchema;
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > CAPTION_STYLE_MAX_BYTES) return M.styleTooLarge;
  return null;
}

export interface CaptionStyleCandidate {
  documentId: Id;
  name: string;
  /** 用这份样式的字幕实例数。 */
  uses: number;
}

/** 「存当前样式」能存的：序列上字幕实例在用的样式文档，用的多的在前，一样多按名字。 */
export function captionStyleCandidates(sequence: Sequence, documents: Record<Id, DocumentRecord>): CaptionStyleCandidate[] {
  const uses = new Map<Id, number>();
  for (const item of sequence.items) {
    if (item.type !== 'caption' || !item.styleDocumentId) continue;
    if (documents[item.styleDocumentId]?.kind !== 'caption-style') continue;
    uses.set(item.styleDocumentId, (uses.get(item.styleDocumentId) ?? 0) + 1);
  }
  return [...uses]
    .map(([documentId, n]) => ({ documentId, name: documents[documentId]!.name, uses: n }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name) || a.documentId.localeCompare(b.documentId));
}

/** 套用字幕样式时改哪些字幕：序列上的字幕实例，跳过锁住的实例与锁住的轨道上的。 */
export function captionStyleTargets(sequence: Sequence): Id[] {
  const locked = new Set(sequence.tracks.filter((track) => track.locked).map((track) => track.id));
  return sequence.items.filter((item) => item.type === 'caption' && !item.locked && !locked.has(item.trackId)).map((item) => item.id);
}
