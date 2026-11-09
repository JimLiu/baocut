import type { StandaloneMessages } from './standalone-copy.ts';

export const ja: StandaloneMessages = {
  cliHelp: `使い方：
  baocut cli install               このコマンドラインパッケージを現在のユーザー用にインストールし、baocut を PATH に置きます。
                                   パッケージは ~/.local/share/baocut/versions/<バージョン>（Windows：
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<バージョン>）にコピーします。すでにあればコピーしません。
                                   macOS：~/.local/bin/baocut にシンボリックリンク。Windows：
                                   %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd を置き、そのフォルダをユーザーの PATH に追加します。
                                   管理者権限は不要です
  baocut cli status                baocut の置き場所、インストール済みのどのバージョンを指しているか、ターミナルが実際に
                                   見つける baocut
  baocut cli remove                baocut cli install が置いたものを削除します。インストール済みのバージョンは残ります。
                                   その場所にある BaoCut が置いたのではないものは置き換えも削除もしません`,
  help: `baocut update [--check | --rollback]

スタンドアロンのコマンドラインパッケージを更新します。BaoCut アプリと同じリリースフィードを読み、最新リリースの
コマンドラインパッケージをダウンロードして、サイズと sha256（macOS では署名と公証も）を確認し、現在のバージョンの
隣にインストールしてから、baocut がそれを指すようにします。前のバージョンは --rollback 用に残し、どの Runtime も
使っていない、それより古いバージョンは削除します。
  --check      新しいバージョンがあるかどうかだけを表示します
  --rollback   前のバージョンに戻します
すでに実行中の Runtime は、停止するまで古いバージョンのままです（baocut runtime stop）。
この方法で更新されるのはスタンドアロンパッケージだけです。BaoCut アプリは自身を更新し、Homebrew 版は brew upgrade を使います。
BAOCUT_UPDATE_APPCAST を設定すると、別のフィード（URL またはローカルファイル、テスト用）を読みます。`,
  version: (version, build) => `${version}（build ${build}）`,
  state: {
    none: '未インストール',
    current: '現在のバージョンを指しています',
    stale: '別の BaoCut を指しています',
    broken: 'もう存在しない場所を指しています',
    foreign: '別のものがあります（触りません）',
  },
  statusPackage: (version, root) => `パッケージ ${version}  ${root}`,
  statusVersions: (versions, root) => `バージョン ${versions.join('、')}  ${root}`,
  statusNoVersions: (root) => `${root} にはまだ何もインストールされていません：baocut cli install でこのパッケージをそこにコピーします`,
  currentMark: '（現在）',
  previousMark: '（ひとつ前）',
  copied: (dest, from) => `パッケージを ${dest} にコピーしました。${from} はもう必要ありません`,
  versionsKept: (dir) => `インストール済みのバージョンは ${dir} に残ります。削除するにはそのフォルダを削除してください`,
  entryTaken: (path) =>
    `${path} は BaoCut が置いたものではないため、そのままにします。自分で移動または削除してから、もう一度 baocut cli install を実行してください`,
  pathFailed: (dir) => `${dir} をユーザーの PATH に追加できませんでした。「システムのプロパティ → 環境変数」で追加してください`,
  copyFailed: (from, dest, detail) => `${from} を ${dest} にコピーできませんでした${detail ? `：${detail}` : ''}`,
  updateUsage: (token) => `baocut update には --check か --rollback のどちらか一方を指定します：${token}`,
  updateUnavailable:
    'baocut update はスタンドアロンのコマンドラインパッケージを更新します。この baocut は BaoCut アプリのもの（アプリが自身を更新します：BaoCut → 更新を確認）か、Homebrew のもの（brew upgrade --cask baocut）です',
  upToDate: (current) => `最新の状態です：${current}`,
  available: (latest, current) => `${latest} が利用できます（現在は ${current}）`,
  downloading: (version, build, megabytes) => `${version}（build ${build}、${megabytes} MB）をダウンロードしています…`,
  updated: (from, to) => `更新しました：${from} → ${to}`,
  rolledBack: (from, to) => `${from} から ${to} に戻しました`,
  rollbackHint: '元に戻すには：baocut update --rollback',
  entrySwitched: (path) => `${path} はこのバージョンを指すようになりました`,
  entryNotInstalled: (path) => `${path} はインストールされていません：baocut cli install で baocut を PATH に置けます`,
  entryLeftAlone: (path) =>
    `${path} はこのパッケージ以外を指しているため、そのままにしました：baocut cli install でここを指すようにできます`,
  removedVersions: (versions) => `古いバージョンを削除しました：${versions.join('、')}`,
  runtimeStillRunning: (pid) =>
    `Runtime（pid ${pid}）は起動したときのバージョンのまま実行中です。停止すると、次のコマンドで新しいバージョンが起動します（今すぐ停止するには baocut runtime stop）`,
  systemTooOld: (required, system) => `新しいバージョンには macOS ${required} が必要です。この Mac は ${system} です`,
  feedFailed: (url, detail) => `リリースフィード ${url} を読めませんでした：${detail}`,
  feedMissing: (url) => `リリースフィード ${url} にはまだコマンドラインパッケージがありません。次のリリース後にもう一度試してください`,
  downloadFailed: (url, detail) => `${url} をダウンロードできませんでした：${detail}`,
  verifyFailed: (detail) => `ダウンロードしたパッケージは確認に通らなかったため、インストールしませんでした：${detail}`,
  unsignedBuild:
    'このパッケージは署名されていないため、更新の署名を確認できません。代わりに BaoCut のリリースページからスタンドアロンパッケージをダウンロードしてください',
  noPrevious: (dir) => `${dir} には戻れる前のバージョンがありません`,
  inProgress: (pid) => `別の baocut update（pid ${pid}）が実行中です。終わるまで待ってください`,
};
