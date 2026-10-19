import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const zhHant: ProjectSettingsMessages = {
  menuItem: '專案設定…',
  title: '專案設定',
  close: '關閉專案設定',
  done: '完成',
  loading: '正在檢查 git',
  loadFailed: (message: string) => `無法檢查 git：${message}`,

  gitHeading: 'git',
  gitLead: 'BaoCut 可以把影片的工作區快照提交到專案所在的 git 儲存庫。版本記錄不需要 git，不在儲存庫裡也照常可用。',
  branch: (name: string) => `分支 ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: '重新檢查',
  sentences: (first: string, second: string | null) => (second ? `${first}。${second}。` : `${first}。`),

  lightReady: '正常',
  lightPaused: (label: string) => `已暫停 · ${label}`,
  lightNotRepo: '不在 git 儲存庫裡',
  lightUnavailable: '找不到 git',
  lightError: 'git 執行失敗',
  pauseLocked: '儲存庫正被佔用',
  pauseMerge: '正在合併',
  pauseRebase: '正在重定基底',
  pauseCherryPick: '正在揀選',
  pauseRevert: '正在還原',
  pauseBisect: '正在二分搜尋',
  pauseDetached: 'HEAD 分離',
  pauseLocalConfig: '有本機過濾器',
  pauseLocalConfigChanged: '本機過濾器變了',

  pausedHeading: (label: string) => `提交已暫停：${label}`,
  pausedNote: '暫停期間，自動提交與「提交到 git」都會等待；開啟、編輯與版本記錄不受影響。',
  errorHeading: 'git 執行失敗',
  unavailableHeading: '找不到 git',

  lcEntry: '項目',
  lcValue: '要執行的命令或引入的檔案',
  lcExplain:
    '允許後，BaoCut 執行 git 時會照這些項目執行（例如 git-crypt 加密）。允許只記在這台電腦上，不寫進專案；項目或引入的檔案變了會再暫停。這不是信任這個資料夾：開啟、編輯與 Agent 都不受影響。',
  lcWeb: '這些項目只在 BaoCut 桌面應用程式的專案設定裡列出，也只能在那裡允許（或用 baocut projects git-allow）。暫停期間，開啟、編輯與版本記錄都不受影響。',
  allow: '允許',
  allowedTitle: '已允許這些本機過濾器',
  allowedText: '允許記在這台電腦上，不寫進專案。現在可以提交了。',
  allowFailed: '沒有允許',

  commit: '提交到 git',
  committing: '正在提交',
  commitDesc: (maxMiB: number) =>
    `只提交 BaoCut 的檔案：有修改的影片的工作區快照，以及不超過 ${maxMiB} MiB 的素材。專案裡的其他檔案和你已經暫存的修改維持原樣；BaoCut 不推送。`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `上次提交 ${commit} · ${auto ? '自動' : '手動'} · ${ago}`,
  lastFailed: (message: string) => `上次失敗：${message}`,
  committedTitle: '已提交到 git',
  committedText: (commit: string, files: number, videos: string[]) => `已提交 ${commit}：${files} 個檔案${videos.length ? `，${videos.join('、')}` : ''}。`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `「${name}」` : from === to ? `「${name}」版本 ${to}` : `「${name}」版本 ${from}–${to}`,
  unnamedVideo: '一部影片',
  nothingTitle: '沒有要提交的修改',
  nothingText: 'BaoCut 的檔案和上次提交時一樣。',
  commitFailed: '沒有提交',

  autoCommit: '自動提交',
  autoCommitDesc: '專案安靜滿 5 分鐘、關閉專案裡最後一部開啟的影片或結束 BaoCut 時提交一次。這台電腦上的所有專案共用這個設定。',

  initTitle: '初始化 git',
  initDesc: '在專案資料夾裡建立一個 git 儲存庫，之後可以把快照提交進去。',
  initWebNote: '要在 Runtime 所在電腦的資料夾裡建立儲存庫，只能在 BaoCut 桌面應用程式或 CLI（baocut projects git-init）裡操作。',
  initRefused: (why: string) => `這裡不提供初始化：${why}`,
  initRefusedNote: '需要的話，把影片放進一個單獨的專案資料夾再初始化。',
  refusalHome: '專案就是你的主目錄。在這裡建立儲存庫，主目錄下的所有資料夾在其他工具看來都會算進這個儲存庫。',
  refusalUserFolder: '專案是系統的標準使用者資料夾（例如桌面、文件、下載、影片、音樂、圖片）。在這裡建立儲存庫，裡面所有資料夾都會算進這個儲存庫。',
  refusalVolumeRoot: '專案是磁碟的根目錄。在這裡建立儲存庫，整個磁碟都會算進這個儲存庫。',
  refusalInsideRepo: '專案已經在一個 git 儲存庫裡。',
  initConfirmTitle: '在專案資料夾裡初始化 git？',
  initConfirmBody: (path: string) =>
    `在 ${path} 裡建立一個 git 儲存庫。BaoCut 的忽略規則寫在儲存庫自己的 .git/info/ 裡，不改動專案裡的檔案。不做第一次提交，也不推送。`,
  cancel: '取消',
  initDoneTitle: '已初始化 git',
  initDoneText: '還沒有提交。按「提交到 git」做第一次提交。',
  initFailed: '沒有初始化',

  recheckSame: '狀態沒有變',
  recheckReadyTitle: '可以提交了',
  recheckReadyText: '儲存庫不再暫停。',

  outsideHeading: '專案外的素材',
  outsideLead:
    '素材在專案資料夾外時，工作區快照記錄的是它的路徑（主目錄下的寫成 ~/ 開頭，其餘寫完整路徑）：提交或推送之後，別人拿到的只有路徑，沒有檔案。要連素材一起交給別人，請用可攜式套件。',

  stripLabel: '專案的 git',
  projectSettings: '專案設定',
};
