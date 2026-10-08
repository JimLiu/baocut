import type { SkillsMessages } from './skills-copy.ts';

export const zhHans: SkillsMessages = {
  skillsHelp: `用法：
  baocut skills add <文件夹>       把本地的 skill 文件夹（根目录有 SKILL.md）复制进 <BAOCUT_HOME>/skills，默认开着
  baocut skills import <地址>      从 GitHub 导入一个 skill：owner/repo、仓库地址或 …/tree/<分支>/<文件夹>；默认关着，看过再开
    --id <id>                      add 与 import 用：另给一个 id（默认由文件夹名得出；同 id 已存在时拒绝，不覆盖）
  baocut skills enable|disable <id>
                                   打开 / 关掉一个 skill：从下一个新开始的智能体会话起生效
  baocut skills remove <id>        删除一个添加或导入的 skill（内置的不能删，可以关掉）`,
  added: '已添加',
  imported: '已导入',
  turnedOn: '已打开',
  turnedOff: '已关掉',
  reviewFirst: (id) => `先看看内容（baocut skills read ${id}），再用 baocut skills enable ${id} 打开`,
  takesEffectNextSession: '从下一个新开始的智能体会话起生效；已在进行的会话不受影响',
  removed: (id, path) => `已删除 ${id}（${path}）`,
  localSource: (path, addedAt) => `本地文件夹 ${path}（${addedAt}）`,
  remoteSource: (url, ref, commit, importedAt) => `${url}（${ref}@${commit}，${importedAt}）`,
  changed: (verb, id, name, enabled, path, source) =>
    `${verb} ${id}（${name}，${enabled ? '开着' : '关着'}）→ ${path}${source ? `\n来源：${source}` : ''}`,
  idFormat: (flag, value) => `${flag} 要给 skill id（小写，连字符分隔，见 baocut skills）：${value}`,

  skillHelp: `用法：
  baocut skill install --agent <claude-code|codex|cursor|gemini> [--dir <目录>] [--link] [--yes]
                                   把给外部 Agent 的说明书（BaoCut 怎么用）装进宿主的 skills 目录的 baocut/：
                                   Claude Code ~/.claude/skills，Codex ~/.codex/skills，Cursor ~/.cursor/skills，
                                   Gemini CLI ~/.gemini/skills
    --dir <目录>                   换一个 skills 目录（装进它下面的 baocut/）；不给 --agent 时必须给
    --link                         渲染结果放在 <BAOCUT_HOME>/agent-skills/baocut，宿主里放指向它的链接：
                                   之后再装一次（任何宿主）就一起更新
    --yes                          目标已存在时替换它（是链接时只换链接，不动它指向的目录）；不给时不覆盖
  baocut skill path                说明书的来源目录与各宿主的安装位置、现在装了什么（不需要 Runtime）`,
  targetExists: (target, linkTarget) =>
    `${target} 已经存在（${linkTarget !== null ? `链接到 ${linkTarget}` : '目录或文件'}），没有改动；要替换就加 --yes`,
  installed: (target, files, linkTo) => `已把说明书装进 ${target}（${files} 个文件${linkTo ? `，链接到 ${linkTo}` : ''}）`,
  takesEffect: (host) => (host ? `新开一个 ${host} 会话后生效` : '新开一个会话后生效'),
  pathEscapes: (path) => `说明书里的路径越界：${path}`,
  sourceLine: (dir) => `来源      ${dir ?? '找不到（没有装 BaoCut，也不在仓库里；可设 BAOCUT_AGENT_SKILLS_DIR）'}`,
  notInstalled: '未安装',
  linkState: (target) => `链接 → ${target}`,
  installedFolder: '已安装（目录）',
  isFile: '是一个文件（不是 skill 目录）',
};
