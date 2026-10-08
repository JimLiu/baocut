import type { GeneralSettingsMessages } from './general-settings-copy.ts';

export const zhHant: GeneralSettingsMessages = {
  interfaceGroup: '介面',
  language: '語言',
  languageDesc: '立即生效，不需要重新啟動。',
  languageSystem: (current: string) => `跟隨系統（${current}）`,
  appearance: '外觀',
  appearanceDesc: '只影響這台電腦上的 BaoCut 視窗。',
  schemeSystem: '跟隨系統',
  schemeLight: '淺色',
  schemeDark: '深色',

  saveFailed: (message: string) => `無法儲存：${message}`,

  editingGroup: '編輯與轉錄',
  autoOpen: '轉錄完成後自動開啟影片',
  autoOpenDesc: '適用於本機匯入。從連結匯入在背景完成時只會通知你，目前的頁面維持不變。',
  autoOpenNote: '尚未接上：目前轉錄完成後一律停留在目前的頁面，不會自動開啟影片。',
  lineLength: '字幕行長',
  lineLengthDesc: '設定自動換行的目標長度。不影響你手動編輯過的行。',
  lineLengthNote: (maxChars: number, custom: string | null) =>
    `尚未接上：自動換行目前固定為每行 ${maxChars} 個半形字元（每個中日韓文字算兩個）。${custom ? `已儲存的是自訂值（${custom}）。` : ''}`,
  cueShading: '逐字稿中的字幕底色',
  cueShadingDesc: '為每句字幕的範圍加上淺色底，看得出在哪裡斷開。',
  cueShadingNote: '尚未實作：逐字稿目前不會為字幕範圍加上底色。',

  downloadsGroup: '下載與更新',
  autoUpdateOn: '已開啟自動檢查並下載更新',
  autoUpdateOff: '已關閉自動下載更新',
  downloader: '影片下載工具',
  downloaderWeb: '瀏覽器不會檢查這台電腦上的下載工具；請在 BaoCut 桌面應用程式中查看。',
  checking: '正在檢查…',
  checkFailed: (message: string) => `無法檢查：${message}`,
  checkAgain: '重新檢查',

  sourcesGroup: '下載來源與離線',
  modelsEndpoint: '模型下載來源',
  modelsEndpointDesc:
    '本機模型從這裡下載。留空則使用公開的模型庫（Hugging Face）；無法連線時，請輸入鏡像站的基礎 URL。環境變數 BAOCUT_MODELS_ENDPOINT 優先於此設定。',
  toolsEndpoint: '工具下載來源',
  toolsEndpointDesc:
    'yt-dlp 這類外部工具從這裡下載，位置為「基礎 URL/工具/版本/檔案名稱」。留空則使用官方發布網址。環境變數 BAOCUT_TOOLS_ENDPOINT 優先於此設定。',
  toolsEndpointPlaceholder: '官方發布網址',
  strictOffline: '嚴格離線',
  strictOfflineDesc: '開啟後不下載模型與外部工具，也不從連結下載影片。雲端模型與 Agent 引擎是否連網不受影響。',
  strictOfflineOn: '已開啟嚴格離線',
  strictOfflineOff: '已關閉嚴格離線',
  endpointChanged: (endpoint: string) => `已改用 ${endpoint}`,
  endpointReset: (label: string) => `${label}已回復預設值`,
  save: '儲存',
  resetDefault: '回復預設值',

  trashDays: '垃圾桶保留天數',
  trashDaysDesc: (fallback: number | null) =>
    `在垃圾桶中超過這個天數且沒有被引用的項目，以及已刪除的影片，會被永久刪除（啟動時檢查一次，之後每 6 小時檢查一次）。仍被引用的項目會保留。清空此欄即回復預設值${fallback ? `（${fallback} 天）` : ''}。`,
};
