import type { RcStickersMessages } from './rc-stickers.ts';

export const ru: RcStickersMessages = {
  stickerNotFound: (p) => `Стикер не найден: ${p.id}`,
  stickersMissing: 'В этой копии BaoCut нет встроенных стикеров',
  petNotFound: (p) => `Codex Pet не найден: ${p.id}`,
  onlineAssetUnavailable: (p) => `Не удалось скачать этот стикер. Проверьте подключение к интернету и попробуйте ещё раз (${p.reason})`,
  addStickerLabel: (p) => `Добавить стикер «${p.name}»`,
};
