import type { RcStickersMessages } from './rc-stickers.ts';

export const es: RcStickersMessages = {
  stickerNotFound: (p) => `No se encontró el sticker: ${p.id}`,
  stickersMissing: 'Esta copia de BaoCut no incluye los stickers integrados',
  petNotFound: (p) => `No se encontró la Codex Pet: ${p.id}`,
  onlineAssetUnavailable: (p) => `No se pudo descargar este sticker. Comprueba la conexión a internet y vuelve a intentarlo (${p.reason})`,
  addStickerLabel: (p) => `Añadir el sticker «${p.name}»`,
};
