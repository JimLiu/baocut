import type { EditorMessages } from './editor.ts';

export const zhHans: EditorMessages = {
  trackKind: { visual: '画面', audio: '音频', subtitle: '字幕' },
  counter: '计数器',
  text: '文字',
  shape: '图形',
  composition: '合成',
  caption: '字幕',
  asset: '素材',
  /** 生成类元素在时间线上的名字（同旧版网页时间线：Lottie 也算贴纸，声波叫「波形」）。 */
  elements: {
    sticker: '贴纸',
    placeholder: '占位框',
    whiteboard: '白板',
    progress: '进度条',
    visualizer: '波形',
    confetti: '彩纸',
    draw: '手绘',
  },
  seconds: (value: string) => `${value} 秒`,
};
