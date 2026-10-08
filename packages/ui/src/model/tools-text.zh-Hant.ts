import type { ToolsTextMessages } from './tools-text.ts';

export const zhHant: ToolsTextMessages = {
  emptyInput: '請先輸入要生成的內容',
  tooLong: (max) => `一次最多輸入 ${max} 字`,
  sample: '為一部城市漫遊影片寫一段 30 秒的旁白。語氣自然，突顯街道、咖啡廳和黃昏。',
  counter: (n, max) => `${n} / ${max} 字`,
  connectTextModel: '請先連接文字模型',
  connectFirst: (provider) => `請先連接 ${provider}`,
  effortFixed: '推理強度 · 這個模型無法調整',
  effort: (label) => `推理強度 · ${label}（在模型頁面設定的預設值）`,
  auto: '自動',
  headerChip: (provider) => `線上 · ${provider} · 依 token 計費`,
  fileStem: '生成的文字',
  chars: (n) => `${n} 字`,
  outputTokens: (n) => `輸出 ${n} 個 token`,
  truncated: '已達輸出上限，後面的內容被截斷',
};
