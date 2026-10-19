import type { ProjectsMessages } from './projects-copy.ts';

export const zhHant: ProjectsMessages = {
  help: `用法：
  baocut projects git-status [<專案>]
                                   專案的 git 狀態：儲存庫、分支、BaoCut 能不能代為提交、為什麼暫停
                                   （提交用 baocut projects git-commit）
  baocut projects git-init [<專案>]
                                   在專案資料夾初始化 git（不在使用者主資料夾、系統的標準使用者資料夾、磁碟區的根目錄，
                                   也不在別的儲存庫裡面）
  baocut projects git-allow [<專案>] [--yes]
                                   列出儲存庫本機設定裡的篩選器與 include，再允許它們：之後 BaoCut 才執行會執行它們的 git 命令
  <專案> 是專案 ID、名稱或資料夾；不給時用包含目前資料夾的專案`,
  noProject: (cwd) => `沒有包含 ${cwd} 的專案。請給出專案 ID、名稱或資料夾（baocut projects list）`,
  unknownProject: (text) => `沒有這個專案：${text}（baocut projects list）`,
  ambiguousProject: (text) => `有不只一個專案叫 ${text}，請改用它的 ID`,
  states: {
    ready: '就緒',
    paused: '已暫停',
    'not-repo': '不在 git 儲存庫裡',
    unavailable: 'git 無法使用',
    error: '出錯',
  },
  head: (name, id) => `專案 ${name}（${id}）`,
  state: (state) => `Git：${state}`,
  branch: (branch) => `分支：${branch}`,
  detached: '分支：（HEAD 分離）',
  version: (version) => `git 版本：${version}`,
  repo: (root) => `儲存庫：${root}`,
  autoCommit: (on) => `自動提交：${on ? '開' : '關'}`,
  lastCommit: (commit, auto, at) => `最近一次提交：${commit.slice(0, 12)}（${auto ? '自動' : '手動'}，${at}）`,
  lastError: (message) => `最近一次失敗：${message}`,
  entriesHead: '本機篩選器與 include：',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  （${file}）` : ''}`,
  allowHint: '查看之後，執行 baocut projects git-allow 允許它們',
  initDone: (root) => `已在 ${root} 初始化 git`,
  nothingToAllow: '這個儲存庫沒有等待允許的本機篩選器或 include',
  allowPrompt: '允許這些項目嗎？之後 BaoCut 會執行執行它們的 git 命令 [y/N] ',
  notTtyAllow: '不在終端機裡：先用 baocut projects git-status 查看項目，再加 --yes 重新執行',
  notAllowed: '沒有允許：BaoCut 在這個儲存庫的代為提交保持暫停',
  allowed: '已允許：BaoCut 恢復在這個儲存庫代為提交',
};
