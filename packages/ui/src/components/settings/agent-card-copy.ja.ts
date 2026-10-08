import { createElement, Fragment, type ReactNode } from 'react';
import type { AgentCardMessages } from './agent-card-copy.ts';

export const ja: AgentCardMessages = {
  runFailed: (message: string) => `実行できませんでした：${message}`,
  stopFailed: (message: string) => `停止できませんでした：${message}`,
  loginCommand: 'サインインコマンド',
  installCommand: 'インストールコマンド',
  upgradeCommand: 'アップグレードコマンド',
  linkLabel: 'リンク',
  terminalLogin: (command: string) => `ターミナルで ${command} を実行中 · サインインしたらここに戻ってください`,
  terminalRun: (command: string) => `ターミナルで ${command} を実行中 · 完了したらここに戻ってください`,
  terminalCopied: (label: string) => `ターミナルを開けませんでした。${label} をコピーしたので、ターミナルに貼り付けて実行してください。`,
  terminalManual: (command: string) => `ターミナルを開けませんでした。ターミナルで ${command} を実行してください。`,
  terminalFailed: (message: string) => `ターミナルを開けませんでした：${message}`,
  enableFailed: (message: string) => `有効にできませんでした：${message}`,
  disableFailed: (message: string) => `無効にできませんでした：${message}`,
  recheckFailed: (message: string) => `再確認できませんでした：${message}`,
  saveModelFailed: (message: string) => `既定モデルを保存できませんでした：${message}`,
  saveEffortFailed: (message: string) => `既定の推論強度を保存できませんでした：${message}`,
  refreshFailed: (message: string) => `モデルを更新できませんでした：${message}`,
  setDefaultFailed: (message: string) => `既定に設定できませんでした：${message}`,
  openFailed: (message: string) => `開けませんでした：${message}`,
  enabled: (name: string) => `${name} を有効にしました`,
  disabled: (name: string) => `${name} を無効にしました · 新しいセッションには表示されなくなります`,

  defaultBadge: '既定',
  subInstalled: (version: string | null, account: string | null) =>
    ['このコンピュータにインストール済み', version ? `v${version}` : null, account].filter(Boolean).join(' · '),
  subMissing: (command: string, plan: string) => `このコンピュータに ${command} が見つかりません · お持ちの ${plan} だけで使えます`,
  enable: (name: string) => `${name} を有効にする`,
  details: '詳細',
  install: 'インストール',
  checking: '確認中…',
  gateTitle: (name: string, model: string) => `${name} に設定された既定モデル ${model} には新しいバージョンが必要です`,
  gateBody: (version: string, model: string) =>
    `このコンピュータにあるのは ${version} で、このバージョンのモデル一覧には ${model} がありません。「Agent の既定モデル」にしたセッションは設定どおりこのモデルを使うため、送信すると拒否されます。モデルを指定したセッションには影響しません。`,
  gateUpgrade: 'アップグレードで更新されるのはこのコマンドラインツールだけです。アカウントとツール自体の設定はそのまま残ります。',
  gateNoUpgrade: 'アップグレードできる新しいバージョンはまだありません。当面はセッションで一覧からモデルを選んでください。',
  upgradeTo: (version: string) => `${version} にアップグレード`,
  updateStrip: (latest: string, current: string) => `バージョン ${latest} が利用できます（現在：${current}）。アップグレードしなくても引き続き使えます。`,
  viewUpgrade: 'アップグレード方法を見る',
  cancel: 'キャンセル',

  defaultModel: '既定モデル',
  defaultModelDesc:
    '新しいセッションはこのモデルで始まります。各セッションでも入力欄の下で切り替えられます。文字起こし、翻訳、編集なら「おすすめ」で十分で、最高性能のモデルは必要ありません。',
  defaultModelOf: (name: string) => `${name} の既定モデル`,
  defaultEffortOf: (name: string) => `${name} の既定の推論強度`,
  modelsOf: (name: string, count: number) => `${name} のモデル · ${count} 個`,
  modelsList: (list: string) => `${list}。確認のたびに更新されます。`,
  modelsNone: 'モデル一覧が報告されなかったため、セッションでは Agent の既定モデルを使います。次の確認時にもう一度問い合わせます。',
  refreshing: '更新中…',
  refreshModels: 'モデルを更新',
  refreshed: (name: string) => `${name} のモデル一覧を更新しました`,
  nowDefault: (name: string) => `新しいセッションで ${name} を使うようになりました`,
  version: (version: string | null) => (version ? `バージョン · v${version}` : 'バージョン'),
  versionDesc: (latest: string | null, min: string | null, source: string) =>
    `${latest ? `${latest} にアップグレードできます。` : ''}${min ? `BaoCut には ${min} 以上が必要です。` : ''}アップグレードで更新されるのはこのコマンドラインツールだけです。アカウントとツール自体の設定はそのまま残ります。${source}`,
  account: 'アカウント',
  accountDesc: (signedOut: boolean, account: string | null, plan: string) =>
    `${signedOut ? '未サインイン、またはサインインの有効期限切れです' : (account ?? 'サインイン済み')}。ご自身の ${plan} を使うため、BaoCut の追加料金はかかりません。サインインはターミナルで行います。`,
  loginInTerminal: 'ターミナルを開いてサインイン',
  switchAccount: 'アカウントを切り替え…',
  location: 'インストール場所',
  locationDesc: 'BaoCut はこのコンピュータにあるこのプログラムを直接呼び出し、別のコピーをインストールすることはありません。',
  realLocation: '実際の場所',
  setLocation: '場所を手動で指定',
  troubleshoot: 'トラブルシューティング',
  troubleshootDesc: 'インストール、バージョン、サインイン、モデル一覧を順にチェックし、どこで止まっているかを示します。',
  setDefault: '既定にする',
  runChecks: 'チェックを実行',

  sourceKnown: (label: string) =>
    `このコピーは「${label}」でインストールされているため、同じ方法でアップグレードしてください。ほかの方法ではこのコピーは更新されず、別のコピーがインストールされるだけです。`,
  sourceUnknown: 'インストールしたときと同じ方法でアップグレードしてください。',
  scriptInstall:
    'このコマンドは公式サイトからスクリプトをダウンロードして実行します。BaoCut はインターネット上のスクリプトを代わりに実行しません。コピーしてご自身でターミナルで実行してください。',
  scriptUpgrade: 'このコマンドは公式サイトからスクリプトをダウンロードして実行します。コピーしてご自身でターミナルで実行してください。',
  copyUpgrade: 'このコマンドをコピーしてターミナルで実行し、完了したらここに戻って再確認してください。',
  runnableHint: 'コマンドの左の ▶ をクリックするとここで実行でき、出力は下に表示されます。コピーしてご自身でターミナルで実行することもできます。',
  copyHint: '下のコマンドをコピーしてターミナルで実行してください。',
  installMethod: 'インストール方法',
  upgradeMethod: 'アップグレード方法',
  needs: (needs: string) => `このコンピュータに ${needs} が必要です。`,

  installIntro: (name: string, plan: string) =>
    `${name} はご自身のコンピュータにインストールするコマンドライン型の AI アシスタントで、お持ちの ${plan} でサインインします。BaoCut は呼び出すだけなので、追加料金はかからず、BaoCut に API キーを入力する必要もありません。`,
  stepInstall: 'このコンピュータにインストール',
  stepInstallOfficial: '公式の手順に従ってこのコンピュータにインストール',
  installOfficialBody: (command: ReactNode): ReactNode =>
    createElement(Fragment, null, '公式の手順に従ってインストールしてください。インストール後、ターミナルで ', command, ' を実行できるようになります。'),
  stepLogin: 'アカウントにサインイン',
  stepLoginBody:
    'インストール後、ターミナルで下のコマンドを実行し、表示に従ってブラウザでサインインしてください。サインインは専用のウインドウで行われ、BaoCut がアカウントやパスワードを扱うことはありません。',
  stepBack: 'ここに戻る',
  stepBackBody: 'インストールとサインインが検出されれば使えるようになります。',
  detecting: '確認中…',
  recheck: 'インストールしたので再確認',
  notDetected: 'インストールしたのに検出されませんか？',
  notDetectedBody:
    'BaoCut は PATH と一般的なインストール場所（Homebrew、npm のグローバルフォルダ、~/.local/bin）を探します。バージョンマネージャ（nvm、asdf、mise）でインストールしたものは別の場所にあることがあるため、手動で BaoCut に場所を指定できます。',
  diagnosisOf: (name: string) => `${name} のチェック結果`,
};
