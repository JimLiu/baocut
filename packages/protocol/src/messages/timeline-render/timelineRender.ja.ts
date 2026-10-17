import type { TimelineRenderMessages } from './timelineRender.ts';

export const ja: TimelineRenderMessages = {
  shapeUnknown: (p) => `要素 ${p.element} のシェイプ「${p.shape}」は登録されていないため、スキップしました`,
  shapeInvisible: (p) => `要素 ${p.element} のシェイプ「${p.shape}」には塗りも線もないため、何も描画されません`,
  stickerTemplateMissing: (p) => `要素 ${p.element} はテンプレートステッカーですが templateId がないため、スキップしました`,
  stickerTemplateUnknown: (p) => `要素 ${p.element} のステッカーテンプレート「${p.template}」は登録されていないため、スキップしました`,
  visualizerStyleUnknown: (p) => `要素 ${p.element} の波形スタイル「${p.style}」は登録されていないため、スキップしました`,
  spectrumNotInjected: (p) => `要素 ${p.element} にスペクトルトラックがないため、プレースホルダーを描画します`,
  spectrumEmpty: (p) => `要素 ${p.element} のスペクトルトラックが空のため、プレースホルダーを描画します`,
  progressStyleUnknown: (p) => `要素 ${p.element} のプログレススタイル「${p.style}」は登録されていないため、スキップしました`,
  confettiStyleUnknown: (p) => `要素 ${p.element} の紙吹雪スタイル「${p.style}」は登録されていないため、スキップしました`,
  spectrumUnavailable: (p) => `要素 ${p.element} の ${p.kind} スタイル「${p.style}」にはスペクトルデータがないため、プレースホルダーを描画します`,
  textureNoSource: (p) => `要素 ${p.element} の外部テクスチャに srcId がありません`,
  textureSizeInvalid: (p) => `要素 ${p.element} の外部テクスチャのサイズが不正です（${p.width}×${p.height}）`,
  mediaBoxInvalid: (p) => `要素 ${p.element} のメディアボックスのサイズが不正です`,
  effectsOffGpu: (p) => `要素 ${p.element} のメディアエフェクトは GPU テクスチャシーンで実行できません（${p.detail}）。共有の CPU エフェクトスタックで描画します`,
  cornerRadiiOffGpu: (p) => `要素 ${p.element} の角ごとの角丸は GPU テクスチャシーンでまだ使えません。共有の CPU エフェクトスタックで描画します`,
  tileNodesOverLimit: (p) => `要素 ${p.element} のタイル状メディアには ${p.count} 個のテクスチャノードが必要で、リアルタイム上限 ${p.limit} を超えるため、ホストで描画します`,
};
