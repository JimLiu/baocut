import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './timelineRender.zh-Hans.ts';
import { zhHant } from './timelineRender.zh-Hant.ts';
import { ja } from './timelineRender.ja.ts';
import { ko } from './timelineRender.ko.ts';
import { es } from './timelineRender.es.ts';
import { fr } from './timelineRender.fr.ts';
import { de } from './timelineRender.de.ts';
import { nl } from './timelineRender.nl.ts';
import { ptBR } from './timelineRender.pt-BR.ts';
import { it } from './timelineRender.it.ts';
import { ru } from './timelineRender.ru.ts';
import { pl } from './timelineRender.pl.ts';
import { tr } from './timelineRender.tr.ts';
import { vi } from './timelineRender.vi.ts';

/** 参数是标量。 */
type P<K extends string> = Record<K, string | number>;

/**
 * `crates/timeline-render` 画元素时的提示（形状、贴纸、声波、进度条、彩纸与外部媒体），经渲染提示（`EXPORT_RENDER_NOTE`）给用户看。
 * 英文条目与 Rust `msg!` 的模板一字不差（`tools/rust-messages.test.ts` 核对）；改英文要两边一起改，键发布后不改名、不复用。
 */
const en = {
  shapeUnknown: (p: P<'element' | 'shape'>) => `Element ${p.element} uses shape ${p.shape}, which isn’t registered; skipped`,
  shapeInvisible: (p: P<'shape' | 'element'>) => `Shape ${p.shape} of element ${p.element} has neither fill nor stroke, so nothing is drawn`,
  stickerTemplateMissing: (p: P<'element'>) => `Element ${p.element} is a template sticker without a templateId; skipped`,
  stickerTemplateUnknown: (p: P<'element' | 'template'>) => `Element ${p.element} uses sticker template ${p.template}, which isn’t registered; skipped`,
  visualizerStyleUnknown: (p: P<'element' | 'style'>) => `Element ${p.element} uses waveform style ${p.style}, which isn’t registered; skipped`,
  spectrumNotInjected: (p: P<'element'>) => `Element ${p.element} has no spectrum track; drawing a placeholder`,
  spectrumEmpty: (p: P<'element'>) => `The spectrum track of element ${p.element} is empty; drawing a placeholder`,
  progressStyleUnknown: (p: P<'element' | 'style'>) => `Element ${p.element} uses progress style ${p.style}, which isn’t registered; skipped`,
  confettiStyleUnknown: (p: P<'element' | 'style'>) => `Element ${p.element} uses confetti style ${p.style}, which isn’t registered; skipped`,
  spectrumUnavailable: (p: P<'kind' | 'style' | 'element'>) => `The ${p.kind} style ${p.style} of element ${p.element} has no spectrum data; drawing a placeholder`,
  textureNoSource: (p: P<'element'>) => `The external texture of element ${p.element} has no srcId`,
  textureSizeInvalid: (p: P<'element' | 'width' | 'height'>) => `The external texture of element ${p.element} has an invalid size (${p.width}×${p.height})`,
  mediaBoxInvalid: (p: P<'element'>) => `The media box of element ${p.element} has an invalid size`,
  effectsOffGpu: (p: P<'element' | 'detail'>) => `The media effects of element ${p.element} can’t run in the GPU texture scene (${p.detail}); rendering them with the shared CPU effect stack`,
  cornerRadiiOffGpu: (p: P<'element'>) => `Per-corner radii of element ${p.element} aren’t supported in the GPU texture scene yet; rendering with the shared CPU effect stack`,
  tileNodesOverLimit: (p: P<'element' | 'count' | 'limit'>) => `Tiled media of element ${p.element} needs ${p.count} texture nodes, over the real-time limit of ${p.limit}; rendering on the host`,
};

export type TimelineRenderMessages = typeof en;

export const timelineRenderMessages = defineCatalog('timelineRender', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
