import type { DriversCommonMessages } from './drivers-common.ts';

export const ja: DriversCommonMessages = {
  executableMissing: (p) => `指定された ${p.command}（${p.path}）は存在しないか、実行できません。`,
  commandMissing: (p) => `${p.command} コマンドが見つかりません。${p.hint}。または、設定で場所を指定してください。`,
  commandNotFound: (p) => `${p.command} コマンドが見つかりません`,
  installItFirst: 'まずインストールしてください',
  versionFailed: (p) => `${p.command} --version が正常に終了しませんでした。`,
  outdated: (p) => `${p.name} ${p.version} は古すぎます。BaoCut には ${p.min} 以降が必要です。`,
  startFailed: (p) => `${p.name} を起動できませんでした：${p.error}`,
  openSessionFailed: (p) => `${p.name} のセッションを開けませんでした：${p.error}`,
  confinedUnsupported: (p) => `${p.name} は制限付きの単発呼び出しに対応していません`,
  resumeFailed: (p) =>
    `${p.name} のネイティブセッションを再開できませんでした${p.error ? `（${p.error}）` : ''}。新しいセッションを開始しました。Agent はこれまでの会話を参照できません。`,
  sessionClosed: (p) => `${p.name} のセッションは閉じられています`,
  sessionNotReady: (p) => `${p.name} のセッションはまだ準備ができていません`,
  turnInProgress: '前のターンがまだ終わっていません',
  modelSwitchFailed: (p) => `${p.name} をモデル ${p.model} に切り替えられませんでした：${p.error}`,
  timedOut: (p) => `${p.label} がタイムアウトしました（${p.seconds} 秒）`,
  unknownError: '不明なエラー',
  unknownReason: '不明な理由',
  imagePlaceholder: '[画像]',
  officialScript: '公式スクリプト',
};
