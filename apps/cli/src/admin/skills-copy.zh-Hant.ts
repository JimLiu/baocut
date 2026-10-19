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
  statusAddToPath: (dir) => `終端機    PATH 裡沒有 baocut；想在任何終端機使用，請把 ${dir} 加入使用者的 PATH`,
  appOutsideApplications: 'BaoCut 不是從「應用程式」資料夾執行：移動或刪除應用程式後符號連結會失效',
  globalHeading: '全域',
  state: { none: '未安裝', current: '最新', stale: '已過期', broken: '連結失效', foreign: '已有其他東西（不動它）' },
  mode: { link: '符號連結', copy: '副本' },
};
