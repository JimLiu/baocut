import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const zhHant: TransitionPanelMessages = {
  slot: { in: '入場', out: '出場' },
  choice: {
    none: '無',
    dissolve: '疊化',
    wipe: '擦除',
    slide: '滑入',
    zoom: '縮放',
    'dip-to-color': '漸變為顏色',
    push: '推入',
  },
  direction: { right: '向右', left: '向左', down: '向下', up: '向上' },
  easing: { linear: '線性', 'ease-in': '緩入', 'ease-out': '緩出', 'ease-in-out': '緩入緩出' },
};
