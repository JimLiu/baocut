import type { SkillsMessages } from './skills-copy.ts';

export const ja: SkillsMessages = {
  skillsHelp: `使い方：
  baocut skills add <folder>       ローカルの Skill フォルダ（最上位に SKILL.md があるもの）を
                                   <BAOCUT_HOME>/skills にコピー。既定でオン
  baocut skills import <source>    GitHub から Skill を読み込む：owner/repo、リポジトリの URL、または
                                   …/tree/<branch>/<folder>。既定でオフなので、内容を確認してからオンにしてください
    --id <id>                      add と import 用：別の id を使う（既定はフォルダ名から決定。
                                   同じ id がある場合は拒否し、上書きしません）
  baocut skills enable|disable <id>
                                   Skill をオン／オフにする：次に新しく始める Agent セッションから反映
  baocut skills remove <id>        追加または読み込んだ Skill を削除（内蔵のものは削除できず、オフにするだけです）`,
  added: '追加しました',
  imported: '読み込みました',
  turnedOn: 'オンにしました',
  turnedOff: 'オフにしました',
  reviewFirst: (id) => `まず内容を確認し（baocut skills read ${id}）、baocut skills enable ${id} でオンにしてください`,
  takesEffectNextSession: '次に新しく始める Agent セッションから反映されます。進行中のセッションには影響しません',
  removed: (id, path) => `${id} を削除しました（${path}）`,
  localSource: (path, addedAt) => `ローカルフォルダ ${path}（${addedAt}）`,
  remoteSource: (url, ref, commit, importedAt) => `${url}（${ref}@${commit}、${importedAt}）`,
  changed: (verb, id, name, enabled, path, source) =>
    `${verb}：${id}（${name}、${enabled ? 'オン' : 'オフ'}）→ ${path}${source ? `\n入手元：${source}` : ''}`,
  idFormat: (flag, value) => `${flag} には Skill の id（小文字、ハイフン区切り。baocut skills を参照）を指定してください：${value}`,

  skillHelp: `使い方：
  baocut skill install --agent <claude-code|codex|cursor|gemini> [--dir <folder>] [--link] [--yes]
                                   外部 Agent 向けの BaoCut Skill（BaoCut の使い方）を、ホストの skills フォルダ内の
                                   baocut/ にインストール：Claude Code ~/.claude/skills、Codex ~/.codex/skills、
                                   Cursor ~/.cursor/skills、Gemini CLI ~/.gemini/skills
    --dir <folder>                 別の skills フォルダを使う（その下の baocut/ にインストール）。--agent がない場合は必須
    --link                         生成した Skill を <BAOCUT_HOME>/agent-skills/baocut に置き、ホストにはそこへのリンクを
                                   置く：あとで（どのホストでも）もう一度インストールすると、すべて更新されます
    --yes                          インストール先がすでにある場合は置き換え（リンクの場合はリンクだけを置き換え、
                                   リンク先のフォルダはそのまま）。指定しないと何も上書きしません
  baocut skill path                BaoCut Skill の入手元、各ホストでのインストール先、現在インストールされているもの
                                   （Runtime は不要）`,
  targetExists: (target, linkTarget) =>
    `${target} はすでに存在します（${linkTarget !== null ? `${linkTarget} へのリンク` : 'フォルダまたはファイル'}）。何も変更していません。置き換えるには --yes を付けてください`,
  installed: (target, files, linkTo) =>
    `BaoCut Skill を ${target} にインストールしました（${files} 個のファイル${linkTo ? `、${linkTo} にリンク` : ''}）`,
  takesEffect: (host) => (host ? `新しい ${host} セッションで反映されます` : '新しいセッションで反映されます'),
  pathEscapes: (path) => `BaoCut Skill 内のパスがフォルダの外を指しています：${path}`,
  sourceLine: (dir) =>
    `入手元    ${dir ?? '見つかりません（BaoCut がインストールされておらず、リポジトリ内でもありません。BAOCUT_AGENT_SKILLS_DIR を設定できます）'}`,
  notInstalled: '未インストール',
  linkState: (target) => `リンク → ${target}`,
  installedFolder: 'インストール済み（フォルダ）',
  isFile: 'ファイル（Skill フォルダではありません）',
};
