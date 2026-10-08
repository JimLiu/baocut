import type { GeometryPanelMessages } from './geometry-panel.ts';

export const ko: GeometryPanelMessages = {
  x: { left: '왼쪽에서', center: '가로 오프셋', right: '오른쪽에서' },
  y: { top: '위에서', middle: '세로 오프셋', bottom: '아래에서' },
  pins: {
    'left top': '왼쪽 위 모서리',
    'center top': '위쪽 가장자리 가운데',
    'right top': '오른쪽 위 모서리',
    'left middle': '왼쪽 가장자리 가운데',
    'center middle': '가운데',
    'right middle': '오른쪽 가장자리 가운데',
    'left bottom': '왼쪽 아래 모서리',
    'center bottom': '아래쪽 가장자리 가운데',
    'right bottom': '오른쪽 아래 모서리',
  },
};
