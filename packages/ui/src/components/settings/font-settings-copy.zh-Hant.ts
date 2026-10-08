import { intlLocale } from '@baocut/protocol';
import type { FontSettingsMessages } from './font-settings-copy.ts';

export const zhHant: FontSettingsMessages = {
  lead: (total: number | null) =>
    `字型有三種來源：隨應用程式提供的、這台電腦上安裝的，以及 Google Fonts 字型目錄（${total === null ? '約兩千' : `約 ${total.toLocaleString(intlLocale())}`} 個字族，開放原始碼授權，需要時才下載）。下載時只傳送字族名稱與字重，不需要帳號；字型存放在應用程式資料中，不會放進影片資料夾。`,
  download: '下載',
  autoDownload: '自動下載字型',
  autoDownloadDesc:
    '預覽、開啟影片或匯出用到這台電腦上沒有的字型時，從 Google Fonts 下載。關閉後會先用備用字型顯示與匯出，選擇字型時仍可手動下載。嚴格離線模式下不會下載。',
  cssEndpoint: '樣式表 URL',
  cssEndpointDesc: '鏡像站的基礎 URL。留空則使用 https://fonts.googleapis.com。',
  fileEndpoint: '字型檔 URL',
  fileEndpointDesc: '只從這個 URL 底下取得字型檔。留空則使用 https://fonts.gstatic.com。',
  downloaded: '已下載的字型',
  summary: (families: number, size: string) => `${families} 個字族 · ${size}`,
  none: '還沒有',
  clearAll: '全部清除',
  empty: '選擇字型時下載的字型，以及開啟影片或匯出時自動下載的字型，都會列在這裡。',
  clearTitle: '要清除已下載的字型嗎？',
  clear: '清除',
  cancel: '取消',
  removed: (family: string, size: string) => `已刪除「${family}」 · 釋放 ${size}`,
  inUseTip: '尚未完成的匯出正在使用它，請等匯出完成後再刪除',
  removeTip: '刪除這個字型已下載的檔案',
  removeLabel: (tip: string, family: string) => `${tip}：${family}`,
  facts: (weights: string, size: string, licence: string, ago: string | null) =>
    `字重 ${weights} · ${size} · ${licence}${ago ? ` · ${ago}下載` : ''}`,
  inUse: '匯出使用中',
};
