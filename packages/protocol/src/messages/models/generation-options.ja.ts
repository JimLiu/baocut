import type { ModelsGenerationOptionsMessages } from './generation-options.ts';

export const ja: ModelsGenerationOptionsMessages = {
  notLocalOnly: (p: { modelId: string; key: string }) => `モデル ${p.modelId} は ${p.key} を受け付けません（受け付けるのはローカルモデルのみです）`,
  textEmpty: 'テキストを空にすることはできません',
  textTooLong: (p: { length: number; modelId: string; limit: number }) =>
    `テキストは ${p.length} 文字で、モデル ${p.modelId} の 1 回あたりの上限 ${p.limit} 文字を超えています。分割して送信してください。`,
  noDefaultVoice: (p: { modelId: string }) => `モデル ${p.modelId} には既定の声がありません。voice を指定してください`,
  noSuchVoice: (p: { modelId: string; voice: string }) => `モデル ${p.modelId} に声 ${p.voice} はありません`,
  badLanguageTag: (p: { tag: string }) => `有効な BCP 47 言語タグではありません：${p.tag}`,
  languageUnsupported: (p: { modelId: string; language: string }) => `モデル ${p.modelId} は言語 ${p.language} に対応していません`,
  formatUnsupported: (p: { modelId: string; format: string }) => `モデル ${p.modelId} は ${p.format} を出力しません`,
  noInstructions: (p: { modelId: string }) => `モデル ${p.modelId} は口調の指示（instructions）を受け付けません`,
  noSpeed: (p: { modelId: string }) => `モデル ${p.modelId} は話す速さ（speed）を受け付けません`,
  speedRange: (p: { min: number; max: number }) => `話す速さは ${p.min} から ${p.max} の範囲である必要があります`,
  knobUnsupported: (p: { modelId: string; key: string }) => `モデル ${p.modelId} は ${p.key} を受け付けません`,
  knobRange: (p: { key: string; min: number; max: number }) => `${p.key} は ${p.min} から ${p.max} の範囲である必要があります`,
  promptEmpty: 'プロンプトを空にすることはできません',
  promptTooLong: (p: { length: number; modelId: string; limit: number }) =>
    `プロンプトは ${p.length} 文字で、モデル ${p.modelId} の上限 ${p.limit} 文字を超えています`,
  aspectUnsupported: (p: { modelId: string; ratio: string }) => `モデル ${p.modelId} はアスペクト比 ${p.ratio} に対応していません`,
  sizeUnsupported: (p: { modelId: string; size: string }) => `モデル ${p.modelId} はサイズ ${p.size} に対応していません`,
  maxCount: (p: { modelId: string; max: number }) => `モデル ${p.modelId} が一度に生成できる画像は ${p.max} 枚までです`,
  noSteps: (p: { modelId: string }) => `モデル ${p.modelId} は steps を受け付けません（受け付けるのはローカルモデルのみです）`,
  stepsRange: (p: { min: number; max: number }) => `steps は ${p.min} から ${p.max} までの整数である必要があります`,
  noSeed: (p: { modelId: string }) => `モデル ${p.modelId} は seed を受け付けません`,
};
