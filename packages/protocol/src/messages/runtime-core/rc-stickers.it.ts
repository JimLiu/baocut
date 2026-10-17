import type { RcStickersMessages } from './rc-stickers.ts';

export const it: RcStickersMessages = {
  stickerNotFound: (p) => `Sticker non trovato: ${p.id}`,
  stickersMissing: 'Questa copia di BaoCut non include gli sticker integrati',
  petNotFound: (p) => `Codex Pet non trovato: ${p.id}`,
  onlineAssetUnavailable: (p) => `Impossibile scaricare questo sticker. Controlla la connessione a internet e riprova (${p.reason})`,
  addStickerLabel: (p) => `Aggiungi lo sticker «${p.name}»`,
};
