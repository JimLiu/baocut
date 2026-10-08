import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './time.zh-Hans.ts';
import { zhHant } from './time.zh-Hant.ts';
import { ja } from './time.ja.ts';
import { ko } from './time.ko.ts';
import { es } from './time.es.ts';
import { fr } from './time.fr.ts';
import { de } from './time.de.ts';
import { nl } from './time.nl.ts';
import { ptBR } from './time.pt-BR.ts';
import { it } from './time.it.ts';
import { ru } from './time.ru.ts';
import { pl } from './time.pl.ts';
import { tr } from './time.tr.ts';
import { vi } from './time.vi.ts';

/** 参数是标量，或嵌套的引用（展开之后的文字）。 */
type P<K extends string> = Record<K, string | number>;

/**
 * `crates/editor-semantics` 的时间输入错误（经引擎错误的参数带出）。
 * 英文条目与 Rust `msg!` 的模板一字不差（`tools/rust-messages.test.ts` 核对）；改英文要两边一起改，键发布后不改名、不复用。
 */
const en = {
  rateNotPositive: 'Frame rate numerator and denominator must be positive',
  rateNotReduced: 'Frame rate must be in lowest terms',
  timescaleNotPositive: 'timescale must be greater than 0',
  notInteger: (p: P<'text'>) => `Not a decimal integer: "${p.text}"`,
  leadingZero: 'Integers cannot have leading zeros',
  notDecimalSeconds: (p: P<'text'>) => `Not decimal seconds: "${p.text}"`,
  negativePosition: 'An absolute position cannot be negative',
};

export type TimeMessages = typeof en;

export const timeMessages = defineCatalog('time', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
