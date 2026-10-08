import type { ToolsMessages } from './external-tools-copy.ts';

export const zhHant: ToolsMessages = {
  help: `用法：
  baocut external-tools [list]     外部工具（yt-dlp、ffmpeg）：狀態、版本、路徑、來源，
                                   以及你是否已同意使用
  baocut external-tools detect [name]
                                   重新偵測
  baocut external-tools install <name> [--yes]
                                   下載一份受管理的副本到 Runtime Home 的 tools/：先列出來源、版本、大小與
                                   授權條款，確認後下載並核對 sha256（--yes 表示你同意）。
                                   下載來源：tools.downloadEndpoint 設定與 BAOCUT_TOOLS_ENDPOINT 環境變數
  baocut external-tools update <name> [--yes]
                                   依原本的安裝方式（Homebrew、pipx、pip 或官方獨立程式）更新系統中的那一份：
                                   先列出要執行的完整指令，確認後由 Runtime 執行（--yes 表示確認），逐行印出
                                   輸出，完成後重新偵測。需要管理員權限的指令只會印出，請自行在終端機中執行
  baocut external-tools path <name> <file>|--clear
                                   使用你自行安裝的那一份（會先執行一次 --version 檢查）；--clear 移除指定的路徑
  baocut external-tools remove <name>
                                   刪除受管理的副本（不影響系統中的副本與指定的路徑）
  baocut external-tools consent <name> [--revoke]
                                   同意使用某個下載工具，或撤回同意（撤回後會拒絕從連結匯入）`,
  usage:
    '用法：baocut external-tools [list] | detect [name] | install <name> [--yes] | update <name> [--yes] | path <name> <file>|--clear | remove <name> | consent <name> [--revoke]',
  clearOrFile: '--clear 與檔案只能擇一',
  stateLabels: {
    installed: '已安裝',
    missing: '未安裝',
    outdated: '有可用更新',
    unavailable: '無法使用',
  },
  sourceLabels: {
    system: '系統 PATH',
    user: '指定的路徑',
    managed: 'BaoCut 下載的副本',
    env: '環境變數',
  },
  updateMethodLabels: {
    homebrew: 'Homebrew',
    pipx: 'pipx',
    pip: 'pip',
    standalone: '官方獨立版本',
    winget: 'winget',
    scoop: 'Scoop',
    chocolatey: 'Chocolatey',
  },
  statusHead: (name: string, state: string, version: string | null, source: string | null, purpose: string) =>
    `${name}  ${state}${version ? ` ${version}` : ''}${source ? `（${source}）` : ''}  ${purpose}`,
  pathLine: (path: string) => `  路徑：${path}`,
  userPathLine: (path: string) => `  指定的路徑：${path}`,
  managedLine: (version: string, path: string) => `  受管理的副本：${version}  ${path}`,
  consentLine: (label: string) => `  同意：${label}`,
  installingLine: (jobId: string) => `  安裝中：任務 ${jobId}`,
  updatingLine: (jobId: string) => `  更新中：任務 ${jobId}`,
  updateLine: (command: string, method: string, runnable: boolean) =>
    `  更新：${command}（${method}${runnable ? '' : '，請自行在終端機中執行'}）`,
  reasonLine: (reason: string) => `  原因：${reason}`,
  remedyLine: (remedy: string) => `  解決方式：${remedy}`,
  consentMissing: (name: string) => `尚未同意（使用前請先同意：baocut external-tools consent ${name}）`,
  consentVia: { agent: '透過 Agent 的核准', cli: '在 CLI 中', app: '在應用程式中' },
  consentGranted: (at: string, via: string) => `已同意（${at}，${via}）`,
  consentRevoked: (at: string) => `已撤回（${at}）`,
  noTools: '沒有已登錄的外部工具',
  cannotUpdate: (label: string, reason: string) => `無法替你更新 ${label}：${reason}`,
  runInTerminal: '請在終端機中執行：',
  redetect: (name: string) => `完成後再檢查一次：baocut external-tools detect ${name}`,
  updatePlanHead: (method: string, label: string, version: string | null) =>
    `將依原本的安裝方式（${method}）更新 ${label}${version ? ` ${version}` : ''}`,
  runLine: (command: string) => `  執行：${command}`,
  updatePrompt: (label: string) => `要在這台電腦上執行這個指令來更新 ${label} 嗎？[y/N] `,
  omittedLines: (n: number) => `…（省略 ${n} 行）`,
  updated: (label: string, before: string | null, after: string) => `已更新 ${label}：${before ?? '未知版本'} → ${after}`,
  upToDate: (label: string, version: string | null) => `${label} 已是最新版本${version ? `（${version}）` : ''}`,
  sizeEstimated: (size: string) => `約 ${size}（大小未知，為估計值）`,
  sizeAbout: (size: string) => `約 ${size}`,
  willDownload: (label: string, version: string) => `將下載 ${label} ${version}`,
  sourceLine: (url: string | null) => `  來源：${url ?? '（沒有適用於這台電腦的檔案）'}`,
  sizeLine: (size: string) => `  大小：${size}`,
  licenseLine: (license: string) => `  授權條款：${license}`,
  homepageLine: (url: string) => `  首頁：${url}`,
  sha256Line: (hash: string) => `  sha256：${hash}`,
  blockedLine: (reason: string) => `  無法下載：${reason}`,
  installPrompt: (label: string, version: string, size: string) => `要下載並使用 ${label} ${version}（${size}）嗎？[y/N] `,
  noExternalTool: (name) => `沒有名為「${name}」的外部工具`,
  alreadyInstalling: (jobId) => `已在安裝中（任務 ${jobId}），繼續顯示進度`,
  installDone: '安裝完成',
  notDownloadedByBaoCut: (label, remedy) => `BaoCut 不會下載 ${label}：${remedy ?? '請自行安裝'}`,
  cannotDownload: (label, reason) => `無法下載 ${label}：${reason}`,
  notTtyAgreeDownload: '不是在終端機中執行：使用者同意下載後，請加上 --yes',
  notTtyConfirmRun: '不是在終端機中執行：使用者確認執行後，請加上 --yes',
  notDownloaded: '未下載',
  notRun: '未執行',
  remedy: (remedy) => `解決方式：${remedy}`,
  partialDownloadKept: (name) => `已下載的部分會保留：執行 baocut external-tools install ${name} 即可續傳`,
  alreadyUpdating: (jobId) => `已在更新中（任務 ${jobId}），繼續顯示輸出`,
  managedCopy: (label, name) => `目前使用的 ${label} 是 BaoCut 下載的副本：請用 baocut external-tools install ${name} 切換版本`,
  unknownInstall: (file, name) =>
    `無法判斷 ${file} 的安裝方式：請在終端機中依原本的安裝方式更新，再執行 baocut external-tools detect ${name}`,
  noRunnableTool: (label, remedy) => `找不到可執行的 ${label}：${remedy}`,
  updateManual: (label, command) => `更新 ${label} 需要你自行在終端機中執行：${command}`,
  partialCommand: (name) => `指令可能只執行了一部分：請執行 baocut external-tools detect ${name} 查看目前的版本`,
};
