import type { ServicesApiMessages } from './services-api-copy.ts';

export const zhHant: ServicesApiMessages = {
  capabilities: {
    transcribe: '轉錄',
    synthesizeSpeech: '合成語音',
    generateImage: '生成圖片',
    generateText: '生成文字',
  },
  endpoints: {
    models: '列出模型',
    model: '查詢單一模型',
    info: '服務資訊與介面版本',
    transcriptions: '轉錄音訊',
    speech: '合成語音',
    images: '生成圖片',
    chat: '生成文字（對話）',
  },
  routing: {
    online: { label: '線上服務', desc: '將請求轉給已連接的雲端服務（可能產生費用，資料會離開這台電腦）' },
    nodes: { label: '區域網路節點', desc: '將請求轉給其他已配對的電腦' },
    agent: { label: 'Agent', desc: '將請求轉給這台電腦上已登入的 Agent 執行環境（例如 Codex）' },
  },
  modelsAvailable: (n) => `${n} 個模型可用`,
  notRouted: '有可用的模型，但它們所屬的類別尚未開啟路由；目前請求會收到 503',
  noModels: '目前還沒有可用的模型；目前請求會收到 503',
  defaultModel: '預設模型',
  target: (provider, model) => `${provider} · ${model}`,
  aliasProviderMissing: '找不到這個供應商；請求會收到 404',
  aliasNotRouted: '這個類別尚未開啟路由；請求會收到 404',
  aliasProviderUnavailable: '目前無法使用這個供應商',
  aliasModelUnavailable: '目前無法使用這個模型',
  targetNotRouted: '未開啟路由',
  targetUnavailable: '目前無法使用',
  aliasNameEmpty: '請輸入名稱，例如 whisper-1',
  aliasNameSlash: '名稱不能包含「/」：<供應商>/<模型> 是標準寫法，別名不能與它衝突',
  aliasNameChars: '只能使用字母、數字與 . _ : -，並以字母或數字開頭',
  aliasNameTaken: (name) => `「${name}」已存在；若要變更目標，請先刪除那一列`,
};
