import type { RuntimeStorageCredentialsMessages } from './runtime-storage-credentials.ts';

export const ja: RuntimeStorageCredentialsMessages = {
  denied: 'アクセスが拒否されました',
  unavailable: '認証情報ストアを利用できません',
  unsupported: 'このプラットフォームはシステムのセキュアストレージに対応していません',
  internal: '認証情報の読み書き中にエラーが発生しました',
  problem: (p) => `${p.reason}：${p.message}`,
  fileWriteFailed: (p) => `認証情報ファイルに書き込めませんでした（${p.code}）`,
  fileUnreadable: (p) => `認証情報ファイルを読み取れないため、そのまま残しました（${p.code}）`,
  helperBadResponse: '認証情報ヘルパーが無効な応答を返しました',
  helperNotFound: '認証情報ヘルパーのプログラムが見つかりませんでした',
  helperTimedOut: (p) => `認証情報ヘルパーが ${p.seconds} 秒以内に応答しませんでした`,
  helperMissing: '認証情報ヘルパーのプログラムがありません',
  helperStartFailed: (p) => `認証情報ヘルパーを起動できませんでした（${p.code}）`,
  helperResponseTooLong: '認証情報ヘルパーの応答が長すぎます',
  helperExitedSilently: '認証情報ヘルパーが応答せずに終了しました',
  helperReportedError: '認証情報ヘルパーがエラーを報告しました',
  redacted: '[非表示]',
};
