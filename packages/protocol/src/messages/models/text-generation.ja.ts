import type { ModelsTextGenerationMessages } from './text-generation.ts';

export const ja: ModelsTextGenerationMessages = {
  noMessage: '空でない user または assistant メッセージが少なくとも 1 件必要です',
  badRole: 'メッセージの role は system、user、assistant のいずれかである必要があります',
  inputTooLong: (p: { chars: number; modelId: string; contextTokens: number }) =>
    `入力は ${p.chars} 文字で、モデル ${p.modelId} のコンテキスト ${p.contextTokens} トークンを大きく超えています`,
  maxOutput: (p: { modelId: string; max: number }) => `モデル ${p.modelId} が 1 回に出力できるのは最大 ${p.max} トークンです`,
  noTemperature: (p: { modelId: string }) => `モデル ${p.modelId} は temperature を受け付けません`,
  temperatureRange: 'temperature は 0 から 2 の範囲である必要があります',
  noSeed: (p: { modelId: string }) => `モデル ${p.modelId} は seed を受け付けません`,
  noStructured: (p: { modelId: string }) => `モデル ${p.modelId} は構造化出力に対応していません`,
  effortIgnored: (p: { modelId: string; requested: string }) =>
    `モデル ${p.modelId} は推論強度を調整できないため、${p.requested} は無視しました`,
  effortChanged: (p: { modelId: string; requested: string; applied: string }) =>
    `モデル ${p.modelId} には推論強度 ${p.requested} がないため、代わりに ${p.applied} を使いました`,
  contentFiltered: (p: { provider: string }) => `${p.provider} のコンテンツフィルタにより、この出力はブロックされました`,
  truncatedJson: (p: { provider: string; max: number }) =>
    `${p.provider} の出力が上限（${p.max} トークン）に達して途中で切れたため、構造化出力が不完全です`,
  truncatedProblem: (p: { max: number }) => `出力が途中で切れました（maxOutputTokens ${p.max}）`,
  notJson: (p: { provider: string }) => `${p.provider} の出力が有効な JSON ではありません`,
  notJsonProblem: '有効な JSON ではありません',
  schemaMismatch: (p: { provider: string }) => `${p.provider} の出力が指定された JSON Schema と一致しません`,
  limitBeforeText: (p: { provider: string }) => `${p.provider} はテキストを出力する前に出力の上限に達しました`,
  emptyOutput: (p: { provider: string }) => `${p.provider} が空の出力を返しました`,
  limitBeforeTextProblem: (p: { max: number }) => `出力の上限 ${p.max} トークンを使い切った時点で、テキストがまだありませんでした`,
  emptyProblem: '出力が空です',
  cancelled: '呼び出しをキャンセルしました',
};
