import type { TimelineRenderMessages } from './timelineRender.ts';

export const zhHant: TimelineRenderMessages = {
  shapeUnknown: (p) => `元素 ${p.element} 使用的形狀「${p.shape}」未登記，已略過`,
  shapeInvisible: (p) => `元素 ${p.element} 的形狀「${p.shape}」既沒有填色也沒有描邊，畫不出東西`,
  stickerTemplateMissing: (p) => `元素 ${p.element} 是範本貼圖，但沒有 templateId，已略過`,
  stickerTemplateUnknown: (p) => `元素 ${p.element} 使用的貼圖範本「${p.template}」未登記，已略過`,
  visualizerStyleUnknown: (p) => `元素 ${p.element} 使用的波形樣式「${p.style}」未登記，已略過`,
  spectrumNotInjected: (p) => `元素 ${p.element} 沒有頻譜軌，改畫佔位塊`,
  spectrumEmpty: (p) => `元素 ${p.element} 的頻譜軌是空的，改畫佔位塊`,
  progressStyleUnknown: (p) => `元素 ${p.element} 使用的進度樣式「${p.style}」未登記，已略過`,
  confettiStyleUnknown: (p) => `元素 ${p.element} 使用的彩紙樣式「${p.style}」未登記，已略過`,
  spectrumUnavailable: (p) => `元素 ${p.element} 的 ${p.kind} 樣式「${p.style}」沒有頻譜資料，改畫佔位塊`,
  textureNoSource: (p) => `元素 ${p.element} 的外部紋理缺少 srcId`,
  textureSizeInvalid: (p) => `元素 ${p.element} 的外部紋理尺寸不正確（${p.width}×${p.height}）`,
  mediaBoxInvalid: (p) => `元素 ${p.element} 的媒體框尺寸不正確`,
  effectsOffGpu: (p) => `元素 ${p.element} 的媒體效果無法進入 GPU 紋理場景（${p.detail}），改由共用的 CPU 效果堆疊繪製`,
  cornerRadiiOffGpu: (p) => `元素 ${p.element} 的四角獨立圓角尚無法進入 GPU 紋理場景，改由共用的 CPU 效果堆疊繪製`,
  tileNodesOverLimit: (p) => `元素 ${p.element} 的平鋪媒體需要 ${p.count} 個紋理節點，超過即時上限 ${p.limit}，改由主機繪製`,
};
