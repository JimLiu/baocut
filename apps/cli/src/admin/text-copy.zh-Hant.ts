import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';

export const zhHant: TextMessages = {
  help: `用法：
  baocut text <prompt> [options]   呼叫一次文字模型；提示詞為 - 時從標準輸入讀取。完整文字輸出到 stdout
                                   （加上 --out 時寫入檔案，stdout 則輸出任務與產出的 JSON）；任務進度、
                                   警告與模型版本輸出到 stderr
    --system <text>                系統訊息
    --json-schema <file>           結構化輸出：依這個 JSON Schema（根為 object）傳回並驗證；
                                   不符合時任務以 MODEL_OUTPUT_INVALID 失敗
    --provider <id>                目錄中的供應商（例如 openai、google 或 anthropic），或 custom:<name>；
                                   省略時使用預設值（這項能力沒有內建預設）
    --model <id>                   模型；省略時使用該供應商的預設模型
    --max-output-tokens <n>        輸出上限；省略時使用模型的上限。純文字被截斷時仍會輸出，
                                   並附上 output-truncated 警告
    --effort <${TEXT_EFFORTS.join('|')}>
                                   推理強度；模型沒有這個等級時改用最接近的等級，模型無法調整時忽略
                                   （會在 stderr 說明）
    --temperature <0–2>            僅適用於支援此參數的模型
    --seed <n>                     僅適用於支援此參數的模型
    --out <file>                   將完整文字寫入這個檔案`,
  stdinPromptHint: '輸入提示詞後，按 Ctrl-D 完成：',
  missingPrompt: '缺少提示詞',
  jsonSchemaUnreadable: (file, reason) => `無法讀取 JSON Schema ${file}：${reason}`,
  jsonSchemaNotObject: '--json-schema 的檔案必須包含一個 JSON 物件',
  singleModel: 'text 只接受一個 --model',
  maxOutputTokensInvalid: '--max-output-tokens 必須是正整數',
  effortChoices: (efforts) => `--effort 必須是 ${efforts.join('、')} 其中之一`,
  temperatureRange: '--temperature 必須介於 0 到 2 之間',
  seedInvalid: '--seed 必須是整數',
  noTextResult: '任務已完成，但沒有傳回文字',
  fetchOutputFailed: (artifactId, status) => `無法取得產出 ${artifactId}：HTTP ${status}`,
  written: (file) => `已寫入 ${file}`,
  modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `，輸入 ${usage.input} / 輸出 ${usage.output} token` : ''}`,
};
