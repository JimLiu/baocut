import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const zhHans: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `元素 ${p.element} 的起点词锚解析不出来，已跳过`,
  sourceSkipped: (p) => `预览跳过了媒体源 ${p.source} 及用到它的元素：${p.detail}`,
  stickerAssetNoSource: (p) => `素材贴纸 ${p.element} 缺少 srcId：要把它登记进时间线的源（模板贴纸改用 source=template 加 templateId）`,
  missingFont: (p) => `字体 "${p.family}" 在当前字体库中不可用，将使用 ${p.fallback} 代替`,
  stickerRecolorFailed: (p) => `贴纸源 ${p.source} 换不了色，按原色画：${p.detail}`,
};
