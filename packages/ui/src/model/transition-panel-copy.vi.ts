import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const vi: TransitionPanelMessages = {
  slot: { in: 'Vào', out: 'Ra' },
  choice: {
    none: 'Không',
    dissolve: 'Hòa tan',
    wipe: 'Quét',
    slide: 'Trượt vào',
    zoom: 'Thu phóng',
    'dip-to-color': 'Chuyển qua màu',
    push: 'Đẩy',
  },
  direction: { right: 'Phải', left: 'Trái', down: 'Xuống', up: 'Lên' },
  easing: { linear: 'Tuyến tính', 'ease-in': 'Chậm vào', 'ease-out': 'Chậm ra', 'ease-in-out': 'Chậm vào và ra' },
};
