import type { StandaloneMessages } from './standalone-copy.ts';

export const zhHant: StandaloneMessages = {
  cliHelp: `用法：
  baocut cli install               為目前的使用者安裝這個命令列套件，並把 baocut 放進 PATH。套件會複製到
                                   ~/.local/share/baocut/versions/<版本>（Windows：%LOCALAPPDATA%\\BaoCut\\cli\\versions\\<版本>），
                                   已經在那裡時不複製。macOS：在 ~/.local/bin/baocut 放符號連結；Windows：寫入
                                   %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd，並把這個資料夾加入使用者的 PATH。不需要管理員權限
  baocut cli status                baocut 放在哪、指向已安裝的哪個版本，以及終端機實際會用哪個 baocut
  baocut cli remove                移除 baocut cli install 放的東西，已安裝的版本會保留。那個位置上不是 BaoCut 放的東西
                                   永不取代或刪除`,
  help: `baocut update [--check | --rollback]

更新獨立的命令列套件：讀取與 BaoCut 應用程式相同的發布來源，下載最新版本的命令列套件，核對大小與 sha256（macOS 上還會
核對簽章與公證），安裝在目前版本旁邊，再讓 baocut 指向它。上一版會保留給 --rollback 使用；更早的、已經沒有 Runtime
在用的版本會刪除。
  --check      只檢查有沒有新版本
  --rollback   回到上一版
已經在執行的 Runtime 停止之前仍使用舊版本（baocut runtime stop）。
只有獨立套件這樣更新：BaoCut 應用程式會自行更新，Homebrew 安裝的請用 brew upgrade。
設定 BAOCUT_UPDATE_APPCAST 可以改讀其他發布來源（網址或本機檔案，測試用）。`,
  version: (version, build) => `${version}（build ${build}）`,
  state: {
    none: '未安裝',
    current: '指向目前的版本',
    stale: '指向另一份 BaoCut',
    broken: '指向的位置已經不存在',
    foreign: '已有其他東西（不動它）',
  },
  statusPackage: (version, root) => `套件      ${version}  ${root}`,
  statusVersions: (versions, root) => `已安裝    ${versions.join('、')}  ${root}`,
  statusNoVersions: (root) => `${root} 裡還沒有已安裝的版本：baocut cli install 會把這個套件複製過去`,
  currentMark: '（目前）',
  previousMark: '（上一版）',
  copied: (dest, from) => `已把套件複製到 ${dest}；${from} 不再需要了`,
  versionsKept: (dir) => `已安裝的版本保留在 ${dir}：要刪除它們，請刪除這個資料夾`,
  entryTaken: (path) => `${path} 不是 BaoCut 放的，不動它。請自行移走或刪除，再執行 baocut cli install`,
  pathFailed: (dir) => `沒能把 ${dir} 加入使用者的 PATH：請在「系統內容 → 環境變數」中加入`,
  copyFailed: (from, dest, detail) => `沒能把 ${from} 複製到 ${dest}${detail ? `：${detail}` : ''}`,
  updateUsage: (token) => `baocut update 只接受 --check 或 --rollback（二選一）：${token}`,
  updateUnavailable:
    'baocut update 更新的是獨立的命令列套件。這個 baocut 屬於 BaoCut 應用程式，應用程式會自行更新（BaoCut → 檢查更新）；Homebrew 安裝的請用 brew upgrade --cask baocut',
  upToDate: (current) => `已是最新版本：${current}`,
  available: (latest, current) => `有新版本 ${latest}（目前是 ${current}）`,
  downloading: (version, build, megabytes) => `正在下載 ${version}（build ${build}），${megabytes} MB…`,
  updated: (from, to) => `已更新 ${from} → ${to}`,
  rolledBack: (from, to) => `已從 ${from} 回到 ${to}`,
  rollbackHint: '要回到上一版：baocut update --rollback',
  entrySwitched: (path) => `${path} 現在指向它`,
  entryNotInstalled: (path) => `${path} 尚未安裝：baocut cli install 會把 baocut 放進 PATH`,
  entryLeftAlone: (path) => `${path} 指向的不是這個套件，沒有改動它：baocut cli install 會讓它指向這裡`,
  removedVersions: (versions) => `已刪除更早的版本：${versions.join('、')}`,
  runtimeStillRunning: (pid) =>
    `有一個 Runtime（pid ${pid}）仍以啟動時的版本執行；它停止後，下一個命令會啟動新版本（baocut runtime stop 可以現在停止它）`,
  systemTooOld: (required, system) => `新版本需要 macOS ${required}，這台 Mac 是 ${system}`,
  feedFailed: (url, detail) => `沒能讀取發布來源 ${url}：${detail}`,
  feedMissing: (url) => `發布來源 ${url} 裡還沒有命令列套件：下一次發布之後再試`,
  downloadFailed: (url, detail) => `沒能下載 ${url}：${detail}`,
  verifyFailed: (detail) => `下載的套件沒有通過檢查，沒有安裝：${detail}`,
  unsignedBuild: '這個套件沒有簽章，無法核對更新的簽章。請改從 BaoCut 的發布頁面下載獨立套件',
  noPrevious: (dir) => `${dir} 裡沒有可以回去的上一版`,
  inProgress: (pid) => `另一個 baocut update（pid ${pid}）正在執行：請等它結束`,
};
