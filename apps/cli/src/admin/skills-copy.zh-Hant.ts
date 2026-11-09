import type { SkillsMessages } from './skills-copy.ts';

export const zhHant: SkillsMessages = {
  skillsHelp: `用法：
  baocut skills add <folder>       將本機的 Skill 資料夾（根目錄有 SKILL.md）複製到
                                   <BAOCUT_HOME>/skills，預設為開啟
  baocut skills import <source>    從 GitHub 匯入 Skill：owner/repo、儲存庫 URL，或
                                   …/tree/<branch>/<folder>；預設為關閉，請先審閱再開啟
    --id <id>                      用於 add 與 import：改用另一個 id（預設由資料夾名稱產生；
                                   id 已存在時會拒絕，絕不覆寫）
  baocut skills enable|disable <id>
                                   開啟／關閉 Skill：從下一個新的 Agent 對話開始生效
  baocut skills remove <id>        刪除新增或匯入的 Skill（內建的 Skill 無法刪除，只能關閉）`,
  added: '已新增',
  imported: '已匯入',
  turnedOn: '已開啟',
  turnedOff: '已關閉',
  reviewFirst: (id) => `請先審閱（baocut skills read ${id}），再用 baocut skills enable ${id} 開啟`,
  takesEffectNextSession: '從下一個新的 Agent 對話開始生效；進行中的對話不受影響',
  removed: (id, path) => `已刪除 ${id}（${path}）`,
  localSource: (path, addedAt) => `本機資料夾 ${path}（${addedAt}）`,
  remoteSource: (url, ref, commit, importedAt) => `${url}（${ref}@${commit}，${importedAt}）`,
  changed: (verb, id, name, enabled, path, source) =>
    `${verb} ${id}（${name}，${enabled ? '開啟' : '關閉'}）→ ${path}${source ? `\n來源：${source}` : ''}`,
  idFormat: (flag, value) => `${flag} 需要 Skill id（小寫，以連字號分隔，請見 baocut skills）：${value}`,

  skillHelp: `用法：
  baocut skill install [--dir <資料夾>]… [--agent agents|claude] [--copy]
                                   為外部 Agent 安裝 BaoCut 說明書（BaoCut 怎麼用）。預設裝到 ~/.agents/skills/baocut
                                   （Codex 等 Agent）與 ~/.claude/skills/baocut（Claude Code），是指向 BaoCut 應用程式內那份的
                                   符號連結，隨應用程式更新
    --dir <資料夾>                 改裝到 <資料夾>/.agents/skills 與 <資料夾>/.claude/skills：任意資料夾，不只 BaoCut 專案；
                                   可以給多個
    --agent agents|claude          兩處只裝一處：.agents/skills 或 .claude/skills
    --copy                         複製一份而不是符號連結（副本不隨應用程式更新，要再裝一次）
  baocut skill status              應用程式內建的說明書版本、裝在哪些位置、每處是否最新，以及終端機裡的 baocut 指令
  baocut skill remove [--dir <資料夾>]… [--agent agents|claude] [--yes]
                                   移除：符號連結只刪連結；刪副本要加 --yes。baocut/ 那裡不是 BaoCut 說明書的東西永不取代或刪除`,
  installedAt: (path, linkTarget) => `已安裝 ${path}${linkTarget ? ` → ${linkTarget}` : '（副本）'}`,
  takesEffect: '開啟新的 Agent 工作階段後生效',
  removedAt: (path) => `已移除 ${path}`,
  removeCopies: (paths) => `${paths.join('、')} 是副本：移除會刪掉這些檔案，包括在裡面改過的內容。要刪就加 --yes`,
  unknownAgent: (value) => `--agent 只接受 agents（.agents/skills）或 claude（.claude/skills）：${value}`,
  fixHint: '有些位置已過期或失效：執行 baocut skill install（帶上同樣的 --dir）即可修好',
  statusSkill: (version, source, bundled) => `說明書    ${version ?? '?'}  ${source}${bundled ? '' : '（開發版：由 Runtime 產生）'}`,
  statusCli: (entry) => `命令列    ${entry ?? '未隨附（開發版）'}`,
  statusOnPath: (path, target, fromApp) => `終端機    ${path}${target ? ` → ${target}` : ''}${fromApp ? '（就是這個應用程式的）' : '（不是這個應用程式的）'}`,
  statusNotOnPath: (command) => `終端機    PATH 裡沒有 baocut${command ? `；想在任何終端機使用：${command}` : ''}`,
  appOutsideApplications: 'BaoCut 不是從「應用程式」資料夾執行：移動或刪除應用程式後符號連結會失效',
  globalHeading: '全域',
  state: { none: '未安裝', current: '最新', stale: '已過期', broken: '連結失效', foreign: '已有其他東西（不動它）' },
  mode: { link: '符號連結', copy: '副本' },

  cliHelp: `用法：
  baocut cli install               把 baocut 放進 PATH，指向 BaoCut 應用程式內的命令列。macOS：在 ~/.local/bin/baocut 放符號連結；
                                   Windows：寫入 %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd，並把這個資料夾加入使用者的 PATH。
                                   不需要管理員權限
  baocut cli status                baocut 放在哪、是否指向這個應用程式，以及終端機實際會用哪個 baocut
  baocut cli remove                移除 baocut cli install 放的東西。那個位置上不是 BaoCut 放的東西永不取代或刪除`,
  cliStatusEntry: (path, target, state) => `入口      ${path}${target ? ` → ${target}` : ''} · ${state}`,
  cliStatusApp: (entry) => `應用程式  ${entry ?? '沒有內建命令列（開發版）：請在 BaoCut 應用程式裡安裝'}`,
  cliStatusTerminal: (found) => `終端機    ${found ?? '找不到 baocut'}`,
  cliStatusUnchecked: '終端機    查不出終端機的 PATH：開啟新的終端機，執行 baocut version 看看',
  cliShadowed: (found, dir) => `終端機    先找到的是 ${found}。想用這一個，請先移除它，或把 ${dir} 放到 PATH 中更前面的位置`,
  cliPathHint: (dir, line, file) => `${dir} 還不在終端機的 PATH 裡。把下面這行加入 ${file ?? 'shell 的設定檔'}，再開啟新的終端機：\n  ${line}`,
  cliInstalled: (path, target) => `已安裝 ${path} → ${target}`,
  cliWindowsPath: (dir) => `${dir} 已加入使用者的 PATH：開啟新的終端機就能使用 baocut`,
  cliRemoved: (path) => `已移除 ${path}`,
  cliNothingToRemove: (path) => `${path} 沒有要移除的東西`,
  cliInstallHint: 'baocut cli install 會把 baocut 放進 PATH',
  cliFixHint: 'baocut cli install 會讓它改指向這個應用程式',
  cliState: {
    none: '未安裝',
    current: '指向這個應用程式',
    stale: '指向另一份 BaoCut',
    broken: '指向的位置已經不存在',
    foreign: '已有其他東西（不動它）',
    standalone: '指向獨立的命令列套件，由它管理（baocut update；不動它）',
  },
};
