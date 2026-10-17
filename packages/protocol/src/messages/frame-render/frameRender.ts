import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './frameRender.zh-Hans.ts';
import { zhHant } from './frameRender.zh-Hant.ts';
import { ja } from './frameRender.ja.ts';
import { ko } from './frameRender.ko.ts';
import { es } from './frameRender.es.ts';
import { fr } from './frameRender.fr.ts';
import { de } from './frameRender.de.ts';
import { nl } from './frameRender.nl.ts';
import { ptBR } from './frameRender.pt-BR.ts';
import { it } from './frameRender.it.ts';
import { ru } from './frameRender.ru.ts';
import { pl } from './frameRender.pl.ts';
import { tr } from './frameRender.tr.ts';
import { vi } from './frameRender.vi.ts';

/** 参数是标量。 */
type P<K extends string> = Record<K, string | number>;

/**
 * `crates/frame-render` 说明画不出来的东西（`UnsupportedItem.message`，预览的「画不出来」提示与导出预检的清单）。
 * 英文条目与 Rust `msg!` 的模板一字不差（`tools/rust-messages.test.ts` 核对）；改英文要两边一起改，键发布后不改名、不复用。
 */
const en = {
  effectUnsupported: (p: P<'kind'>) => `Effect ${p.kind} can’t be drawn`,
  transitionUnsupported: (p: P<'kind'>) => `Transition ${p.kind} can’t be drawn; using a hard cut`,
  shapeUnknown: (p: P<'id'>) => `Shape ${p.id} isn’t in the catalog shipped with the renderer`,
  stickerTemplateUnknown: (p: P<'id'>) => `Sticker template ${p.id} isn’t in the catalog shipped with the renderer`,
  visualizerStyleUnknown: (p: P<'id'>) => `Waveform style ${p.id} isn’t in the catalog shipped with the renderer`,
  progressStyleUnknown: (p: P<'id'>) => `Progress bar style ${p.id} isn’t in the catalog shipped with the renderer`,
  confettiStyleUnknown: (p: P<'id'>) => `Confetti style ${p.id} isn’t in the catalog shipped with the renderer`,
  shapeMissing: 'No shape is specified',
  stickerTemplateMissing: 'No sticker template is specified',
  visualizerStyleMissing: 'No waveform style is specified',
  progressStyleMissing: 'No progress bar style is specified',
  confettiStyleMissing: 'No confetti style is specified',
  generatorNotImplemented: (p: P<'generator'>) => `Generator ${p.generator} can’t be drawn`,
  layerUnknown: 'This kind of clip isn’t recognized',
  bundleWithoutPrerender: 'A code composition without a pre-rendered stand-in can’t be drawn (generate the stand-in first)',
  stickerAssetUnsupported: 'This sticker’s asset can’t be drawn (sticker assets must be images, videos, or Lottie)',
  placeholderAssetUnsupported: 'The asset in this placeholder can’t be drawn (it must be an image or video)',
  templateMissing: 'This template layer isn’t in the sequence’s template',
  templateLogoFileMissing: 'The image file used as the template logo isn’t in this video (check that the file is still in the project)',
  templateLogoAssetMissing: 'The brand kit image used as the template logo isn’t in this video (pick the logo again to copy it in)',
  layerUnsupported: 'This clip can’t be drawn',
  captionDocumentMissing: (p: P<'document'>) => `Subtitle document ${p.document} no longer exists`,
  captionDocumentUnknown: (p: P<'schema'>) => `Subtitle document ${p.schema} isn’t recognized`,
  captionDocumentNoSchema: 'The subtitle document isn’t recognized (it has no schema)',
  captionStyleMissing: (p: P<'document'>) => `Subtitle style document ${p.document} no longer exists`,
  captionStyleUnknown: (p: P<'schema'>) => `Subtitle style ${p.schema} isn’t recognized (export doesn’t substitute styles)`,
  captionStyleNoSchema: 'The subtitle style isn’t recognized (it has no schema; export doesn’t substitute styles)',
  captionSceneInvalid: (p: P<'detail'>) => `This clip’s subtitle style settings are invalid: ${p.detail}`,
  assetNotFrozen: (p: P<'asset'>) => `The file for asset ${p.asset} isn’t available`,
  assetNoPicture: (p: P<'asset'>) => `Asset ${p.asset} has no picture (no video stream)`,
  assetUndecodable: (p: P<'asset' | 'detail'>) => `Asset ${p.asset} can’t be decoded: ${p.detail}`,
  imageUnreadable: (p: P<'kind' | 'asset'>) => `${p.kind} image ${p.asset} can’t be read`,
  imageUndecodable: (p: P<'kind' | 'asset'>) => `${p.kind} image ${p.asset} can’t be decoded`,
  imageUndecodableDetail: (p: P<'kind' | 'asset' | 'detail'>) => `${p.kind} image ${p.asset} can’t be decoded: ${p.detail}`,
  templateLogoUnreadable: (p: P<'asset'>) => `Template logo image ${p.asset} can’t be read`,
  templateLogoUndecodable: (p: P<'asset'>) => `Template logo image ${p.asset} can’t be decoded`,
  templateLogoUndecodableDetail: (p: P<'asset' | 'detail'>) => `Template logo image ${p.asset} can’t be decoded: ${p.detail}`,
  lottieNoAsset: 'This Lottie sticker has no asset',
  lottieUnreadable: 'The Lottie asset can’t be read',
  lottieUnreadableDetail: (p: P<'detail'>) => `The Lottie asset can’t be read: ${p.detail}`,
  lottieUnparsable: (p: P<'detail'>) => `The Lottie asset can’t be parsed: ${p.detail}`,
  captionResourceInvalid: (p: P<'detail'>) => `This subtitle style’s resources can’t be loaded: ${p.detail}`,
  itemNote: (p: P<'item' | 'note'>) => `${p.item}: ${p.note}`,
  missingFont: (p: P<'family' | 'fallback'>) => `Font "${p.family}" isn’t in the font library; using ${p.fallback} instead`,
  svgNotUtf8: 'This SVG sticker isn’t UTF-8 text, so its colors can’t be changed; drawing its original colors',
  speakerNoTranscript: (p: P<'speaker'>) => `This video has no transcript, so it’s unknown when speaker ${p.speaker} talks; the waveform is drawn silent`,
  speakerNotInSequence: (p: P<'speaker'>) => `The transcript has no speech from speaker ${p.speaker} in this sequence; the waveform is drawn silent`,
  spectrumMissing: (p: P<'asset'>) => `No spectrum for asset ${p.asset}`,
  spectrumUnreadable: (p: P<'asset' | 'detail'>) => `The spectrum of asset ${p.asset} can’t be read: ${p.detail}`,
  gifFirstFrameOnly: (p: P<'detail'>) => `This GIF is too large, so only its first frame is drawn: ${p.detail}`,
  captionAnimationUnknown: (p: P<'preset'>) => `Subtitle animation preset ${p.preset} isn’t recognized; the subtitles aren’t animated`,
};

export type FrameRenderMessages = typeof en;

export const frameRenderMessages = defineCatalog('frameRender', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
