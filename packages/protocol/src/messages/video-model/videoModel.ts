import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './videoModel.zh-Hans.ts';
import { zhHant } from './videoModel.zh-Hant.ts';
import { ja } from './videoModel.ja.ts';
import { ko } from './videoModel.ko.ts';
import { es } from './videoModel.es.ts';
import { fr } from './videoModel.fr.ts';
import { de } from './videoModel.de.ts';
import { nl } from './videoModel.nl.ts';
import { ptBR } from './videoModel.pt-BR.ts';
import { it } from './videoModel.it.ts';
import { ru } from './videoModel.ru.ts';
import { pl } from './videoModel.pl.ts';
import { tr } from './videoModel.tr.ts';
import { vi } from './videoModel.vi.ts';

/** 参数是标量，或嵌套的引用（展开之后的文字）。 */
type P<K extends string> = Record<K, string | number>;

/**
 * `crates/video-model` 的格式校验说明（经引擎错误的参数带出）。
 * 英文条目与 Rust `msg!` 的模板一字不差（`tools/rust-messages.test.ts` 核对）；改英文要两边一起改，键发布后不改名、不复用。
 */
const en = {
  bindingNegativeFrame: (p: P<'binding'>) => `localFrame of binding ${p.binding} cannot be negative`,
  bindingFrameOrPercent: (p: P<'binding'>) => `Each keyframe of binding ${p.binding} must give exactly one of localFrame and percent`,
  bindingDuplicate: (p: P<'prop' | 'item'>) => `${p.prop} of clip ${p.item} has more than one keyframe binding`,
  captionAnimationUnknown: (p: P<'value'>) => `style.animationPresetId must be an ID from the word animation catalog, not ${p.value}`,
  captionStyleNotObject: 'style must be an object',
  bodyShape: (p: P<'error'>) => `The body has fields of the wrong shape: ${p.error}`,
  schemaMismatch: (p: P<'schema'>) => `schema must be ${p.schema}`,
  clockSourceAsset: 'clock must be source-asset',
  timescaleSafeInteger: 'timescale must be a positive safe integer',
  cutTicksNotInteger: (p: P<'cut'>) => `t0 and t1 of cut ${p.cut} must be integer ticks`,
  cutRangeInvalid: (p: P<'cut'>) => `Cut ${p.cut} must satisfy 0 ≤ t0 < t1`,
  cutBeyondDuration: (p: P<'cut'>) => `Cut ${p.cut} goes past the end of the asset`,
  cutOrder: (p: P<'cut'>) => `Cut ${p.cut} overlaps the previous one or is not sorted by t0`,
  cutIdsRepeated: 'Cut IDs are repeated',
  suggestionTicksNotInteger: (p: P<'suggestion'>) => `t0 and t1 of suggestion ${p.suggestion} must be integer ticks`,
  suggestionRangeInvalid: (p: P<'suggestion'>) => `Suggestion ${p.suggestion} must satisfy 0 ≤ t0 < t1`,
  suggestionOrder: (p: P<'suggestion'>) => `Suggestion ${p.suggestion} is not sorted by t0`,
  suggestionConfidence: (p: P<'suggestion'>) => `confidence of suggestion ${p.suggestion} must be between 0 and 1`,
  suggestionIdsRepeated: 'Suggestion IDs are repeated',
  fxTemperatureRange: 'fx.temperature must be within -1..=1',
  fxShadowOffset: 'The fx.shadow offsets must be finite numbers',
  fxShadowBlurRange: 'fx.shadow.blur must be within 0..=200',
  fxShadowOpacityRange: 'fx.shadow.opacity must be within 0..=1',
  fxShadowColor: 'fx.shadow.color must be #RRGGBB or #RRGGBBAA',
  fxStrokeWidthRange: 'fx.stroke.width must be within (0, 100]',
  fxStrokeColor: 'fx.stroke.color must be #RRGGBB or #RRGGBBAA',
  layoutProfileEmpty: 'layoutProfileId cannot be an empty string',
  coverageRange: 'stages.aligned.coverage must be between 0 and 1',
  transitionParamsInvalid: (p: P<'kind' | 'error'>) => `Invalid parameters for ${p.kind}: ${p.error}`,
  dipColorInvalid: 'color of dip-to-color must be #RRGGBB',
  blockConfidence: (p: P<'index'>) => `confidence of the alignment blocks in units[${p.index}] must be between 0 and 1`,
  splitPiecesEmpty: (p: P<'index'>) => `alignment.split.pieces in units[${p.index}] cannot be empty`,
  splitPieceOrder: (p: P<'index'>) => `alignment.split.pieces in units[${p.index}] has a piece whose from is greater than to`,
};

export type VideoModelMessages = typeof en;

export const videoModelMessages = defineCatalog('videoModel', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
