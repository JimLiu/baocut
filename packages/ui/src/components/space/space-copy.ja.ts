import { revealLabel } from '../../copy.ts';
import type { SpaceMessages } from './space-copy.ts';

export const ja: SpaceMessages = {
  searchPlaceholder: '名前、ファイル、動画内の発言を検索',
  searchLabel: 'Space を検索',

  // 列表与菜单
  openVideo: '動画を開く',
  viewInfo: '情報を見る',
  transcribe: { first: '文字起こし…', redo: '再文字起こし…', retry: '文字起こしを再試行…' },
  info: '動画の詳細…',
  view: '表示',
  continue: 'セッションで続ける',
  favorite: 'お気に入りに追加',
  unfavorite: 'お気に入りから削除',
  rename: '名前を変更',
  get reveal() {
    return revealLabel();
  },
  viewTask: 'タスクを見る',
  trash: 'ゴミ箱に入れる',
  restore: 'ゴミ箱から復元',
  purge: '完全に削除',
  clear: '消去',
  columnMeasure: '長さまたはサイズ',
  columnStatus: '状態',
  noValue: '—',
  favorited: 'お気に入り済み',

  // 工具条
  statusPicker: '状態',
  refreshMenu: '更新',
  rescan: 'プロジェクトフォルダを再スキャン',
  rescanHint: 'すべてのプロジェクトフォルダとセッションフォルダのファイルを読み直します',
  rebuild: 'インデックスを再構築',
  rebuildHint: '派生したカタログとコンテンツインデックスを破棄して作り直します。お気に入り、表示名、ゴミ箱はそのまま残ります',
  scanning: 'プロジェクトフォルダをスキャン中',
  rebuilt: (entries: number, pending: number) =>
    pending > 0
      ? `インデックスを再構築しました · 項目 ${entries} 件 · 動画 ${pending} 本のコンテンツインデックスをバックグラウンドで更新中`
      : `インデックスを再構築しました · 項目 ${entries} 件`,

  // 新建
  newLabel: '新規',
  newBlank: '空の動画を新規作成',
  newBlankHint: '16:9 の空の動画。文字起こしも待機もなく、すぐに開きます',
  newFromFile: 'ファイルから動画を新規作成',
  newFromFileHint: '動画や音声は Home の入力欄に添付され、どう処理するかを指示できます。画像はそのままタイムラインに配置されます',
  newFromPackage: 'ポータブルパッケージから動画を新規作成',
  newFromPackageHint: 'ほかの場所で書き出した .baocut。素材はすべてパッケージに含まれています',
  pickPackageTitle: 'ポータブルパッケージを選択',
  pickPackageButton: '開く',
  pickPackageFilter: 'BaoCut ポータブルパッケージ',
  openPackage: '新しい動画として開く',
  packageBlocked: (reason: string) => `新しい動画として開く：${reason}`,
  packageOpening: (name: string) => `「${name}」を開いています…`,
  packageOpened: (name: string) => `「${name}」を新しい動画として開きました`,
  importAssets: '素材を読み込む',
  importAssetsHint: 'ファイルをプロジェクトの素材として登録します。プロジェクト外のファイルはプロジェクトの imports/ にコピーされます',
  whichProject: 'どのプロジェクトに',
  noProject: '先に Home でプロジェクトフォルダを開いてください',
  pickNotMedia: '動画、音声、画像のファイルではありません',
  createdFromFile: (name: string) => `動画「${name}」を作成し、素材を配置しました`,
  createdEmpty: (reason: string) => `動画は作成されましたが、素材を配置できませんでした：${reason}`,

  // 导入框（原型 SpaceImport）
  importTitle: '素材を読み込む',
  importProject: '読み込み先のプロジェクト',
  importHint:
    '動画、音声、画像を選んでください。プロジェクトフォルダ内のファイルはその場で登録され、フォルダ外のファイルはプロジェクトの imports/ にコピーされます。元のファイルはそのまま残ります。どの動画にも追加されません。',
  importPick: 'ファイルを選択…',
  importNoProject: 'プロジェクトはまだありません。先に Home でプロジェクトフォルダを開いてください。',
  importing: '読み込み中',

  // 查看框
  factSource: 'ソース',
  factFile: 'ファイル',
  factMeasure: '長さまたはサイズ',
  factSize: 'サイズ',
  factStatus: '状態',
  factActivity: '最終アクティビティ',
  factConversation: '元のセッション',
  factGenerated: '生成方法',
  factVersion: 'バージョン',
  factNote: 'メモ',
  viewConversation: '元のセッションを見る',
  close: '閉じる',
  editBlocked: (reason: string) => `再編集：${reason}`,
  continueBlocked: (reason: string) => `セッションで続ける：${reason}`,
  version: (frozen: string, current: string | null) =>
    current && current !== frozen ? `動画のバージョン ${frozen}。動画は現在 ${current} です` : `動画のバージョン ${frozen}`,
  missingTitle: 'このファイルが見つかりません',
  // 卡片角标与列表缩略图的读屏说明（原型 sp-prev__flag）
  missingFile: 'ファイルが見つかりません',
  missingBody: '項目は残っています。ファイルが戻れば状態も元に戻ります。',
  failedTitle: '生成に失敗しました',
  failedBody: 'ファイルは生成されませんでした。タスクページで原因を確認して再試行するか、不要なら消去してください。',
  changedTitle: '元の動画がその後変更されています',
  changedBody: 'この結果は以前のバージョンの動画に対応しています。引き続き使えますが、現在の動画は反映していません。',
  reexport: '元の動画からもう一度書き出す',
  noPreviewVideo: '動画はエディタで開きます。',

  // 能力（origin.capability）
  capability: {
    synthesizeSpeech: '吹き替え',
    generateImage: '画像を生成',
    generateText: 'テキストを生成',
    export: '書き出し',
  },

  // 动作的结果
  trashed: (name: string) => `ゴミ箱に入れました · ${name}`,
  undo: '取り消す',
  restored: (name: string) => `復元しました · ${name}`,
  purged: (name: string) => `完全に削除しました · ${name}`,
  cleared: (name: string) => `消去しました · ${name}`,
  renamed: '名前を変更しました',
  continued: (created: boolean, name: string, title: string) =>
    created
      ? `「${name}」を添付して新しいセッションを開始しました：やりたいことを書いて送信してください`
      : `「${name}」を添付して「${title}」に戻りました：やりたいことを書いて送信してください`,
  sourceGone: '元の動画は現在どのプロジェクトフォルダにもセッションフォルダにもないため、開けません',
  failed: (what: string, reason: string) => `「${what}」を実行できませんでした：${reason}`,

  // 删除视频（产品设计 §4.9）
  trashVideoTitle: 'この動画を削除しますか？',
  trashVideoBody: '動画フォルダ全体がプロジェクトのゴミ箱に移動し、復元できます。リンクされた元の素材はそのままの場所に残ります。',
  trashVideoRelated: (n: number) => `この動画から書き出しまたは生成された ${n} 件の項目は Space に残り、動画と一緒には削除されません：`,
  trashVideoConfirm: '動画を削除',

  // 彻底删除
  purgeTitle: '完全に削除しますか？',
  purgeBody: (name: string) =>
    `「${name}」はディスクから削除され、復元できません。動画や実行中のタスクがまだ使用している場合は何も削除されず、何が使用しているかが表示されます。`,
  purgeVideoBody: (name: string) => `動画「${name}」のフォルダ全体がディスクから削除され、復元できません。リンクされた元の素材には影響しません。`,
  purgeConfirm: '完全に削除',
  blockedTitle: 'まだ削除できません',
  blockedBody: (name: string) => `「${name}」はまだ使用中のため、何も削除されませんでした：`,
  gotIt: 'OK',

  // 改名
  renameTitle: '名前を変更',
  renameLabel: '表示名',
  renameHint: (fileName: string) => `Space に表示される名前だけが変わり、ファイル自体はそのままです。空欄にすると「${fileName}」に戻ります。`,
  save: '保存',

  // 来源视频改过（产品设计 §4.6）
  changedDialogTitle: '元の動画が変更されています',
  changedDialogBody: (frozen: string | null, current: string | null) =>
    `この結果は動画のバージョン ${frozen ?? '（不明）'} に対応していますが、動画は現在 ${current ?? '（不明）'} です。現在の作業コピーが開きます。`,
  changedOpenCurrent: '現在の作業コピーを開く',
  changedFromFrozen: 'そのバージョンから続ける',
  changedFromFrozenReason:
    'この書き出しの元になったバージョンから続けることはまだできません（Runtime にはバージョンに戻るコマンドがありません）。現在の作業コピーを開き、履歴でそのバージョンを確認できます。',

  // 内容命中（架构设计 §5.11）
  hitsTitle: '動画内の発言',
  hitsCount: (n: number) => `${n} 件`,
  hitsSearching: 'コンテンツインデックスを検索中',
  hitsNone: '一致する動画内の発言はありません',
  hitsError: (reason: string) => `コンテンツインデックスを検索できません：${reason}`,
  hitUnopenable: 'この動画は現在どのプロジェクトフォルダにもセッションフォルダにもないか、ゴミ箱にあるため、開けません',
  hitSourceClock: 'これはタイムライン上ではなく素材の中にあります。動画を開いて探してください',
  hitStale: 'インデックス作成後に動画が変更されたため、位置がずれている可能性があります',
  // 内容命中的过滤与分组（设计稿 page-projects.jsx HitGroup；种类、说话人是合同 space.search 的筛选）
  hitsGrouped: (n: number, videos: number) => `${n} 件 · 動画 ${videos} 本`,
  hitKind: 'ドキュメントの種類',
  hitKindAll: 'すべての種類',
  hitSpeaker: '話者',
  hitSpeakerAll: 'すべての話者',
  hitSpeakerNone: 'これらの一致には話者が付いていません',
  hitsNoneFiltered: 'この種類または話者に一致するものはありません。別のものを試してください。',
  hitsMore: (n: number) => `さらに ${n} 件を表示`,

  // 页面里的其余文字
  cancel: 'キャンセル',
  openForEdit: '開いて編集',
  newVideo: '新しい動画',
  revealUnavailable: 'このファイルはどのプロジェクトフォルダにもセッションフォルダにもないため、表示できる場所がありません',
  sidebarLabel: 'Space のカテゴリ',
  kindsHeader: 'カテゴリ',
  mineHeader: '整理',
  sidebarNote: 'Space には、すべてのプロジェクトの動画、素材、生成物が表示されます。ファイルはそれぞれのプロジェクトフォルダにあります。',
  all: 'すべて',
  emptyFiltered: '一致する項目はありません',
  emptyTrash: 'ゴミ箱は空です',
  emptyFavorite: 'お気に入りはまだありません',
  emptyAll: '項目はまだありません',
  emptyCategory: (label: string) => `${label} はまだありません`,
  emptyFilteredBody: '別のキーワードを試すか、プロジェクトと状態の絞り込みを解除してください。',
  emptyTrashBody: 'ゴミ箱に入れた項目はここに表示されます。復元することも、完全に削除することもできます。',
  emptyBody: 'セッションで Agent に頼むと、生成物がここに表示されます。「新規」から素材を読み込むことも、Home で既存のフォルダを開くこともできます。',
  projectPicker: 'プロジェクト',
  allProjects: 'すべてのプロジェクト',
  sortPicker: '並べ替え',
  viewPicker: '表示',
  viewGrid: 'グリッド',
  viewList: 'リスト',
  issuesTitle: (n: number) => `${n} 個のフォルダを完全には一覧表示できませんでした`,
  issueTruncated: (detail: string) => `ファイルが多すぎるため、一部だけを一覧表示しました：${detail}`,
  issueUnreadable: (detail: string) => `読み取れません：${detail}`,
  preparing: 'Space を準備中…',
  preparingBody: '初回はプロジェクトフォルダをスキャンする必要があります。しばらくお待ちください。',
  createIn: (project: string, hint: string) => `「${project}」内 · ${hint}`,
  whichProjectFor: (label: string) => `${label}：どのプロジェクトに`,
  entryActions: (name: string) => `「${name}」の操作`,
  entriesLabel: 'Space の項目',
  columnName: '名前',
  columnKind: '種類',
  columnSource: 'ソース',
  columnActivity: '最終アクティビティ',
  columnMenu: '操作',
  relatedMore: (n: number) => `…合計 ${n} 件`,
  importSummaryIn: (text: string, project: string) => `${text}（${project}）`,
  activityAt: (ago: string, at: string) => `${ago}（${at}）`,
  withReason: (reason: string, body: string) => `${reason}。${body}`,
};
