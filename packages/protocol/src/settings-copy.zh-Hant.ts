import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const zhHant: SettingDescriptionMessages = {
  'agent.defaultDriver': "新對話使用的 Agent；null 優先使用已偵測可用的 Agent（Codex 優先）。建立對話時即固定",
  'agent.defaultModel': '新對話使用的模型；null 使用推薦模型（Claude Code 用 Sonnet，Codex 用 -sol 那一檔），__agent-default__ 不指定模型，依 Agent 自己命令列的設定',
  'agent.defaultEffort': '新對話的推理強度；null 使用 Agent 自己的預設值',
  'agent.defaultAccessMode':
    '從未切換過存取模式的對話會使用它：ask、autoAcceptEdits、auto、fullAccess 或 plan（舊值 controlled 與 authorized 分別視為 ask 與 fullAccess）',
  'ui.language': `介面語言：system 跟隨系統語言（沒有對應的語言時使用英文），或語言代碼（${LOCALES.join('、')}）。Runtime 顯示給使用者的文字也會使用它`,
  'captions.maxLineLength': '自動換行的目標行長（字元數）：cjk 用於中文、日文與韓文文字，other 用於其他文字',
  'transcribe.afterComplete': '轉錄完成後：open-video 會開啟影片，notify 只發出通知，nothing 不做任何事',
  'downloads.directory':
    '預設儲存位置：沒有影片的工具結果、從連結下載的媒體，以及 downloads_save 交出的檔案（絕對路徑）；null 使用這台主機上的 ~/Downloads，與專案無關',
  'downloads.cookieBrowsers': '從連結下載時的網站登入（下載影片、從連結轉錄，以及 Agent 的下載與轉錄）：all 使用這台主機上偵測到有 Cookie 資料庫的所有瀏覽器，最近使用過的在前；瀏覽器 id 清單（chrome、edge、firefox、safari、brave、chromium、opera、vivaldi、whale）依序逐一嘗試；空清單則匿名下載。每次下載開始時依當時偵測到的瀏覽器展開',
  'models.downloadEndpoint':
    '本機模型的下載來源（鏡像站的基礎 URL，http(s)://）；null 使用公開的模型庫，https://www.modelscope.cn 從 ModelScope 下載。環境變數 BAOCUT_MODELS_ENDPOINT 優先',
  'models.dir':
    '本機模型的資料夾（絕對路徑）；null 使用資料資料夾中的 models。環境變數 BAOCUT_MODELS_DIR 優先。請用 models.setDir 變更，而不是 settings set',
  'tools.downloadEndpoint':
    '受管外部工具（yt-dlp）的下載來源（鏡像站的基礎 URL，http(s)://，檔案位於 <base>/<tool>/<version>/<file>）；null 使用官方發布網址。環境變數 BAOCUT_TOOLS_ENDPOINT 優先',
  'models.downloadMirrors':
    "新增的模型倉庫鏡像站（{ name, base } 的清單；base 是 http(s):// 基礎 URL，不重複）。只是備選清單，下載依 models.downloadEndpoint",
  'tools.downloadMirrors':
    "新增的發布頁鏡像站（{ name, base } 的清單；base 是 http(s):// 基礎 URL，不重複）。只是備選清單，下載依 tools.downloadEndpoint",
  'fonts.autoDownload':
    '自動下載排版需要、這台電腦上沒有，且在字型目錄中的字型（預覽與匯出）；關閉時會以備用字型繪製並顯示提示',
  'fonts.cssEndpoint': '字型 CSS API 的基礎 URL（鏡像站，https://）；null 使用 https://fonts.googleapis.com',
  'fonts.fileEndpoint': '字型檔案的基礎 URL（鏡像站，https://；只會從這個位置之下取得檔案）；null 使用 https://fonts.gstatic.com',
  'space.trashRetentionDays':
    'Space 垃圾桶中項目的保留天數（1–3650）：超過這個天數、未被參照的項目與已刪除的影片會定期永久刪除',
  'versions.keep': "每部影片的版本記錄保留的未命名版本數（1–100）；儲存的版本一律保留。一部影片的版本檔案另有 64 MiB 的上限，超過時從最舊的未命名版本刪起",
  'versions.cadence': "版本記錄何時開新版本：segment 在安靜 5 分鐘、連續編輯滿 30 分鐘以及儲存、回到版本前後；turn 另在智慧體每個回合開始時",
  'cache.maxSizeMiB': '資料目錄裡快取的大小上限，MiB（256–1048576）：超過時從最舊的快取檔案（素材分析、播放用的轉碼）刪起，降到上限的 90%。跨影片檢索的索引不刪',
  'resources.capacity':
    '進階：資源排程使用的機器容量 { memoryMiB, gpuMemoryMiB, cpuThreads }；設為 null 的項目會自動偵測；null 表示全部自動偵測（記憶體與 CPU 取自系統，Apple 晶片的 GPU 記憶體依統一記憶體估算）',
  'runtime.idleExitMinutes':
    '由 CLI 啟動的 Runtime 閒置多少分鐘後自行結束（1–1440）：沒有連線、沒有任務、沒有開啟中的對外服務。桌面應用程式結束時留在背景繼續執行的 Runtime，也會在任務完成這麼久後結束。其他 Runtime 不受影響',
  'updates.autoCheck': '自動檢查應用程式更新',
  'updates.autoDownload': '在背景下載新版本（不會自動安裝）',
  'diagnostics.enabled': '傳送匿名的使用統計與效能摘要（不含媒體、文字或路徑）',
  'offline.strict': '嚴格離線：不傳送任何內容到任何線上服務',
  'semantic.channels': '要建立語意索引的通道：text（講話內容：文稿、字幕、譯文、章節）；畫面（visual，每 8 秒一張關鍵影格，要裝多模態模型包，建得較慢）；聲音（audio）還不可用',
  'semantic.excludedProjects': '不建立語意索引的專案（專案 ID 清單）：所有 BaoCut 專案與不屬於專案的影片都會建立，除了這些；它們的影片仍可按字面找到',
  'semantic.folders': '專案以外的索引資料夾（{id, path} 清單）：裡面的影片與圖片出現在 Space 裡、按意思建立索引，唯讀。用 space.folderAdd 與 space.folderRemove 更改',
  'semantic.excludedVideos': '不建立語意索引的單一影片（影片 ID 清單），與排除的專案疊加；已建立的索引會撤下',
  'semantic.indexDir': '語意索引所在的資料夾（絕對路徑）；null 時放在應用程式快取裡。用 space.indexSetDir 更改，會移動或重新建立索引',
  'semantic.pauseOnBattery': '使用電池時暫停建立語意索引，接上電源後繼續（系統因過熱降頻時一律暫停）',
  'semantic.translationMemory': '翻譯時提示以前譯過的幾乎相同的句子（需要文字搜尋模型）',
  'semantic.glossaryCandidates': '從各份文稿裡幾乎相同的寫法提示術語候選（需要文字搜尋模型）',
};
