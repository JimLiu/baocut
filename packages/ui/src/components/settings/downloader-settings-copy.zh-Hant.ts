import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const zhHant: DownloaderSettingsMessages = {
  lead: '從連結下載影片使用 yt-dlp。下載影片工具、從連結轉錄和 Agent 都按照這裡的設定下載。',
  toolGroup: '下載工具',
  cookiesLead: '下載時帶上你在瀏覽器裡的登入狀態，需要登入才能觀看的影片也能下載。預設使用所有偵測到的瀏覽器。',
  autoUpdate: "自動更新 yt-dlp",
  autoUpdateDesc:
    "每天檢查一次有沒有新的穩定版。有新版本時，核對校驗碼之後替換 BaoCut 下載的那一份，替換完成前照常用現在這一份下載。你自己安裝的 yt-dlp 不受影響。",
  autoUpdateChecked: (when: string, version: string) => `上次檢查：${when} · 最新版本 ${version}`,
};
