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
  baocut skill install --agent <claude-code|codex|cursor|gemini> [--dir <folder>] [--link] [--yes]
                                   將供外部 Agent 使用的 BaoCut Skill（BaoCut 的使用方式）安裝到 Agent 的 Skills 資料夾中的
                                   baocut/：Claude Code ~/.claude/skills、Codex ~/.codex/skills、
                                   Cursor ~/.cursor/skills、Gemini CLI ~/.gemini/skills
    --dir <folder>                 改用另一個 Skills 資料夾（安裝到其下的 baocut/）；未指定 --agent 時必填
    --link                         將產生的 Skill 放在 <BAOCUT_HOME>/agent-skills/baocut，並在 Agent 中放置指向它的連結：
                                   之後再次安裝（任何 Agent）都會一併更新
    --yes                          目標已存在時取代它（若是連結，只取代連結，不動它指向的資料夾）；
                                   未加時不會覆寫任何內容
  baocut skill path                BaoCut Skill 的來源、各 Agent 的安裝位置，以及目前安裝了什麼
                                   （不需要 Runtime）`,
  targetExists: (target, linkTarget) =>
    `${target} 已存在（${linkTarget !== null ? `連結到 ${linkTarget}` : '資料夾或檔案'}），未做任何變更。加上 --yes 即可取代`,
  installed: (target, files, linkTo) => `已將 BaoCut Skill 安裝到 ${target}（${files} 個檔案${linkTo ? `，連結到 ${linkTo}` : ''}）`,
  takesEffect: (host) => (host ? `在新的 ${host} 對話中生效` : '在新的對話中生效'),
  pathEscapes: (path) => `BaoCut Skill 中的路徑指向其資料夾之外：${path}`,
  sourceLine: (dir) => `來源      ${dir ?? '找不到（未安裝 BaoCut，且不在儲存庫中；可設定 BAOCUT_AGENT_SKILLS_DIR）'}`,
  notInstalled: '未安裝',
  linkState: (target) => `連結 → ${target}`,
  installedFolder: '已安裝（資料夾）',
  isFile: '是檔案（不是 Skill 資料夾）',
};
