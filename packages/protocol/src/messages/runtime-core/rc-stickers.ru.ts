import type { RcStickersMessages } from './rc-stickers.ts';

export const ru: RcStickersMessages = {
  stickerNotFound: (p) => `Стикер не найден: ${p.id}`,
  stickersMissing: 'В этой копии BaoCut нет встроенных стикеров',
  addStickerLabel: (p) => `Добавить стикер «${p.name}»`,
};
