import type { RcExternalToolsMessages } from './rc-external-tools.ts';

const WIN_ADMIN = '請以系統管理員身分開啟終端機並執行這條命令。';

export const zhHant: RcExternalToolsMessages = {
  manageOnlyInAppOrCli: '只能在桌面應用程式或 CLI 中管理外部工具',
  videoNotOpen: '影片尚未開啟',

  toolUpdating: (p) => `${p.label} 正在更新`,
  waitForUpdate: (p) => `請在更新任務 ${p.jobId} 結束後再試`,
  toolNotInstalled: (p) => `尚未安裝 ${p.label}`,
  toolCannotRun: (p) => `${p.label} 無法執行：${p.reason}`,
  toolOutdated: (p) => `${p.label} 版本過舊：${p.reason}`,
  consentRevoked: (p) => `已撤回使用 ${p.label} 的同意`,
  consentRequired: (p) => `使用 ${p.label} 前需要先取得使用者同意`,
  consentRemedy: (p) =>
    `請在使用者同意後再試：externalTools.consent（baocut external-tools consent ${p.name}），或在安裝時一併同意（externalTools.install 加上 consent: true）`,

  notExecutable: (p) => `${p.path} 不是執行檔`,
  notWindowsProgram: (p) => `${p.path} 不是 Windows 程式（.exe）：BaoCut 不會透過命令直譯器執行外部工具`,
  cannotRunAs: (p) => `${p.path} 無法作為 ${p.label} 執行：${p.reason}`,
  noVersion: '無法讀取版本',
  toolInUse: (p) => `${p.label} 正在安裝或正被任務使用`,
  notDownloadedByBaocut: (p) => `BaoCut 不會下載 ${p.label}：${p.remedy}`,
  downloadNeedsConsent: (p) => `下載 ${p.label} 需要使用者同意：請先確認來源、版本、大小和授權`,
  offlineStrictNoDownload: '嚴格離線模式下不會下載外部工具',
  cannotDownload: (p) => `無法下載 ${p.label}：${p.reason}`,
  manifestIncompleteRemedy: (p) => `請等待 BaoCut 更新清單，或自行安裝 ${p.label} 後用 externalTools.setPath 設定其路徑`,
  updateManagedCopy: (p) => `目前使用的 ${p.label} 是 BaoCut 下載的副本，因此不會透過其安裝程式更新`,
  updateUnknownInstall: (p) => `無法判斷 ${p.path} 是如何安裝的`,
  updateNoRunnable: (p) => `找不到可執行的 ${p.label}`,
  updateManagedRemedy: '用 externalTools.install 切換到清單中的版本',
  updateManualRemedy: '請依原本的安裝方式在終端機中更新，然後重新偵測（externalTools.detect）',
  cannotUpdateFor: (p) => `BaoCut 無法替你更新 ${p.label}`,
  runInTerminalRemedy: (p) => `請在終端機中執行 ${p.command}，然後重新偵測（externalTools.detect）`,
  confirmUpdateCommand: (p) => `更新 ${p.label} 前需要使用者先確認這條命令：${p.command}`,
  updateCommandChanged: (p) => `更新 ${p.label} 的命令已變更，請重新確認：${p.command}`,
  offlineStrictNoUpdate: '嚴格離線模式下不會更新外部工具',
  unknownTool: (p) => `沒有外部工具「${p.name}」`,
  notManaged: (p) => `BaoCut 不管理 ${p.label}：${p.remedy}`,
  endpointInvalid: '外部工具的下載來源不是有效的位址',
  endpointBadForm: '外部工具的下載來源必須是以 http(s):// 開頭的基礎位址，且不含憑證、查詢參數或片段識別碼',

  sourceEnvVar: (p) => `環境變數 ${p.name}`,
  sourceUserPath: '你設定的路徑',
  sourceManaged: 'BaoCut 下載的副本',
  commandNotFound: (p) => `找不到 ${p.command}`,
  commandNotFoundIn: (p) => `找不到 ${p.command}（搜尋位置：${p.where}）`,
  sourceNotExecutable: (p) => `指定的檔案不是執行檔（來源：${p.where}）`,
  sourceIsScript: (p) =>
    `來源（${p.where}）指向的是${p.batch ? '批次指令碼' : '指令碼'}，不是 Windows 程式（.exe）；BaoCut 不會透過命令直譯器執行外部工具`,
  setExePathRemedy: (p) => `請用 externalTools.setPath 設定 ${p.command}.exe 的路徑${p.canInstall ? '，或用 externalTools.install 下載' : ''}`,
  belowMinVersion: (p) => `${p.version} 低於最低版本 ${p.min}`,
  installOrUpdateRemedy: (p) => `用 externalTools.install 下載 ${p.version}，或更新系統上的 ${p.label}`,
  updateTool: (p) => `更新 ${p.label}`,

  diskFull: '寫入工具檔案時磁碟已滿',
  downloadedCannotRun: (p) => `下載的 ${p.label} 無法執行：${p.reason}`,
  updateStopped: '更新已停止',
  updateExited: (p) => `更新命令以 ${p.code} 結束`,
  updateTimedOut: (p) => `更新命令未在 ${p.minutes} 分鐘內完成，已停止`,
  updateSignalled: (p) => `更新命令被訊號 ${p.signal} 終止`,
  updateCannotStart: (p) => `無法啟動更新命令（${p.reason}）`,
  updateFailedRemedy: (p) => `請查看任務中的輸出，或在終端機中執行 ${p.command}，然後重新偵測`,

  remedyNoSpace: 'Runtime Home 所在的磁碟空間不足。請釋放空間後再安裝',
  remedyNetwork:
    '無法連線到網路或下載中斷。請檢查網路後再次安裝（已下載的部分會續傳），或在「設定 › 一般」的「工具下載來源」中切換鏡像站',
  remedyIntegrity:
    '下載的檔案與清單中的大小或 sha256 不符（來源或鏡像站的內容有誤）。損壞的檔案已刪除，請切換到其他下載來源後再安裝',
  remedySource:
    '下載來源沒有這個檔案或拒絕存取。請檢查「設定 › 一般」的「工具下載來源」（或環境變數 BAOCUT_TOOLS_ENDPOINT）所設定的鏡像站',
  downloadFailed: (p) => `下載 ${p.file} 失敗：${p.reason}`,
  integrityMismatch: (p) => `${p.file} 與清單中的大小或 sha256 不符`,
  sourceHttpStatus: (p) => `下載來源對 ${p.file} 傳回 HTTP ${p.status}`,
  largerThanManifest: (p) => `${p.file} 比清單中標示的還大`,

  ytDlpLicense: 'Unlicense（原始碼）；獨立執行檔包含 GPLv3+ 元件，整體為 GPLv3+',
  ytDlpPurpose: '從連結匯入：讀取影片頁面並下載媒體和字幕',
  ytDlpMissingRemedy: '用 externalTools.install（baocut external-tools install yt-dlp）下載，或自行安裝後用 externalTools.setPath 設定其路徑',
  ffmpegPurpose: '媒體分析、檔案轉檔、匯出，以及下載後合併音訊和影片',
  noReleaseForPlatform: (p) => `沒有適用於這台電腦（${p.platform}）的發行檔案`,
  noTrustedSha: '內建清單中還沒有這個檔案可信的 sha256，因此無法下載',

  probeCannotStart: (p) => `無法啟動：${p.error}`,
  probeTimeout: (p) => `${p.command} 未在 ${p.seconds} 秒內完成`,
  probeCannotStartCode: (p) => `無法啟動（${p.code}）`,
  probeExited: (p) => `以 ${p.code} 結束${p.detail ? `：${p.detail}` : ''}`,

  pipxMissing: (p) => `這個 ${p.label} 是用 pipx 安裝的，但 PATH 中找不到 pipx。`,
  brewMissing: (p) => `這個 ${p.label} 是用 Homebrew 安裝的，但找不到該 Homebrew 的 ${p.brew}。`,
  wingetMachineWide: (p) =>
    `這個 ${p.label} 是由 winget 為所有使用者安裝的（${p.dir}），更新需要系統管理員權限；BaoCut 不會替你提升權限。${WIN_ADMIN}`,
  wingetMissing: (p) => `這個 ${p.label} 是用 winget 安裝的，但 PATH 中找不到 winget。`,
  scoopGlobal: (p) => `這個 ${p.label} 是 Scoop 的全域安裝（${p.dir}），更新需要系統管理員權限；BaoCut 不會替你提升權限。${WIN_ADMIN}`,
  scoopMissing: (p) => `這個 ${p.label} 是用 Scoop 安裝的，但找不到 Scoop 本身（${p.script}）。`,
  chocolateyAdmin: `用 Chocolatey 安裝的程式需要系統管理員權限才能更新；BaoCut 不會替你提升權限。${WIN_ADMIN}`,
  pythonScriptMissing: '這個進入點指令碼所指向的 Python 直譯器已不存在。',
  pipAdmin: (p) => `這個 ${p.label} 安裝在 ${p.dir}，修改該位置需要系統管理員權限；BaoCut 不會替你提升權限。請依原本的安裝方式更新。`,
  pythonLauncherMissing: '這個進入點程式所指向的 Python 直譯器已不存在。',
  pipAdminWin: (p) => `這個 ${p.label} 安裝在 ${p.dir}，修改該位置需要系統管理員權限；BaoCut 不會替你提升權限。${WIN_ADMIN}`,
  standaloneAdmin: (p) => `這個 ${p.label} 所在的 ${p.dir} 需要系統管理員權限才能修改；BaoCut 不會替你提升權限。`,
  standaloneAdminWin: (p) => `這個 ${p.label} 所在的 ${p.dir} 需要系統管理員權限才能修改；BaoCut 不會替你提升權限。${WIN_ADMIN}`,
};
