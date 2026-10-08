import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const ja: TransitionPanelMessages = {
  slot: { in: 'イン', out: 'アウト' },
  choice: {
    none: 'なし',
    dissolve: 'ディゾルブ',
    wipe: 'ワイプ',
    slide: 'スライドイン',
    zoom: 'ズーム',
    'dip-to-color': 'カラーディップ',
    push: 'プッシュ',
  },
  direction: { right: '右へ', left: '左へ', down: '下へ', up: '上へ' },
  easing: { linear: 'リニア', 'ease-in': 'イーズイン', 'ease-out': 'イーズアウト', 'ease-in-out': 'イーズインアウト' },
};
