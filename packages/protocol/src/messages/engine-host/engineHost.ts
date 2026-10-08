import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './engineHost.zh-Hans.ts';
import { zhHant } from './engineHost.zh-Hant.ts';
import { ja } from './engineHost.ja.ts';
import { ko } from './engineHost.ko.ts';
import { es } from './engineHost.es.ts';
import { fr } from './engineHost.fr.ts';
import { de } from './engineHost.de.ts';
import { nl } from './engineHost.nl.ts';
import { ptBR } from './engineHost.pt-BR.ts';
import { it } from './engineHost.it.ts';
import { ru } from './engineHost.ru.ts';
import { pl } from './engineHost.pl.ts';
import { tr } from './engineHost.tr.ts';
import { vi } from './engineHost.vi.ts';

/** 参数是标量，或嵌套的引用（展开之后的文字）。 */
type P<K extends string> = Record<K, string | number>;

/**
 * `crates/engine-host` 自己发出的错误（参数、路径、导出计划、字体）。
 * 英文条目与 Rust `msg!` 的模板一字不差（`tools/rust-messages.test.ts` 核对）；改英文要两边一起改，键发布后不改名、不复用。
 */
const en = {
  runGenerationNotInteger: 'runGeneration must be a decimal integer',
  secondsInvalid: (p: P<'field'>) => `${p.field} must be a finite number of seconds, at least 0`,
  secondsOverflow: (p: P<'field'>) => `${p.field} is out of range`,
  audioItemsKind: 'audioItems is only for audio and video plans',
  skipAssetsKind: 'skipAssets is only for video plans',
  outputKind: 'output is only for video plans',
  outputSize: 'The output width and height must be positive integers',
  tooManyRanges: (p: P<'max'>) => `At most ${p.max} ranges at a time`,
  textPlanNoDocument: 'A text plan needs at least one document',
  textPlanTooManyDocuments: 'A text plan takes at most two documents (the main one and the other one of a bilingual merge)',
  planKindUnknown: (p: P<'kind'>) => `Unknown plan kind ${p.kind}`,
  unknownMethod: (p: P<'method'>) => `Unknown method: ${p.method}`,
  paramsInvalid: (p: P<'error'>) => `Invalid parameters: ${p.error}`,
  fontFacesInvalid: (p: P<'max'>) => `Give 1 to ${p.max} faces: each family name non-empty and at most 200 characters, each weight between 1 and 1000`,
  cacheDirRelative: 'cacheDir must be absolute',
  fontPathRelative: 'path must be absolute',
  fontInvalid: (p: P<'error'>) => `Not a usable font file: ${p.error}`,
  videoPathRelative: 'The video path must be absolute',
  videoNotOpen: 'The video is not open',
  taskStopped: 'This run was stopped, and the change was not committed',
  afterNotInteger: 'after must be a decimal integer',
  enginePanic: 'The engine failed while handling the request, and the change was not committed',
  pathRelative: 'Paths must be absolute',
};

export type EngineHostMessages = typeof en;

export const engineHostMessages = defineCatalog('engineHost', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
