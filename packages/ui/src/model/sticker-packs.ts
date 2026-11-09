import {
  ANIMATED_STICKER_PACKS,
  HOST_STICKER_PACK,
  STICKER_PACKS,
  packStickers,
  stickerHost,
  type BuiltinHost,
  type PackSticker,
  type StickerPack,
} from '@baocut/protocol';
import type { LayerAsset, VisualLayer } from './new-items.ts';
import { placeBox } from './new-items.ts';
import { STICKER_PACK_COPY as SP } from './sticker-pack-copy.ts';

/** 贴纸页 chip 上直接摆的包（设计稿 `STICKER_CHIPS`）；其余的进「⋯」。 */
export const CHIP_PACKS: readonly string[] = ['featured', 'emoji'];
/** CTA 弹窗：贴纸包里的一个，目录页单独摆一段。 */
export const CTA_PACK = 'cta';
/** 目录页每一段摆几格。 */
export const PACK_PEEK = 4;

export const packLabel = (pack: StickerPack): string => SP.packs[pack.key] ?? pack.key;
/** 一张贴纸的名字：包名加序号（`精选 3`），用作新建那一层的名字与格子的提示；内置主播是角色的名字。 */
export function packStickerName(sticker: PackSticker): string {
  const host = stickerHost(sticker);
  return host ? hostName(host) : `${packLabel(sticker.pack)} ${sticker.index + 1}`;
}

export const findPack = (key: string): StickerPack | undefined =>
  [...STICKER_PACKS, ...ANIMATED_STICKER_PACKS].find((pack) => pack.key === key);

/** 「⋯」里的包，按目录原序。 */
export const restPacks = (): StickerPack[] => STICKER_PACKS.filter((pack) => !CHIP_PACKS.includes(pack.key));

/** 搜索：包名（界面语言）与检索词（中英文）里有这个词，整包就留着。 */
export function matchPacks(packs: readonly StickerPack[], query: string): StickerPack[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...packs];
  return packs.filter((pack) => `${packLabel(pack)} ${pack.key} ${pack.tags}`.toLowerCase().includes(q));
}

/** 目录页那一屏（设计稿 `SK.head`）：各包轮流取第一张，不是取头一个包的前几张。 */
export function headStickers(packs: readonly StickerPack[], count: number): PackSticker[] {
  return packs
    .filter((pack) => pack.files.length > 0)
    .slice(0, count)
    .map((pack) => packStickers(pack)[0]!);
}

/**
 * 彩纸在动态贴纸里排第几（设计稿 `confettiAt`）：分类按分类键的字母序，彩纸（confetti）插在拼贴（collage）之后。
 * chip 的次序与子页里各段的次序用同一个判据。
 */
export function confettiAt(packs: readonly StickerPack[]): number {
  const at = packs.findIndex((pack) => pack.key.replace(/^dyn-/, '') > 'confetti');
  return at < 0 ? packs.length : at;
}

/**
 * 贴纸拷进视频后新建的那一层：居中、宽 18%（与品牌库的 Lottie 一样）；Lottie 循环播放，SVG 静止。内置主播落在右下角
 * （`hostPlace`），角色跟着自己的时钟做待机动作，不读播放方式。
 */
export function packStickerLayer(sticker: PackSticker, asset: LayerAsset, canvas: Size): VisualLayer {
  return {
    type: 'sticker',
    name: packStickerName(sticker),
    place: placeBox(sticker.host ? hostPlace(canvas) : { x: 50, y: 50, w: 18 }),
    ...asset,
    sticker: sticker.animated ? { source: 'asset', loop: 'loop' } : { source: 'asset' },
  };
}

// ---- 内置主播（元素面板「虚拟主播」一节） ----

type Size = { width: number; height: number };

/** 内置主播的角色画布都是 1024×1536：框的高是宽的 1.5 倍。 */
const HOST_ASPECT = 1.5;

/**
 * 主播放上去的惯用位（与 virtual-host skill 第 4 节的数一致）：右下角，右边留 1%；宽是横版画面的 30%、竖版的 50%、方形的
 * 40%；半身像的下沿压在画外约六分之一个身高，轻跳往上才有余地。16:9 约 `{84, 73.3, 30}`，9:16 约 `{74, 85.9, 50}`。
 */
export function hostPlace(canvas: Size): { x: number; y: number; w: number } {
  const w = canvas.width > canvas.height ? 30 : canvas.width < canvas.height ? 50 : 40;
  const h = ((w * canvas.width) / canvas.height) * HOST_ASPECT;
  return { x: 99 - w / 2, y: 100 - h / 3, w };
}
/** 主播落多长（秒）：与内置贴纸一样；要跟着旁白说话时，配口型的那一步按配音改长短。 */
export const HOST_SECONDS = 8;

export type HostStyle = BuiltinHost['style'];
/** 「虚拟主播」的二级分类（设计稿 `HOST_CATS`）：全部、动漫、Q 版。 */
export const HOST_STYLES: readonly HostStyle[] = ['anime', 'chibi'];

/** 角色在界面上的名字：中文界面是中文名，其余是英文名。 */
export const hostName = (host: BuiltinHost): string => SP.hostName(host);

/** 内置主播的全部角色包，次序同 `BUILTIN_HOSTS`。 */
export const hostStickers = (): PackSticker[] => packStickers(HOST_STICKER_PACK);

// i18n-ignore-start: 检索关键词，中英两种说法都收，与界面语言无关
const HOST_WORDS = '虚拟主播 主播 角色 host presenter avatar character vtuber';
// i18n-ignore-end

/**
 * 「虚拟主播」里摆哪些（设计稿 `HostSection`）：按画风筛，再按搜索词筛。词命中这一节（节名或泛称）就整节留着；否则看角色的
 * 名字（中英文）与画风。
 */
export function matchHosts(style: HostStyle | 'all', query: string): PackSticker[] {
  const q = query.trim().toLowerCase();
  const all = hostStickers().filter((sticker) => style === 'all' || stickerHost(sticker)!.style === style);
  if (!q || `${SP.hostTitle} ${HOST_WORDS}`.toLowerCase().includes(q)) return all;
  return all.filter((sticker) => {
    const host = stickerHost(sticker)!;
    return `${hostName(host)} ${host.name} ${host.zh} ${SP.hostStyles[host.style]} ${host.style}`.toLowerCase().includes(q);
  });
}
