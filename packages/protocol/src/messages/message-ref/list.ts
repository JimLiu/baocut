import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './list.zh-Hans.ts';
import { zhHant } from './list.zh-Hant.ts';
import { ja } from './list.ja.ts';
import { ko } from './list.ko.ts';
import { es } from './list.es.ts';
import { fr } from './list.fr.ts';
import { de } from './list.de.ts';
import { nl } from './list.nl.ts';
import { ptBR } from './list.pt-BR.ts';
import { it } from './list.it.ts';
import { ru } from './list.ru.ts';
import { pl } from './list.pl.ts';
import { tr } from './list.tr.ts';
import { vi } from './list.vi.ts';

/** 参数是标量，或嵌套的引用（展开之后的文字）。 */
type P<K extends string> = Record<K, string | number>;

/**
 * `crates/message-ref` 的通用拼接（`message_ref::join`）。
 * 英文条目与 Rust `msg!` 的模板一字不差（`tools/rust-messages.test.ts` 核对）；改英文要两边一起改，键发布后不改名、不复用。
 */
const en = {
  join: (p: P<'head' | 'tail'>) => `${p.head}; ${p.tail}`,
};

export type ListMessages = typeof en;

export const listMessages = defineCatalog('list', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
