import type { RcGitMessages } from './rc-git.ts';

export const zhHant: RcGitMessages = {
  gitPurpose: '把專案裡 BaoCut 的檔案提交到 git（選用）',
  gitMissingRemedyMac: '安裝 git：在終端機裡執行 xcode-select --install 安裝命令列工具，或者用 Homebrew 安裝（brew install git）',
  gitMissingRemedyWin: '從 https://git-scm.com/download/win 安裝 Git for Windows',
  gitMissingRemedyLinux: '用系統的套件管理員安裝 git',
  xcodeStub: '命令列工具安裝好之前，/usr/bin/git 只會跳出安裝它們的提示',

  notRepo: '這個專案不在 git 儲存庫裡',
  initRemedy: '在專案資料夾裡執行 baocut projects git-init，或者在你想要儲存庫的位置自己執行 git init',
  initHome: 'BaoCut 不在使用者主目錄裡建立 git 儲存庫：那樣它底下的所有資料夾在其他工具看來都位在同一個儲存庫裡',
  initUserFolder: (p) => `BaoCut 不在系統的標準使用者資料夾（${p.path}）裡建立 git 儲存庫：那樣它底下的所有資料夾在其他工具看來都位在同一個儲存庫裡`,
  initVolumeRoot: 'BaoCut 不在磁碟區或磁碟機的根目錄建立 git 儲存庫',
  initInsideRepo: '這個專案已經在一個 git 儲存庫裡',
  initElsewhere: '先把專案放進單獨的資料夾，或者在你想要儲存庫的位置自己執行 git init',
  pausedLocked: '儲存庫正被另一個 git 命令佔用（存在 index.lock）',
  lockedRemedy: '等另一個 git 命令結束。BaoCut 下次提交時再試，從不刪除鎖定檔；沒有 git 命令在執行時，請自己刪掉鎖定檔',
  pausedMerge: '儲存庫正在合併中',
  pausedRebase: '儲存庫正在重定基底中',
  pausedCherryPick: '儲存庫正在揀選中',
  pausedRevert: '儲存庫正在還原中',
  pausedBisect: '儲存庫正在二分搜尋中',
  pausedDetached: 'HEAD 處於分離狀態（儲存庫不在任何分支上）',
  repoStateRemedy: '在 git 裡完成或放棄這個操作，之後 BaoCut 恢復提交',
  detachedRemedy: '在 git 裡切換到一個分支，之後 BaoCut 恢復提交',
  pausedLocalConfig: '儲存庫的本機設定會執行程式或引入別的檔案（過濾器或 include），所以 BaoCut 不執行會讀取你檔案的 git 命令',
  pausedLocalConfigChanged: '儲存庫的本機過濾器或 include 在你允許之後改過了，所以 BaoCut 重新暫停了代為提交',
  localConfigRemedy: '查看這些項目和它們要執行的命令，然後用 baocut projects git-allow 允許',
  gitFailed: (p) => `git 在這個儲存庫裡執行失敗：${p.detail}`,

  manageOnlyInAppOrCli: '只有桌面應用程式或 CLI 能初始化 git、允許本機過濾器',
  digestChanged: '查看之後本機設定又改了，請重新查看這些項目',
  commitFailed: (p) => `提交到 git 失敗：${p.detail}`,
  initFailed: (p) => `初始化 git 失敗：${p.detail}`,

  commitSummary: (p) => `把專案「${p.name}」裡 BaoCut 的檔案提交到 git`,
  commitTitle: (p) => `BaoCut：更新 ${p.names}`,
};
