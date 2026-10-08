import type { RcSpaceMessages } from './rc-space.ts';

export const ja: RcSpaceMessages = {
  dirUnreadable: (p) => `フォルダを読み取れませんでした（${p.code}）`,
  tooManyDirEntries: (p) => `フォルダの項目が ${p.max} 個を超えているため、一部のみを表示しています`,
  tooManyFiles: (p) => `ファイルが ${p.max} 個を超えているため、一部のみを表示しています`,

  entryGone: 'この項目はもう Space にありません',
  trashVideoUseDelete: '動画を削除するには videos.delete を使ってください',
  restoreVideoUseRestore: '削除した動画を復元するには videos.restore を使ってください',
  videoDeletedRestoreFirst: 'この動画は削除されています。先に復元してください',
  videoDeleted: 'この動画は削除されています',
  notInSourceDir: 'この項目はプロジェクトやセッションのフォルダにありません',
  stillGeneratingNoFile: 'まだ生成中のため、ファイルがありません',
  noReadableFile: 'この項目には読み取れるファイルがありません',
  entryStillGeneratingNoFile: 'この項目はまだ生成中のため、ファイルがありません',
  entryInTrash: 'この項目はゴミ箱にあります。先に復元してください',
  entryKindNotAccepted: (p) => `${p.kind} の項目はここでは使用できません`,
  notVideo: 'この項目は動画ではありません',

  projectNotFound: 'プロジェクトが存在しません',
  needAbsolutePath: 'ファイルの絶対パスを指定してください',
  fileNotFound: 'ファイルが存在しません',
  unrecognizedFileType:
    'このファイルの種類を判別できません。追加できるのは動画、画像、音声、字幕、ドキュメントのファイルのみです',
  projectDirNotFound: 'プロジェクトフォルダが存在しません',
  hiddenDirFile: '隠しフォルダや依存関係のフォルダにあるファイルは追加できません',
  videoDirFile: '動画フォルダ内のファイルは動画が管理しているため、単独では追加できません',
  tooManySameName: 'プロジェクトの imports/ に同じ名前のファイルが多すぎます',

  purgeVideoDeleteFirst:
    '先に動画を削除して（videos.delete）ゴミ箱に移動してから、ゴミ箱から完全に削除してください',
  purgeTaskRunning: 'タスクはまだ実行中です。先にキャンセルしてください（jobs.cancel）',
  purgeNotTrashed: '先にゴミ箱に移動してから、ゴミ箱から削除してください',
  videoSourceGone: 'この動画のソースはもうありません',
  refRunningTaskUsesVideo: (p) => `実行中のタスク ${p.jobId} がこの動画を使用しています`,
  refTaskAwaitsDecision: (p) =>
    `タスク ${p.jobId} に、この動画に追加するかどうかの判断を待っている結果があります`,
  refStrayFiles: (p) =>
    `動画フォルダに、動画が管理していないファイルがあります（${p.names.split('/').join('、')}${p.total > 3 ? `、計 ${p.total} 個` : ''}）。動画を復元し、それらを移動してから削除してください`,
  refRunningTaskUsesOutput: (p) => `実行中のタスク ${p.jobId} がこの生成物を使用しています`,
  refVideoUnreadable: (p) =>
    `動画 ${p.dir} を現在読み取れない（またはインデックスを更新中の）ため、このファイルを使用していないことを確認できません`,
  refVideoAssetLinks: (p) => `動画「${p.video}」の素材「${p.asset}」がこのファイルにリンクしています`,

  importedFileGone: '追加したファイルはもうプロジェクトフォルダにありません',
  resultNotApplied: '結果は動画に適用されませんでした',
  taskNotFinished: 'タスクが完了しませんでした',
  outputFileGone: '生成物のファイルはもうありません',
  exportedFileGone: '書き出したファイルはもうありません',
  labelSynthesizeSpeech: '合成した音声',
  labelGenerateImage: '生成した画像',
  labelGenerateText: '生成したテキスト',
  labelExport: '書き出し',

  engineUnavailable: '動画エンジンを使用できません',
  continueFromTrash: 'ゴミ箱にある項目は続きに使えません。先に復元してください',
  conversationCantSee:
    'このセッションからはこの項目が見えません。プロジェクトに属する項目は、同じプロジェクトのセッションに入れてください',
  serviceUsesMcp: '外部サービスは MCP ツールを通じて Space にアクセスします',
  materialTextOnly: (p) =>
    `読み取れるのは .txt と .md のドキュメント、.srt と .vtt の字幕のテキストのみです：${p.fileName}`,
  materialTooLarge: (p) => `${p.fileName} は ${p.bytes} バイトで、資料の上限 ${p.limit} を超えています`,
  afterMaterial: (p) => `資料を追加した後：${p.reason}`,
  invalidParams: 'パラメータが不正です',
};
