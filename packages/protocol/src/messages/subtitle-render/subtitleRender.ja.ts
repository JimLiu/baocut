import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const ja: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `要素 ${p.element} の開始アンカーを解決できないため、スキップしました`,
  sourceSkipped: (p) => `プレビューはメディアソース ${p.source} とその要素をスキップしました：${p.detail}`,
  stickerAssetNoSource: (p) => `素材ステッカー ${p.element} に srcId がありません。タイムラインのソースに登録してください（テンプレートステッカーは source=template と templateId を使います）`,
  missingFont: (p) => `フォント「${p.family}」はフォントライブラリにありません。${p.fallback} で代用します`,
  stickerRecolorFailed: (p) => `ステッカーソース ${p.source} の色を変更できないため、元の色で描画します：${p.detail}`,
};
