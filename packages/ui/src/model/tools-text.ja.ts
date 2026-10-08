import type { ToolsTextMessages } from './tools-text.ts';

export const ja: ToolsTextMessages = {
  emptyInput: '先に生成したい内容を入力してください',
  tooLong: (max) => `一度に入力できるのは最大 ${max} 文字です`,
  sample: '30 秒の街歩き動画のナレーション原稿を書いてください。自然な口調で、街並み、カフェ、夕暮れを取り上げてください。',
  counter: (n, max) => `${n} / ${max} 文字`,
  connectTextModel: '先にテキストモデルを接続してください',
  connectFirst: (provider) => `先に ${provider} を接続してください`,
  effortFixed: '推論強度 · このモデルでは調整できません',
  effort: (label) => `推論強度 · ${label}（モデルページで設定した既定値）`,
  auto: '自動',
  headerChip: (provider) => `オンライン · ${provider} · トークン単位で課金`,
  fileStem: '生成テキスト',
  chars: (n) => `${n} 文字`,
  outputTokens: (n) => `出力 ${n} トークン`,
  truncated: '出力の上限に達したため、残りは切り捨てられました',
};
