import type { ModelsProbeMessages } from './models-probe-copy.ts';

export const zhHant: ModelsProbeMessages = {
  speechText: '你好，這是一段 BaoCut 的語音合成測試。',
  noResult: '任務已完成，但沒有傳回結果。',
  failed: '任務失敗。',
  cancelled: '任務已取消。',
  interrupted: 'Runtime 已重新啟動，這次測試沒有完成。',
  unknownOutcome: 'Runtime 在這次呼叫收到回應前就重新啟動了，因此結果不明。',
  audioFacts: (seconds, khz, type) => `${seconds} 秒 · ${khz} kHz · ${type}`,
  videoFacts: (width, height, seconds, type) => `${width} × ${height} · ${seconds} 秒 · ${type}`,
  textFacts: (entries, seconds, type) => `${entries} 條 · ${seconds} 秒 · ${type}`,
  packageFacts: (files, type) => `${files} 個檔案 · ${type}`,
  projectFacts: (clips, seconds, type) => `${clips} 段片段 · ${seconds} 秒 · ${type}`,
  chars: (count) => `${count} 字`,
  inputTokens: (count) => `輸入 ${count} 個 token`,
  outputTokens: (count) => `輸出 ${count} 個 token`,
  hitLimit: '已達輸出上限',
  filtered: '被供應商的內容篩選器擋下',
  untested: '尚未測試',
  testing: '正在測試…',
  passed: '測試通過',
  passedIn: (seconds) => `測試通過 · ${seconds} 秒`,
};
