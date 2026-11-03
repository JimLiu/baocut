import type { SystemAccessMessages } from './system-access-copy.ts';

export const ja: SystemAccessMessages = {
  cardTitle: (names) => `BaoCut に ${names} の Cookie の読み取りを許可`,
  cardBody: "macOS では先に BaoCut に「フルディスクアクセス」を許可する必要があります。「システム設定を開く」を押すと、BaoCut がそのページを直接開きます。BaoCut はチェックしたブラウザだけを読み取り、他のファイルは読みません。",
  openedTitle: "システム設定で BaoCut をオンにして、ここに戻ってください",
  openedBody: "BaoCut の横のスイッチをオンにします。macOS が BaoCut の終了と再度の起動を尋ねたら「終了して再度開く」を選びます。一覧に BaoCut がない場合は、一覧の下の「+」で追加します。再起動が案内されない場合は、下の「BaoCut を再起動」を押してください。",
  open: "システム設定を開く",
  openAgain: "もう一度システム設定を開く",
  restart: "BaoCut を再起動",
  askTitle: (names) => `先に ${names} の Cookie へのアクセスを許可しますか？`,
  askBody: (names) => `このダウンロードは ${names} のログイン状態を使います。macOS で先に BaoCut に「フルディスクアクセス」を許可する必要があります。システム設定でオンにしてからダウンロードし直すか、今回は見送って他のブラウザで続けます。`,
  skip: "今回は見送る",
  settingLabel: "フルディスクアクセス",
  settingAllowed: "許可されています。BaoCut は外付けドライブ、デスクトップ、書類、ダウンロードのファイルと Safari の Cookie を読めますが、読むのは選んだ素材、保存先、チェックしたブラウザだけです。",
  settingMissing: "許可されていません。macOS は既定で、アプリが外付けドライブ、デスクトップ、書類、ダウンロードのファイルと Safari の Cookie を読むことを制限します。許可すると、これらの場所で権限により失敗することがなくなります。読むのは選んだ素材、保存先、チェックしたブラウザだけです。",
  openFailed: "システム設定を開けませんでした。「システム設定 › プライバシーとセキュリティ › フルディスクアクセス」を自分で開いてください。",
};
