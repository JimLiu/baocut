import type { AgentSetupMessages } from './agent-setup-copy.ts';

export const ja: AgentSetupMessages = {
  badge: {
    'not-installed': '未インストール',
    error: '実行できません',
    outdated: 'バージョンが古い',
    'signed-out': 'サインインが必要',
    disabled: '無効',
  },
  badgeNotChecked: '未確認',
  badgeReady: '利用可能',
  badgeModelUpgrade: '利用可能 · 既定モデルにはアップグレードが必要',
  badgeModelUnavailable: '利用可能 · 既定モデルは利用不可',
  badgeUpdate: '利用可能 · 新しいバージョンあり',

  errorTitle: (name: string) => `${name} は見つかりましたが、実行できません`,
  errorBody: (detail: string | null) =>
    `${detail ? `${detail} ` : ''}Node.js がアンインストールまたはアップグレードされたか、ファイルの権限が変わった場合によく起こります。チェックを実行すると、失敗しているステップを特定できます。`,
  errorCta: 'チェックを実行',
  outdatedTitle: (name: string, version: string | null) =>
    version ? `${name} ${version} は古すぎるため、BaoCut から操作できません` : `このバージョンの ${name} は古すぎるため、BaoCut から操作できません`,
  outdatedBody: (detail: string | null, minVersion: string) =>
    `${detail ? `${detail} ` : `${minVersion} 以降が必要です。`}アップグレードで更新されるのはこのコマンドラインツールだけです。アカウントとツール自体の設定はそのまま残ります。`,
  outdatedCta: (version: string) => `${version} にアップグレード`,
  signedOutTitle: (name: string) => `${name} に再度サインインしてください`,
  signedOutBody: (name: string) =>
    `サインインは ${name} 専用のウインドウで行われ、BaoCut がアカウントやパスワードを扱うことはありません。サインインしたら、ここに戻って確認してください。`,
  signedOutCta: 'ターミナルを開いてサインイン',

  stepSkipped: '前のステップを通過すると確認します',
  stepFind: 'このコンピュータで見つかる',
  stepFindFail: (command: string) => `一般的なインストール場所にも PATH にも ${command} がありません`,
  stepRun: '起動できる',
  stepRunOk: (command: string, version: string) => `${command} --version が ${version} を返しました`,
  stepRunFail: '起動に失敗しました',
  stepVersion: 'BaoCut が対応するバージョン',
  stepVersionOk: (version: string, min: string) => `${version}、最低 ${min}`,
  stepVersionFail: (version: string, min: string) => `現在 ${version}、最低 ${min}`,
  stepLogin: 'アカウントにサインイン済み',
  stepLoginOk: 'サインイン済み',
  stepLoginFail: '未サインイン、またはサインインの有効期限切れと報告されています',
  stepModels: 'モデル一覧を取得できる',
  stepModelsOk: (n: number) => `モデル ${n} 個`,
  stepModelsNone: 'モデル一覧が報告されなかったため、セッションでは Agent の既定モデルを使います',
  verdictFail: (label: string, detail: string) => `「${label}」で止まっています：${detail}`,
  verdictOk: '5 つのチェックをすべて通過しました。セッションを始められます。',

  moreSummary: (names: string[], more: boolean) => names.join('、') + (more ? ' など' : ''),

  readyTitle: '準備完了',
  readyBody: (name: string, model: string, plan: string) =>
    `新しいセッションでは ${name} · ${model} を使います。このコンピュータにインストール済みの ${name} を、ご自身の ${plan} で実行します。BaoCut の追加料金はかかりません。`,
  readyCta: 'セッションを開始',
  attentionBody: (name: string) =>
    `このコンピュータにすでにインストールされているので、再インストールは不要です。原因と対処法は下の「${name}」の行にあります。`,
  attentionCta: '問題を見る',
  offTitle: (name: string) => `${name} はインストール済みですが、無効になっています`,
  offBody: '有効にすると、BaoCut からひと言で作業を任せられます。',
  offCta: (name: string) => `${name} を有効にする`,
  missingTitle: 'このコンピュータではまだ Agent が検出されていません',
  missingBodyMany: '下のどれか 1 つをインストールし、お持ちのアカウントでサインインしてください。すべてインストールする必要はありません。',
  missingBodyOne: '下の手順に従ってインストールし、お持ちのアカウントでサインインしてください。',

  logDropped: (n: number) => `…（それより前の ${n} 行は省略）`,
  doneNotDetected: (name: string) => `コマンドは完了しましたが、${name} はまだ検出されていません。別の場所にインストールされている場合は、場所を手動で指定できます。`,
  doneSignIn: (name: string, version: string) => `${name} ${version} を検出しました · 完了するには一度サインインしてください`,
  doneInstalled: (name: string, version: string) => `${name} ${version} を検出しました`,
  doneUpgraded: (name: string, version: string) => `${name} は ${version} になりました · モデル一覧を更新中`,

  tier: {
    balanced: { label: 'おすすめ', description: '文字起こし、翻訳、編集には十分です。高速で、サブスクリプションの使用枠も節約できます' },
    max: { label: '最高性能', description: '遅く、サブスクリプションの使用枠を多く使います。必要になることはまれです' },
    fast: { label: '最速', description: '字幕を数か所直すような小さな編集に向いています' },
  },
  agentDefaultModel: 'Agent の既定モデル',
  cliConfigGate: (model: string) => `CLI の設定に従う · ${model} には CLI のアップグレードが必要`,
  cliConfigModel: (model: string) => `CLI の設定に従う · ${model}`,
  cliConfig: 'CLI の設定に従う',
  modelMissing: '現在のモデル一覧にありません。新しいセッションはおすすめのモデルを使います',
  effort: {
    minimal: '最小',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '超高',
    max: '最大',
  },
  modelDefaultEffort: 'モデルの既定',
  modelDefaultEffortOf: (label: string) => `モデルの既定（${label}）`,

  rulesTitle: (n: number) => `常に許可するコマンド · ${n} 件`,
  rulesBody:
    'これらのルールは、セッションで「常に許可」を選んだときに作られたものです。削除すると、そのルールで操作が自動承認されなくなります。アクセスモードとほかのルールは引き続き適用されます。',
  rulesEmpty: '保存されたルールはまだありません。セッションの承認カードで「常に許可」を選ぶと、ここに表示されます。',
};
