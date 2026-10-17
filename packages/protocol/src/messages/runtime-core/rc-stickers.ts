import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-stickers.zh-Hans.ts';
import { zhHant } from './rc-stickers.zh-Hant.ts';
import { ja } from './rc-stickers.ja.ts';
import { ko } from './rc-stickers.ko.ts';
import { es } from './rc-stickers.es.ts';
import { fr } from './rc-stickers.fr.ts';
import { de } from './rc-stickers.de.ts';
import { nl } from './rc-stickers.nl.ts';
import { ptBR } from './rc-stickers.pt-BR.ts';
import { it } from './rc-stickers.it.ts';
import { ru } from './rc-stickers.ru.ts';
import { pl } from './rc-stickers.pl.ts';
import { tr } from './rc-stickers.tr.ts';
import { vi } from './rc-stickers.vi.ts';

/** 随包贴纸与 Codex Pets（元素面板）的错误与编辑标签。英文是键与类型的来源，译文在 `rc-stickers.<语言>.ts`。 */
const en = {
  stickerNotFound: (p: { id: string }) => `Sticker not found: ${p.id}`,
  stickersMissing: "This copy of BaoCut doesn't include the bundled stickers",
  petNotFound: (p: { id: string }) => `Codex Pet not found: ${p.id}`,
  onlineAssetUnavailable: (p: { reason: string }) => `Couldn't download this sticker. Check your internet connection and try again (${p.reason})`,
  addStickerLabel: (p: { name: string }) => `Add sticker "${p.name}"`,
};

export type RcStickersMessages = typeof en;

export const RcStickers = defineCatalog('rcStickers', en, {
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  ja,
  ko,
  es,
  fr,
  de,
  nl,
  'pt-BR': ptBR,
  it,
  ru,
  pl,
  tr,
  vi,
});
