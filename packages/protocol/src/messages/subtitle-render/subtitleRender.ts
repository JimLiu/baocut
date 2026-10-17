import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './subtitleRender.zh-Hans.ts';
import { zhHant } from './subtitleRender.zh-Hant.ts';
import { ja } from './subtitleRender.ja.ts';
import { ko } from './subtitleRender.ko.ts';
import { es } from './subtitleRender.es.ts';
import { fr } from './subtitleRender.fr.ts';
import { de } from './subtitleRender.de.ts';
import { nl } from './subtitleRender.nl.ts';
import { ptBR } from './subtitleRender.pt-BR.ts';
import { it } from './subtitleRender.it.ts';
import { ru } from './subtitleRender.ru.ts';
import { pl } from './subtitleRender.pl.ts';
import { tr } from './subtitleRender.tr.ts';
import { vi } from './subtitleRender.vi.ts';

/** 参数是标量。 */
type P<K extends string> = Record<K, string | number>;

/**
 * `crates/subtitle-render` 编计划与画元素时的提示（缺字体、媒体源、贴纸换色），经渲染提示（`EXPORT_RENDER_NOTE`）给用户看。
 * 英文条目与 Rust `msg!` 的模板一字不差（`tools/rust-messages.test.ts` 核对）；改英文要两边一起改，键发布后不改名、不复用。
 */
const en = {
  startAnchorUnresolved: (p: P<'element'>) => `The start anchor of element ${p.element} can’t be resolved; skipped`,
  sourceSkipped: (p: P<'source' | 'detail'>) => `Preview skipped media source ${p.source} and its elements: ${p.detail}`,
  stickerAssetNoSource: (p: P<'element'>) => `Asset sticker ${p.element} has no srcId; register it in the timeline sources (template stickers use source=template with a templateId)`,
  missingFont: (p: P<'family' | 'fallback'>) => `Font "${p.family}" isn’t in the font library; using ${p.fallback} instead`,
  stickerRecolorFailed: (p: P<'source' | 'detail'>) => `Sticker source ${p.source} couldn’t be recolored, so it’s drawn in its original colors: ${p.detail}`,
};

export type SubtitleRenderMessages = typeof en;

export const subtitleRenderMessages = defineCatalog('subtitleRender', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
