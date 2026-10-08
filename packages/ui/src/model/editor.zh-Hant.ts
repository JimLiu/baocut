import type { EditorMessages } from './editor.ts';

export const zhHant: EditorMessages = {
  trackKind: { visual: '畫面', audio: '音訊', subtitle: '字幕' },
  counter: '計數器',
  text: '文字',
  shape: '形狀',
  composition: '合成',
  caption: '字幕',
  asset: '素材',
  elements: {
    sticker: '貼紙',
    placeholder: '預留位置',
    whiteboard: '白板',
    progress: '進度列',
    visualizer: '波形',
    confetti: '彩紙',
    draw: '手繪',
  },
  seconds: (value: string) => `${value} 秒`,
};
