import type { LinkImportMessages } from './link-import-copy.ts';

/** 句末補一個句號（原話已經有結尾標點時不補）。 */
const endSentence = (text: string): string => (/[.!?。！？]$/.test(text.trim()) ? text.trim() : `${text.trim()}。`);

/** 把幾句話接成一段，每句補齊句號；空的跳過。 */
const joinSentences = (parts: readonly (string | null | undefined)[]): string =>
  parts
    .filter((p): p is string => !!p?.trim())
    .map(endSentence)
    .join('');

export const zhHant: LinkImportMessages = {
  title: (name: string | null) => (name ? `從連結匯入 · ${name}` : '從連結匯入'),

  phase: {
    starting: '準備中',
    probing: '正在讀取連結',
    downloading: '正在下載影片',
    validating: '正在確認檔案可以播放',
    publishing: '正在移到下載資料夾',
    applying: '正在匯入影片',
    transcribing: '正在開始轉錄',
  },
  phaseFallback: '處理中',
  downloaded: (bytes: string) => `已下載 ${bytes}`,

  stageDownload: '下載影片',
  stageVideo: '檢查媒體並建立影片',
  stageSubs: '生成字幕',

  issue: {
    TOOL_NOT_INSTALLED: {
      title: '設定一次，之後直接貼上',
      body: 'BaoCut 需要影片下載工具 yt-dlp 才能讀取這個網站。請安裝後重新開始這次匯入。',
    },
    TOOL_CONSENT_REQUIRED: {
      title: '使用下載工具前需要你的同意',
      body: '下載工具已在這台電腦上。BaoCut 只有在你同意後，才會用它從網站下載影片。',
    },
    TOOL_UNAVAILABLE: { title: '下載工具無法執行', body: '已找到下載工具，但它無法執行。請重新安裝，或選擇一份可用的。' },
    TOOL_OUTDATED: { title: '下載工具需要更新', body: '這個版本太舊，可能無法讀取這個網站。請更新後再試一次。' },
    OFFLINE_STRICT: {
      title: '嚴格離線模式下無法從連結下載',
      body: '在嚴格離線模式下，BaoCut 不會連上網路。請先在瀏覽器中下載影片，再選擇本機檔案。',
    },
    LINK_UNSUPPORTED: {
      title: '目前還不支援這個來源',
      body: '下載工具無法辨識這個網站或頁面。請使用影片頁面本身的連結（不是播放清單、直播或搜尋頁面），或改用本機檔案。',
    },
    LINK_LOGIN_REQUIRED: {
      title: '這部影片需要登入',
      body: '請先在瀏覽器中登入該網站，然後回到下載影片步驟，在「網站登入」中勾選該瀏覽器並重新下載。',
    },
    LINK_COOKIES_UNAVAILABLE: {
      title: '無法讀取瀏覽器 Cookie',
      body: '請確認已在瀏覽器中登入。如果資料庫被鎖定，請完全結束瀏覽器（包括在背景執行的），並檢查鑰匙圈權限（Safari 需要在「完整磁碟取用權限」中允許 BaoCut）。在 Windows 上，Chrome、Edge 和 Brave 以應用程式綁定加密保護的 Cookie 無法讀取，請改勾選 Firefox。或勾選其他瀏覽器後重新下載。',
    },
    LINK_TOOL_UPDATE_REQUIRED: {
      title: 'yt-dlp 需要更新',
      body: '網站已變更提供影片的方式。請依原本的安裝方式更新 yt-dlp，重新檢查後再試一次。',
    },
    LINK_UNAVAILABLE: {
      title: '無法取得這部影片',
      body: '影片可能已被移除、有地區限制，或沒有可下載的格式。請試試其他連結或改用本機檔案。',
    },
    LINK_NETWORK_ERROR: { title: '連線中斷', body: '請檢查網路後再試一次；已下載的部分會接續下載。' },
    LINK_DISK_FULL: { title: '磁碟空間不足', body: '下載資料夾所在的磁碟已滿。請清出一些空間後再試一次。' },
    LINK_DOWNLOAD_FAILED: {
      title: '下載工具回報錯誤',
      body: '網站可能已改版，或暫時限制下載。請先重試；如果仍然失敗，請檢查下載工具是否需要更新，或改用本機檔案。',
    },
    LINK_DOWNLOAD_UNREADABLE: {
      title: '下載的檔案無法使用',
      body: '檔案不完整、沒有音軌或無法解碼；網站可能提供了預留內容。請重新下載，或試試其他連結或本機檔案。',
    },
    LINK_DESTINATION_UNAVAILABLE: {
      title: '無法寫入下載資料夾',
      body: '請檢查下載資料夾是否存在且可寫入；選擇其他資料夾後，重新開始匯入。',
    },
    MEDIA_TOOL_UNAVAILABLE: {
      title: '無法檢查下載的檔案',
      body: '檢查媒體需要 ffprobe（隨 ffmpeg 提供），但這台電腦上沒有。請安裝 ffmpeg 後再試一次。',
    },
    LINK_SOURCE_EXPIRED: {
      title: '原始連結已不存在',
      body: '重新啟動後，Runtime 只會保留遮蔽過的連結，而不是完整連結。請貼上連結，重新開始匯入。',
    },
    INTERRUPTED: { title: '匯入已中斷', body: 'Runtime 在完成前停止或重新啟動。重試會從停下的步驟繼續。' },
  },
  issueUnknownTitle: '匯入未完成',
  issueUnknownBody: (message: string | null, remedy: string | null) => joinSentences([message, remedy]) || '發生錯誤。',

  headingStopped: '匯入已停止',
  headingFailed: '匯入未完成',
  headingRunning: '正在將這個連結轉成可編輯的影片',
  headingDownloaded: '影片已下載',
  headingVideoFailed: '檔案已下載，但未建立影片',
  headingCreatingVideo: '檔案已下載，正在建立影片',
  headingTranscribing: '影片已就緒，正在生成字幕',
  headingTranscribeFailed: '影片已就緒，轉錄需要處理',
  headingReady: '影片已就緒',
  headingSubsReady: '字幕已就緒',

  toolSource: {
    system: '安裝在系統中',
    user: '由你選擇',
    managed: '由 BaoCut 下載',
    env: '由環境變數指定',
  },
  factVersion: (version: string, size: string | null) => `版本 ${version}${size ? ` · 約 ${size}` : ''}`,
  factFrom: (host: string) => `從 ${host} 下載`,
  factLicense: (license: string) => `${license} 授權條款`,
  factIsolated: '存放在 BaoCut 自己的資料夾中，驗證總和檢查碼後才會執行；不會更動系統',
  factInstalledWith: (method: string) => `以 ${method} 安裝`,

  cardChecking: '正在檢查下載工具…',
  cardCheckingBody: '只會查看這台電腦上的版本，不會連上網路。',
  cardUnknown: '下載工具未登錄',
  cardUnknownBody: '這個 Runtime 不認得 yt-dlp，因此目前無法從連結匯入。',
  cardInstalling: '正在準備下載工具…',
  cardInstallingBody: '下載 → 驗證 → 試執行。完成後這裡會顯示「已就緒」。',
  cardUpdating: '正在更新下載工具…',
  cardUpdatingBody: '輸出會顯示在命令下方；完成後會再次檢查版本。',
  cardBlockedWhy: 'BaoCut 無法在這台電腦上替你下載它。',
  cardMissing: '尚未安裝下載工具',
  cardMissingBody: (why: string) => `${endSentence(why)}你可以自行安裝 yt-dlp，然後點選「重新檢查」或選擇它的位置。`,
  cardInstall: '設定一次，之後直接貼上',
  cardInstallBody: 'BaoCut 需要影片下載工具 yt-dlp 才能讀取影片網站。你同意後，它會下載這個工具並記住你的同意，之後從連結匯入就不會再詢問。',
  cardInstallAction: '同意並安裝',
  cardOutdatedReason: (reason: string | null, version: string | null, minVersion: string | null) =>
    endSentence(reason ?? `版本 ${version ?? '不明'} 低於所需的 ${minVersion ?? ''}`),
  cardOutdated: '下載工具需要更新',
  cardOutdatedBlocked: (reason: string, why: string) => `${reason}${why}`,
  cardOutdatedRunnable: '它不是由 BaoCut 下載的；你可以用下方的命令，依原本的安裝方式更新它。',
  cardOutdatedManual: '它不是由 BaoCut 下載的。請依照下方說明在終端機中更新，然後點選「重新檢查」。',
  cardOutdatedUpdate: (reason: string) => `${reason}請先更新再開始。`,
  cardUpdateAction: '同意並更新',
  cardBroken: '下載工具無法執行',
  cardBrokenBody: (reason: string | null, remedy: string | null) => joinSentences([reason, remedy]) || '已找到，但無法執行。',
  cardReinstallAction: '同意並重新安裝',
  cardConsentRevoked: '你已撤回對下載工具的同意',
  cardConsent: '使用下載工具前需要你的同意',
  cardConsentBody: 'BaoCut 只有在你同意後，才會用它從網站下載影片。你的同意會保存在 Runtime 中，之後從連結匯入就不會再詢問。',
  cardConsentAction: '同意並使用',
  cardReady: '下載工具已就緒',
  cardReadyBody: '開始後，BaoCut 會先檢查連結並取得影片資訊，然後再下載。',
};
