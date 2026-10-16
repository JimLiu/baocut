import {
  ANIMATED_STICKER_PACKS,
  STICKER_PACKS,
  packStickers,
  type AssetRecord,
  type PackSticker,
  type StickerPack,
} from '@baocut/protocol';
import type { VisualLayer } from './new-items.ts';
import { placeBox } from './new-items.ts';
import { STICKER_PACK_COPY as SP } from './sticker-pack-copy.ts';

/** 贴纸页 chip 上直接摆的包（设计稿 `STICKER_CHIPS`）；其余的进「⋯」。 */
export const CHIP_PACKS: readonly string[] = ['featured', 'emoji'];
/** CTA 弹窗：贴纸包里的一个，目录页单独摆一段。 */
export const CTA_PACK = 'cta';
/** 目录页每一段摆几格。 */
export const PACK_PEEK = 4;

export const packLabel = (pack: StickerPack): string => SP.packs[pack.key] ?? pack.key;
/** 一张贴纸的名字：包名加序号（`精选 3`），用作新建那一层的名字与格子的提示。 */
export const packStickerName = (sticker: PackSticker): string => `${packLabel(sticker.pack)} ${sticker.index + 1}`;

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

/** 贴纸拷进视频后新建的那一层：居中、宽 18%（与品牌库的 Lottie 一样）；Lottie 循环播放，SVG 静止。 */
export function packStickerLayer(sticker: PackSticker, asset: AssetRecord): VisualLayer {
  return {
    type: 'sticker',
    name: packStickerName(sticker),
    place: placeBox({ x: 50, y: 50, w: 18 }),
    assetRef: { id: asset.id, revision: asset.currentRevision },
    sticker: sticker.animated ? { source: 'asset', loop: 'loop' } : { source: 'asset' },
  };
}
