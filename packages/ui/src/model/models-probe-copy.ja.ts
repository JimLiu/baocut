import type { ModelsProbeMessages } from './models-probe-copy.ts';

export const ja: ModelsProbeMessages = {
  speechText: 'こんにちは。BaoCut の音声合成テストです。',
  noResult: 'タスクは完了しましたが、結果が返ってきませんでした。',
  failed: 'タスクが失敗しました。',
  cancelled: 'タスクはキャンセルされました。',
  interrupted: 'Runtime が再起動したため、このテストは完了しませんでした。',
  unknownOutcome: 'この呼び出しの応答を受け取る前に Runtime が再起動したため、結果は不明です。',
  audioFacts: (seconds, khz, type) => `${seconds} 秒 · ${khz} kHz · ${type}`,
  videoFacts: (width, height, seconds, type) => `${width} × ${height} · ${seconds} 秒 · ${type}`,
  textFacts: (entries, seconds, type) => `${entries} 件 · ${seconds} 秒 · ${type}`,
  packageFacts: (files, type) => `ファイル ${files} 個 · ${type}`,
  projectFacts: (clips, seconds, type) => `クリップ ${clips} 個 · ${seconds} 秒 · ${type}`,
  chars: (count) => `${count} 文字`,
  inputTokens: (count) => `入力 ${count} トークン`,
  outputTokens: (count) => `出力 ${count} トークン`,
  hitLimit: '出力の上限に達しました',
  filtered: 'プロバイダのコンテンツフィルタでブロックされました',
  untested: '未テスト',
  testing: 'テスト中…',
  passed: 'テストに合格',
  passedIn: (seconds) => `テストに合格 · ${seconds} 秒`,
};
