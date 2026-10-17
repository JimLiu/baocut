import type { RcStickersMessages } from './rc-stickers.ts';

export const pl: RcStickersMessages = {
  stickerNotFound: (p) => `Nie znaleziono naklejki: ${p.id}`,
  stickersMissing: 'Ta kopia BaoCut nie zawiera wbudowanych naklejek',
  petNotFound: (p) => `Nie znaleziono Codex Pet: ${p.id}`,
  onlineAssetUnavailable: (p) => `Nie udało się pobrać tej naklejki. Sprawdź połączenie z internetem i spróbuj ponownie (${p.reason})`,
  addStickerLabel: (p) => `Dodaj naklejkę „${p.name}”`,
};
