import type { SpaceActionsMessages } from './space-actions-copy.ts';

export const ja: SpaceActionsMessages = {
  edit: {
    video: '動画を開く',
    'source-video': '元の動画で編集',
    'new-video': 'この素材から新しい動画を作成',
    text: 'テキストを編集',
    version: 'コピーを保存して編集',
  },
  trashed: '先にゴミ箱からこの項目を復元してください',
  editGenerating: 'まだ生成中です。完了すると編集できます',
  editMissing: 'ファイルが見つかりません。編集する前にファイルを再接続してください',
  editFailed: '生成に失敗したため、編集できるファイルがありません',
  editPackage: '動画パッケージ（ポータブルパッケージ）は編集できません',
  editText: 'ここではまだテキストの新しいバージョンを保存できません。セッションで続けて、Agent に変更してもらってください',
  editVersion: '画像、音声、テンプレートの手動編集にはまだ対応していません。セッションで続けて、Agent に変更してもらってください',
  newVideoOutside: 'このファイルはプロジェクトやセッションのフォルダにないため、まだ新しい動画には使えません',
  packageGenerating: 'まだ書き出し中です。完了すると開けます',
  packageMissing: 'このファイルが見つかりません',
  packageFailed: '書き出しに失敗したため、開けるパッケージがありません',
  packageOutside: 'このパッケージはプロジェクトやセッションのフォルダにないため、まだ開けません',
  continueTrashed: 'セッションに取り込む前に、ゴミ箱からこの項目を復元してください',
  purgeGenerating: 'タスクはまだ実行中です。先に「タスク」ページでキャンセルしてください',
  purgeNotTrashed: '先にゴミ箱に移動してから、ゴミ箱で削除してください',
  referenceKind: {
    'video-asset': '動画素材',
    job: '実行中のタスク',
    unverified: '確認できません',
    'user-file': '動画フォルダ内のほかのファイル',
  },
  importAllFailed: (count: number, error: string) => `${count} 個のファイルはいずれも読み込まれませんでした：${error}`,
  importFailed: (error: string) => `読み込まれませんでした：${error}`,
  imported: (count: number) => `素材 ${count} 個を読み込みました`,
  copiedAll: 'プロジェクトの imports/ にコピーしました',
  copiedSome: (count: number) => `${count} 個をプロジェクトの imports/ にコピーしました`,
  notImported: (count: number) => `${count} 個は読み込まれませんでした`,
  references: (names: readonly string[], total: number) => {
    const quoted = names.map((name) => `「${name}」`).join('、');
    return total > names.length ? `Space の項目${quoted}ほか ${total - names.length} 件` : `Space の項目${quoted}`;
  },
  referenceOutput: '生成物',
};
