import type { JobsYtDlpMessages } from './yt-dlp.ts';

export const zhHant: JobsYtDlpMessages = {
  toolNotFound: (p: { code: string }) => `找不到可執行的 yt-dlp（${p.code}）`,
  remedyUnsupported: '下載工具不支援這個連結：請改用影片頁面本身的連結（不是播放清單、直播或搜尋頁面）',
  remedyLoginRequired: '請先在瀏覽器中登入該網站，再到「網站登入」中選擇該瀏覽器，然後重新下載',
  remedyCookiesUnavailable: '無法讀取瀏覽器 Cookie：請確認已在瀏覽器中登入；資料庫被佔用時，請完全結束瀏覽器（包括在背景執行的處理程序）；鑰匙圈存取遭拒時，請允許存取；Safari 需要「完整磁碟取用權限」；在 Windows 上，Chrome、Edge、Brave 用應用程式綁定加密保護的 Cookie，yt-dlp 無法讀取，請改用 Firefox；或換一個瀏覽器',
  remedyToolUpdateRequired: '網站解析失敗或工具版本過舊：請更新 yt-dlp，重新偵測後再試一次',
  remedyUnavailable: '影片無法使用（已刪除、有地區限制，或沒有可下載的格式）',
  remedyNetworkError: '無法連線，或下載中斷：請檢查網路後重試（已下載的部分會接續下載）',
  remedyDiskFull: '下載資料夾或 Runtime Home 所在的磁碟空間不足：請釋出空間後重試',
  remedyDownloadFailed: '下載工具回報錯誤：請查看 details.stderr；可能需要更新 yt-dlp（baocut external-tools detect）',
  exited: (p: { code: number | null }) => `yt-dlp 以 ${p.code} 結束`,
  cookieLoginRequired: (p: { browser: string }) => `${p.browser}：網站仍要求登入`,
  cookieUnreadable: (p: { browser: string }) => `${p.browser}：無法讀取 Cookie`,
  reasonSeparator: '；',
  cookieAttemptsFailed: (p: { count: number; reasons: string }) => `嘗試了 ${p.count} 個瀏覽器的 Cookie，都沒有成功（${p.reasons}）`,
  metadataUnreadable: '無法讀取下載工具提供的中繼資料',
  metadataNotObject: '下載工具提供的中繼資料不是物件',
  playlist: '這個連結是播放清單；一次只能匯入一部影片',
  live: '無法匯入直播',
};
