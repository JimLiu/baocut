import type { RcStickersMessages } from './rc-stickers.ts';

export const nl: RcStickersMessages = {
  stickerNotFound: (p) => `Sticker niet gevonden: ${p.id}`,
  stickersMissing: 'Deze BaoCut-installatie bevat de meegeleverde stickers niet',
  petNotFound: (p) => `Codex Pet niet gevonden: ${p.id}`,
  onlineAssetUnavailable: (p) => `Deze sticker kon niet worden gedownload. Controleer de internetverbinding en probeer het opnieuw (${p.reason})`,
  addStickerLabel: (p) => `Sticker ‘${p.name}’ toevoegen`,
};
