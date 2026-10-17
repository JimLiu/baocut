import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const zhHant: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `元素 ${p.element} 的起點字詞錨點無法解析，已略過`,
  sourceSkipped: (p) => `預覽略過了媒體來源 ${p.source} 及使用它的元素：${p.detail}`,
  stickerAssetNoSource: (p) => `素材貼圖 ${p.element} 缺少 srcId：請將它登記到時間軸的來源（範本貼圖改用 source=template 加 templateId）`,
  missingFont: (p) => `字型「${p.family}」不在目前的字型庫中，改用 ${p.fallback}`,
  stickerRecolorFailed: (p) => `貼圖來源 ${p.source} 無法換色，按原色繪製：${p.detail}`,
};
