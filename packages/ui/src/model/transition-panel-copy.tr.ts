import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const tr: TransitionPanelMessages = {
  slot: { in: 'Giriş', out: 'Çıkış' },
  choice: {
    none: 'Yok',
    dissolve: 'Çözülme',
    wipe: 'Silme',
    slide: 'Kayarak giriş',
    zoom: 'Yakınlaştırma',
    'dip-to-color': 'Renge geçiş',
    push: 'İtme',
  },
  direction: { right: 'Sağa', left: 'Sola', down: 'Aşağı', up: 'Yukarı' },
  easing: { linear: 'Doğrusal', 'ease-in': 'Yavaş giriş', 'ease-out': 'Yavaş çıkış', 'ease-in-out': 'Yavaş giriş ve çıkış' },
};
