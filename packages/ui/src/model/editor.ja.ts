import type { EditorMessages } from './editor.ts';

export const ja: EditorMessages = {
  trackKind: { visual: '映像', audio: '音声', subtitle: '字幕' },
  counter: 'カウンター',
  text: 'テキスト',
  shape: '図形',
  composition: 'コンポジション',
  caption: '字幕',
  asset: '素材',
  elements: {
    sticker: 'ステッカー',
    placeholder: 'プレースホルダ',
    whiteboard: 'ホワイトボード',
    progress: 'プログレスバー',
    visualizer: '波形',
    confetti: '紙吹雪',
    draw: '手描き',
  },
  seconds: (value: string) => `${value} 秒`,
};
