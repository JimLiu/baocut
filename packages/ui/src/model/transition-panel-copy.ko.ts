import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const ko: TransitionPanelMessages = {
  slot: { in: '인', out: '아웃' },
  choice: {
    none: '없음',
    dissolve: '디졸브',
    wipe: '와이프',
    slide: '슬라이드 인',
    zoom: '줌',
    'dip-to-color': '색으로 물들이기',
    push: '밀어내기',
  },
  direction: { right: '오른쪽', left: '왼쪽', down: '아래', up: '위' },
  easing: { linear: '선형', 'ease-in': '이즈 인', 'ease-out': '이즈 아웃', 'ease-in-out': '이즈 인아웃' },
};
