import type { RcStickersMessages } from './rc-stickers.ts';

export const de: RcStickersMessages = {
  stickerNotFound: (p) => `Sticker nicht gefunden: ${p.id}`,
  stickersMissing: 'Diese BaoCut-Installation enthält die mitgelieferten Sticker nicht',
  petNotFound: (p) => `Codex Pet nicht gefunden: ${p.id}`,
  onlineAssetUnavailable: (p) => `Dieser Sticker konnte nicht heruntergeladen werden. Prüfe die Internetverbindung und versuche es erneut (${p.reason})`,
  addStickerLabel: (p) => `Sticker „${p.name}“ hinzufügen`,
};
