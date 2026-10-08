import type { RcWebMessages } from './rc-web.ts';

export const ja: RcWebMessages = {

  invalidAccessPath: 'アクセスリンクのパスは / で始まり、# を含まない必要があります',
  videoTargetNotFound: (p) => `動画「${p.videoId}」が見つかりません。videos list に表示される videoId を使ってください`,
  serviceLabel: 'Web サービス',
  runtimeNotReady: 'Runtime はまだ準備ができていません',
  clientNotBuilt:
    'Web クライアントがまだビルドされていません：先にリポジトリで npm run build:web を実行してください（または BAOCUT_WEB_DIST にビルド出力フォルダを指定）',
  browserSession: 'ブラウザセッション',
  noLevelOrScope:
    'Web サービスにはアクセスレベルや動画の範囲はありません：ブラウザでできることは readOnly と methods で制限してください',
  allowlistTooWide: (p: { methods: string }) =>
    `Web サービスの許可リストは既定のセットの範囲内でしか絞り込めません。含まれていないもの：${p.methods}`,
  listSeparator: '、',
  notRunning: 'Web サービスはオフです：先に開始してください（baocut services start web）',
  sessionNotFound: 'このブラウザセッションはありません',
  sessionExpired: 'ブラウザセッションの有効期限が切れました：BaoCut から新しいアクセスリンクを取得してください',
  loopbackOnly: 'ループバックアドレスのみ受け付けます',
  originRejected: 'Origin が受け付けられませんでした',
  loginFailed: 'サインインに失敗しました',
  loginRequired: 'BaoCut のアクセスリンクでサインインしてください',
  fileNotFound: 'このファイルはありません',
  readFailed: 'ファイルを読み取れませんでした',
  webReadOnly: (p: { method: string }) => `Web サービスは現在読み取り専用です：ブラウザから ${p.method} は呼び出せません`,
  methodNotAllowed: (p: { method: string }) =>
    `ブラウザから ${p.method} は呼び出せません：BaoCut のデスクトップアプリまたは CLI を使ってください`,
  toolMethodNotAllowed: (p: { method: string }) =>
    `ブラウザから ${p.method} は呼び出せません：このツールは BaoCut のデスクトップアプリまたは CLI で使ってください`,
  topicNotAllowed: (p: { topic: string }) => `ブラウザから ${p.topic} はサブスクライブできません`,
  projectNotRegistered:
    'ブラウザで開けるのは登録済みのプロジェクトか、既定のプロジェクトフォルダに新しく作成したプロジェクトのみです：ほかのフォルダは BaoCut のデスクトップアプリで開いてください',
  externalToolUnavailable: (p: { tool: string }) =>
    `外部ツール ${p.tool} は現在使用できません：BaoCut のデスクトップアプリで対処してください`,
  saveDirOutsideProject: 'ブラウザから結果を保存できるのは、登録済みのプロジェクトフォルダのみです',
  saveLocationOutsideProject:
    '保存先が登録済みのプロジェクトフォルダ内にないため、ブラウザではそこに書き込まれた結果を取得できません：BaoCut のデスクトップアプリで使用するか、設定 › 保存先をプロジェクトフォルダに変更してください',
  projectNotFound: 'プロジェクトが存在しません',
  fileMissing: 'ファイルが存在しません',
  importOutsideProject: 'ブラウザから追加できるのは、プロジェクトフォルダ内のファイルのみです',
  packageNotFound: 'ポータブルパッケージが存在しません',
  packageOutsideProject: 'ブラウザで開けるのは、プロジェクトフォルダ内のポータブルパッケージのみです',
  videoNotOpen: '動画が開いていません',
  videoProjectDirMissing: '動画のプロジェクトフォルダが存在しません',
  videoProjectMissing: '動画のプロジェクトが存在しません',
  operationOutsideProject: (p: { ordinal: number }) =>
    `操作 ${p.ordinal}：ブラウザで使えるのは、動画のプロジェクトフォルダ内のファイルのみです`,
  exportOutsideProject:
    'ブラウザから書き出せるのは、動画のプロジェクトフォルダ内のフォルダのみです（動画フォルダや .bcut は不可）',
  exportDirMissing: '書き出し先フォルダが存在しません',
  exportDirRecovery: 'すでに存在するフォルダを選んでください',
  loginTitle: 'BaoCut にサインイン',
  loginInstructions: (p: { launch: string; open: string }) =>
    `ターミナルで ${p.launch} を実行し、表示されたアクセスコードを下に貼り付けてください。または ${p.open} で表示されたアクセスリンクを開いてください。`,
  loginCodeOnce:
    'アクセスコードは 1 回だけ使え、2 分で期限切れになります。使用済みや期限切れの場合は新しいコードを取得してください。',
  accessCode: 'アクセスコード',
  signIn: 'サインイン',
  signingIn: 'サインイン中…',
  codeRejected:
    'このアクセスコードは間違っているか、使用済みか、期限切れです：ターミナルで baocut web open を実行して新しいコードを取得してください。',
  cannotReach: 'BaoCut に接続できません：BaoCut が実行中で、Web サービスが停止していないことを確認してください。',
  codeMalformed:
    'このアクセスコードの形式が正しくありません：ターミナルで baocut web open が表示した文字列を貼り付けてください。',
  fieldTooLong: (p: { field: string }) => `フィールド ${p.field} が長すぎます`,
  noNewlineAfterBoundary: '境界の後に改行がありません',
  junkAfterBoundary: '境界の後に余分な内容があります',
  partHeaderTooLong: 'パートのヘッダが長すぎます',
  partNoDisposition: 'パートに Content-Disposition: form-data がありません',
  singleFileOnly: 'アップロードできるファイルは 1 つのみです',
  tooManyFields: 'フィールドが多すぎます',
  bodyTruncated: 'リクエスト本文が終了境界の前で途切れました',
  requestAborted: 'リクエストが最後まで読み取られる前に切断されました',
  partHeaderMalformed: 'パートのヘッダの形式が正しくありません',
  imageTypeUnsupported: (p: { mimeType: string }) =>
    `非対応の添付ファイル形式: ${p.mimeType}`,
  imageSizeInvalid: "添付ファイルのサイズは正の整数（バイト）で指定してください",
  imageTooLarge: (p: { mb: number }) => `添付ファイルが大きすぎます。上限は ${p.mb} MB です`,
  uploadUrlNotFound: 'アップロード URL が存在しません',
  uploadUrlUsed: 'このアップロード URL はすでに使用されています',
  uploadUrlExpired: 'アップロード URL の有効期限が切れました：アップロードをもう一度登録してください',
  contentTypeMustBe: (p: { mimeType: string }) => `Content-Type は ${p.mimeType} にしてください`,
  contentLengthRequired: 'Content-Length が必要です',
  contentLengthMismatch: (p: { size: number }) => `Content-Length は登録したサイズ ${p.size} と同じにしてください`,
  uploadOverflow: '登録したサイズを超えました',
  uploadInterrupted: 'アップロードが中断されました',
  uploadIncomplete: (p: { received: number; size: number }) =>
    `受信したのは ${p.received} バイトのみです。登録したサイズは ${p.size} です`,
  attachmentNotFoundOrExpired: (p: { id: string }) => `添付ファイルが存在しないか、期限切れです：${p.id}`,
  attachmentNotUploaded: (p: { fileName: string }) => `添付ファイル「${p.fileName}」のアップロードが完了していません`,
  attachmentFileMissing: (p: { fileName: string }) => `添付ファイル「${p.fileName}」のファイルはもうありません`,
  attachmentNotFound: '添付ファイルが存在しません',
  fileNameLength: (p: { max: number }) => `ファイル名は 1〜${p.max} 文字にしてください`,
  fileNameInvalid: 'ファイル名にパスの区切り文字や制御文字を含めることはできません',
};
