import type { EditorMessages } from './editor.ts';

export const ko: EditorMessages = {
  trackKind: { visual: '화면', audio: '오디오', subtitle: '자막' },
  counter: '카운터',
  text: '텍스트',
  shape: '도형',
  composition: '컴포지션',
  caption: '자막',
  asset: '소재',
  elements: {
    sticker: '스티커',
    placeholder: '자리 표시자',
    whiteboard: '화이트보드',
    progress: '진행 표시줄',
    visualizer: '파형',
    confetti: '색종이',
    draw: '드로잉',
  },
  seconds: (value: string) => `${value}초`,
};
