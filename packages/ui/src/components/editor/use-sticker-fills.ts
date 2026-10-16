import { useEffect, useState } from 'react';
import type { AssetRecord, VersionRef } from '@baocut/protocol';
import { stickerFillColors } from '../../model/sticker-fills.ts';
import { useRuntime } from '../../runtime/context.tsx';

const NONE: readonly string[] = [];

/** 素材的色卡按种类解：SVG 一种，Lottie 一种（素材缓存按解码器名字分开记）。 */
const decoders = {
  svg: { name: 'fills:svg', decode: async (response: Response) => stickerFillColors('image/svg+xml', await response.text()) },
  lottie: { name: 'fills:lottie', decode: async (response: Response) => stickerFillColors('application/json', await response.text()) },
};

function decoderOf(ref: VersionRef | undefined, assets: Record<string, AssetRecord>) {
  const asset = ref ? assets[ref.id] : undefined;
  if (!asset || !ref) return null;
  if (asset.kind === 'lottie') return decoders.lottie;
  return asset.revisions[ref.revision]?.mediaType === 'image/svg+xml' ? decoders.svg : null;
}

/**
 * 素材贴纸的色卡（属性页「颜色」那一节）：经当前视频的素材缓存读一次素材，读出能整体换掉的那几种颜色。
 * 位图、GIF 与视频素材没有；读好之前、读不到时也是空的。
 */
export function useStickerFills(ref: VersionRef | undefined, assets: Record<string, AssetRecord>): readonly string[] {
  const cache = useRuntime().videos.assets;
  const decoder = decoderOf(ref, assets);
  const [, redraw] = useState(0);
  useEffect(() => (decoder ? cache.subscribe(() => redraw((n) => n + 1)) : undefined), [cache, decoder]);
  if (!decoder || !ref) return NONE;
  const state = cache.get(ref, decoder);
  return state.state === 'ready' ? state.value : NONE;
}
