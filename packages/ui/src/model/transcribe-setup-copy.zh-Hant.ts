import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';

export const zhHant: TranscribeSetupMessages = {
  notConnected: '未連接',
  unavailable: '無法使用',
  autoDetect: '自動偵測',
  hintNoModel: '還不確定這次會使用哪個語音模型。請先在上方選擇一個，才能知道它是否接受辨識提示。',
  hintUnsupported: (model: string, alt: string | null) =>
    `${model} 不接受辨識提示，因此術語表和提示詞在這一步都無法使用，轉錄時會略過。${alt ? `若想在轉錄時使用，請換成 ${alt}。` : ''}`,
  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => {
    const custom = b.custom ? `提示詞 ${b.custom} 字` : '無提示詞';
    const dropped = b.dropped ? ` · 另有 ${b.dropped} 個放不下，排在前面的術語表優先放入` : '';
    return `傳送給 ${model}：${custom} + ${b.terms} 個術語 · 約 ${b.chars} / ${max} 字${dropped}`;
  },
  glossaryGone: '已不在術語表資料庫中 · 這次不使用',
  glossaryTranslation: '翻譯用的術語表，轉錄用不到 · 這次不使用',
  anyLanguage: '不限語言',
  termCount: (count: number) => `${count} 個術語`,
  noDefaultModel: '還沒有預設的語音模型',
  defaultModel: (label: string) => `${label}（預設）`,
  autoDetectLanguage: '自動偵測語言',
  glossaries: (count: number) => `${count} 個術語表`,
  hasPrompt: '含提示詞',
  noDefaultFacts: '還沒有預設的語音模型。請選擇一個，或到模型頁面設定預設值。如果不選擇就直接開始，會告訴你缺少什麼。',
  modelUnusable: '這個模型目前無法使用',
  acceptsHint: '接受辨識提示',
  noHint: '不接受辨識提示',
  followDefault: (facts: string) => `沿用預設 · ${facts}`,
};
