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
  baocut skill install [--dir <文件夹>]… [--agent agents|claude] [--copy]
                                   给外部 Agent 装 BaoCut 说明书（BaoCut 怎么用）。默认装到 ~/.agents/skills/baocut
                                   （Codex 等 Agent）与 ~/.claude/skills/baocut（Claude Code），是指向 BaoCut 应用里那份的软链接，
                                   随应用更新
    --dir <文件夹>                 改装到 <文件夹>/.agents/skills 与 <文件夹>/.claude/skills：任意文件夹，不只是 BaoCut 项目；
                                   可以给多个
    --agent agents|claude          两处只装一处：.agents/skills 或 .claude/skills
    --copy                         复制一份而不是软链接（副本不随应用更新，要再装一次）
  baocut skill status              应用自带的说明书版本、装在哪些位置、每处是不是最新，以及终端里的 baocut 命令
  baocut skill remove [--dir <文件夹>]… [--agent agents|claude] [--yes]
                                   移除：软链接只删链接；删副本要加 --yes。baocut/ 那里不是 BaoCut 说明书的东西永不替换或删除`,
  installedAt: (path, linkTarget) => `已装好 ${path}${linkTarget ? ` → ${linkTarget}` : '（副本）'}`,
  takesEffect: '新开一个 Agent 会话后生效',
  removedAt: (path) => `已移除 ${path}`,
  removeCopies: (paths) => `${paths.join('、')} 是副本：移除会删掉这些文件，包括在里面改过的内容。要删就加 --yes`,
  unknownAgent: (value) => `--agent 只认 agents（.agents/skills）或 claude（.claude/skills）：${value}`,
  fixHint: '有的位置过期或失效了：baocut skill install（带上同样的 --dir）就能修好',
  statusSkill: (version, source, bundled) => `说明书    ${version ?? '?'}  ${source}${bundled ? '' : '（开发版：由 Runtime 渲染）'}`,
  statusCli: (entry) => `命令行    ${entry ?? '未随包（开发版）'}`,
  statusOnPath: (path, target, fromApp) => `终端      ${path}${target ? ` → ${target}` : ''}${fromApp ? '（就是这个应用的）' : '（不是这个应用的）'}`,
  statusNotOnPath: (command) => `终端      PATH 里没有 baocut${command ? `；想在任何终端里用：${command}` : ''}`,
  statusAddToPath: (dir) => `终端      PATH 里没有 baocut；想在任何终端里用，把 ${dir} 加进用户的 PATH`,
  appOutsideApplications: 'BaoCut 不是从「应用程序」文件夹运行的：移动或删除应用后软链接会失效',
  globalHeading: '全局',
  state: { none: '未安装', current: '最新', stale: '过期', broken: '链接失效', foreign: '已有别的东西（不动它）' },
  mode: { link: '软链接', copy: '副本' },
};
