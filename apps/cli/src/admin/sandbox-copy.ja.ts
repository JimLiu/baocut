import type { SandboxMessages } from './sandbox-copy.ts';

export const ja: SandboxMessages = {
  help: `使い方：
  baocut sandbox create <フォルダ> [--link-accounts-from <home>]
                                   開発とテスト用に独立した Runtime ホームを用意します：そのフォルダと中の projects
                                   フォルダ、このチェックアウトの CLI をそのホームで実行する bin/baocut、shell を切り替える
                                   env.sh / env.ps1。もう一度実行するとこれらのファイルを更新します。リポジトリから実行した
                                   場合だけ使えます。既定の ~/.baocut は使えません
    --link-accounts-from <home>    そのホーム（通常は ~/.baocut）のモデルアカウントも読み取り専用でリンクします
                                   （baocut models accounts link --from と同じ）。呼び出しには実際のアカウントを使い、通常どおり課金されます`,
  defaultHome: (dir) => `${dir} は既定の Runtime ホームで、実際のデータがあります。サンドボックスには別のフォルダを選んでください`,
  needsSourceCli:
    'baocut sandbox create はリポジトリからのみ実行できます（node apps/cli/src/main.ts sandbox create …）。この CLI は BaoCut アプリの Runtime を起動し、その Runtime はすべてのホームで共有されるシステムのキーチェーンにキーを保存します。そこにサンドボックスを作ると実際のキーを上書きまたは削除するおそれがあります',
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY が ${entry} を指していて、その Runtime がキーをどこに保存するか分かりません。サンドボックスを作る前に解除してください`,
  notEmpty: (dir) => `${dir} にはすでにファイルがあり、BaoCut のホームでもありません。新しいフォルダか空のフォルダを選んでください`,
  notFolder: (dir) => `${dir} はフォルダではありません`,
  created: (dir) => `サンドボックスを用意しました：${dir}`,
  refreshed: (dir) => `サンドボックスを更新しました：${dir}`,
  projects: (dir) => `  プロジェクト  ${dir}`,
  cli: (file) => `  baocut        ${file}（このチェックアウトの CLI を実行）`,
  useHeader: 'shell で使うには：',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   （PowerShell）`,
  useNote:
    'その後、その shell の baocut と、そこから起動した Agent はサンドボックスを使います。ほかの shell は引き続き ~/.baocut を使います。この Runtime はキーをサンドボックス内のファイルに保存します',
  linkFailed: (dir) => `${dir} のサンドボックスは用意できましたが、アカウントのリンクに失敗しました：`,
};
