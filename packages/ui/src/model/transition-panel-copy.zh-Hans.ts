import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const zhHans: TransitionPanelMessages = {
  slot: { in: '进入', out: '离开' },
  choice: {
    none: '无',
    dissolve: '叠化',
    wipe: '擦除',
    slide: '滑入',
    zoom: '缩放',
    'dip-to-color': '叠色',
    push: '推入',
  },
  direction: { right: '向右', left: '向左', down: '向下', up: '向上' },
  easing: { linear: '匀速', 'ease-in': '缓入', 'ease-out': '缓出', 'ease-in-out': '缓入缓出' },
};
