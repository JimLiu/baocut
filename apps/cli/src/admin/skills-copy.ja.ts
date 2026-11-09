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
  baocut skill install [--dir <フォルダ>]… [--agent agents|claude] [--copy]
                                   外部エージェント向けの BaoCut スキル（BaoCut の使い方）をインストールします。既定では
                                   ~/.agents/skills/baocut（Codex などのエージェント）と ~/.claude/skills/baocut（Claude Code）に、
                                   BaoCut アプリ内のスキルへのシンボリックリンクとして置くので、アプリと一緒に更新されます
    --dir <フォルダ>               代わりに <フォルダ>/.agents/skills と <フォルダ>/.claude/skills に入れます。BaoCut の
                                   プロジェクトに限らず任意のフォルダで、複数指定できます
    --agent agents|claude          2 か所のうち 1 か所だけ：.agents/skills または .claude/skills
    --copy                         リンクではなくコピーします（コピーはアプリの更新に追従しないので、更新するには再インストール）
  baocut skill status              アプリのスキルのバージョン、インストール先と各場所が最新かどうか、ターミナルの baocut コマンド
  baocut skill remove [--dir <フォルダ>]… [--agent agents|claude] [--yes]
                                   削除します。リンクはリンクだけを消し、コピーの削除には --yes が必要です。
                                   baocut/ にある BaoCut スキル以外のものは置き換えも削除もしません`,
  installedAt: (path, linkTarget) => `インストールしました：${path}${linkTarget ? ` → ${linkTarget}` : '（コピー）'}`,
  takesEffect: '新しいエージェントセッションから有効になります',
  removedAt: (path) => `削除しました：${path}`,
  removeCopies: (paths) => `${paths.join('、')} はコピーです。削除するとファイルごと消え、そこで加えた編集も失われます。削除するには --yes を付けてください`,
  unknownAgent: (value) => `--agent には agents（.agents/skills）か claude（.claude/skills）を指定してください：${value}`,
  fixHint: '古いか壊れたインストールがあります。baocut skill install（同じ --dir を付けて）で直せます',
  statusSkill: (version, source, bundled) => `スキル    ${version ?? '?'}  ${source}${bundled ? '' : '（開発版：Runtime が生成）'}`,
  statusCli: (entry) => `CLI       ${entry ?? '同梱なし（開発版）'}`,
  statusOnPath: (path, target, fromApp) => `ターミナル ${path}${target ? ` → ${target}` : ''}${fromApp ? '（このアプリのもの）' : '（このアプリのものではありません）'}`,
  statusNotOnPath: (command) => `ターミナル PATH に baocut がありません${command ? `。どのターミナルでも使うには：${command}` : ''}`,
  appOutsideApplications: 'BaoCut が「アプリケーション」フォルダ以外から実行されています。アプリを移動または削除するとリンクが切れます',
  globalHeading: 'グローバル',
  state: { none: '未インストール', current: '最新', stale: '古い', broken: 'リンク切れ', foreign: '別のものがあります（触りません）' },
  mode: { link: 'リンク', copy: 'コピー' },

  cliHelp: `使い方：
  baocut cli install               baocut を PATH に置き、BaoCut アプリ内のコマンドラインを指すようにします。macOS：
                                   ~/.local/bin/baocut にシンボリックリンク。Windows：%LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd を
                                   置き、そのフォルダをユーザーの PATH に追加します。管理者権限は不要です
  baocut cli status                baocut の置き場所、このアプリを指しているか、ターミナルが実際に見つける baocut
  baocut cli remove                baocut cli install が置いたものを削除します。その場所にある BaoCut が置いたのではないものは
                                   置き換えも削除もしません`,
  cliStatusEntry: (path, target, state) => `エントリ   ${path}${target ? ` → ${target}` : ''} · ${state}`,
  cliStatusApp: (entry) => `アプリ     ${entry ?? '同梱のコマンドラインなし（開発版）：BaoCut アプリからインストールしてください'}`,
  cliStatusTerminal: (found) => `ターミナル ${found ?? 'baocut が見つかりません'}`,
  cliStatusUnchecked: 'ターミナル ターミナルの PATH を確認できませんでした。新しいターミナルを開いて baocut version を実行してください',
  cliShadowed: (found, dir) => `ターミナル 先に ${found} が見つかります。こちらを使うには、それを削除するか、${dir} を PATH のより前に置いてください`,
  cliPathHint: (dir, line, file) => `${dir} はまだターミナルの PATH にありません。次の行を ${file ?? 'シェルの設定ファイル'} に追加してから、新しいターミナルを開いてください：\n  ${line}`,
  cliInstalled: (path, target) => `インストールしました：${path} → ${target}`,
  cliWindowsPath: (dir) => `${dir} はユーザーの PATH に入っています。新しいターミナルを開くと baocut を使えます`,
  cliRemoved: (path) => `削除しました：${path}`,
  cliNothingToRemove: (path) => `${path} に削除するものはありません`,
  cliInstallHint: 'baocut cli install で baocut を PATH に置けます',
  cliFixHint: 'baocut cli install でこのアプリを指すように直せます',
  cliState: { none: '未インストール', current: 'このアプリを指しています', stale: '別の BaoCut を指しています', broken: 'もう存在しない場所を指しています', foreign: '別のものがあります（触りません）' },
};
