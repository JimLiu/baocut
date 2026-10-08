import type { RcFontsMessages } from './rc-fonts.ts';

export const ja: RcFontsMessages = {
  manageOnlyInAppOrCli: 'フォントのダウンロード、削除、確認はデスクトップアプリまたは CLI でのみ行えます',
  catalogueInvalid: 'フォントカタログの形式が正しくありません',

  remedyNetwork:
    'ネットワークに接続できないか、ダウンロードが中断されました。ネットワークを確認して再ダウンロードするか、設定 › フォントの「スタイルシートの URL」と「フォントファイルの URL」でミラーを切り替えてください',
  remedySource:
    'フォントサービスがこのフォントのファイルを提供しませんでした。ファミリ名とウェイト、または設定のミラーアドレスを確認してください',
  remedyIntegrity:
    'ダウンロードしたものは使用できるフォントではありません（ファミリ名の不一致、読み取り不可、またはサイズ超過）。不正なファイルは削除しました。別のミラーに切り替えて再ダウンロードしてください',
  remedyNoSpace: 'Runtime Home があるディスクの空き容量が不足しています。空き容量を確保してから再ダウンロードしてください',

  diskFullWriting: (p) => `${p.what} の書き込み中にディスクがいっぱいになりました`,
  sourceHttpStatus: (p) => `フォントサービスが ${p.what} に対して HTTP ${p.status} を返しました`,
  downloadFailed: (p) => `${p.what} のダウンロードに失敗しました：${p.reason}`,
  overByteLimit: (p) => `${p.what} が上限の ${p.limit} バイトを超えています`,

  downloadCancelled: 'フォントのダウンロードはキャンセルされました',
  cancelled: 'ダウンロードはキャンセルされました',
  offlineStrict: '厳格オフラインモードではフォントをダウンロードしません',
  autoDownloadOff: 'フォントの自動ダウンロードはオフです（設定 › フォントの「フォントを自動でダウンロード」）',
  downloadFailedOutcome: (p) => `ダウンロードに失敗しました：${p.reason}`,
  notInCatalogue: (p) => `フォントカタログに「${p.family}」はありません`,
  noNeedToDownload: (p) =>
    `「${p.family}」は${p.bundled ? 'アプリに付属している' : 'このコンピュータにインストール済みの'}ため、ダウンロードは不要です`,
  inUseByExport: (p) => `「${p.family}」は完了していない書き出しで使用中です。書き出しが終わってから削除してください`,

  sampleLabel: (p) => `${p.family} のサンプル`,
  sampleCss: (p) => `${p.label} のスタイルシート`,
  noSampleBlock: (p) => `フォントサービスの応答に ${p.label} が含まれていません`,
  sampleNotOnHost: (p) => `${p.label} は設定されたフォントファイルのホスト上にありません`,
  sampleNotUsable: (p) => `ダウンロードした ${p.label} は使用できるフォントではありません`,

  faceLabel: (p) => `${p.family} ${p.weight}${p.italic ? ' イタリック' : ''}`,
  faceCss: (p) => `${p.label} のフォントスタイルシート`,
  noFaceBlock: (p) => `フォントサービスの応答に ${p.label} が含まれていません`,
  faceSplit: (p) => `フォントサービスが ${p.label} を文字単位のサブセットに分割しましたが、BaoCut はまだ結合できません`,
  faceNotOnHost: (p) => `${p.label} のファイルは設定されたフォントファイルのホスト上にありません`,
  faceNotUsable: (p) => `ダウンロードした ${p.label} は使用できるフォントではありません`,
  familyMismatch: (p) => `ダウンロードした ${p.label} のファミリ名が一致しません`,
};
