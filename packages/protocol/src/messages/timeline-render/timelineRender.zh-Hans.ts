import type { TimelineRenderMessages } from './timelineRender.ts';

export const zhHans: TimelineRenderMessages = {
  shapeUnknown: (p) => `元素 ${p.element} 用的形状「${p.shape}」没有登记，已跳过`,
  shapeInvisible: (p) => `元素 ${p.element} 的形状「${p.shape}」既没有填充也没有描边，画不出东西`,
  stickerTemplateMissing: (p) => `元素 ${p.element} 是模板贴纸，但没有 templateId，已跳过`,
  stickerTemplateUnknown: (p) => `元素 ${p.element} 用的贴纸模板「${p.template}」没有登记，已跳过`,
  visualizerStyleUnknown: (p) => `元素 ${p.element} 用的波形样式「${p.style}」没有登记，已跳过`,
  spectrumNotInjected: (p) => `元素 ${p.element} 没有频谱轨，画了占位块`,
  spectrumEmpty: (p) => `元素 ${p.element} 的频谱轨是空的，画了占位块`,
  progressStyleUnknown: (p) => `元素 ${p.element} 用的进度样式「${p.style}」没有登记，已跳过`,
  confettiStyleUnknown: (p) => `元素 ${p.element} 用的彩纸样式「${p.style}」没有登记，已跳过`,
  spectrumUnavailable: (p) => `元素 ${p.element} 的 ${p.kind} 样式「${p.style}」没有频谱数据，画了占位块`,
  textureNoSource: (p) => `元素 ${p.element} 的外部纹理缺少 srcId`,
  textureSizeInvalid: (p) => `元素 ${p.element} 的外部纹理尺寸不对（${p.width}×${p.height}）`,
  mediaBoxInvalid: (p) => `元素 ${p.element} 的媒体盒尺寸不对`,
  effectsOffGpu: (p) => `元素 ${p.element} 的媒体效果进不了 GPU 纹理场景（${p.detail}），改由共享的 CPU 效果栈画`,
  cornerRadiiOffGpu: (p) => `元素 ${p.element} 的四角独立圆角还进不了 GPU 纹理场景，改由共享的 CPU 效果栈画`,
  tileNodesOverLimit: (p) => `元素 ${p.element} 的平铺媒体要 ${p.count} 个纹理节点，超过实时上限 ${p.limit}，改由宿主画`,
};
