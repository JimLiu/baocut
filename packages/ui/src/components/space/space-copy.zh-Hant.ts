import { revealLabel } from '../../copy.ts';
import type { SpaceMessages } from './space-copy.ts';

export const zhHant: SpaceMessages = {
  searchPlaceholder: '搜尋名稱、檔案或影片中說過的話',
  searchLabel: '搜尋 Space',

  // 列表与菜单
  openVideo: '開啟影片',
  viewInfo: '檢視資訊',
  viewInfoFiles: '檢視資訊與檔案',
  filesButton: (n: number) => `${n} 個檔案`,
  filesButtonLabel: (n: number, summary: string) => `${n} 個檔案：${summary}`,
  filesLine: (n: number, summary: string) => `${n} 個檔案 · ${summary}`,
  filesTitle: '檔案',
  filesListLabel: '這部影片的檔案',
  viewVideo: '檢視影片',
  factFolder: '資料夾',
  transcribe: { first: '轉錄…', redo: '重新轉錄…', retry: '重試轉錄…' },
  info: '影片詳細資訊…',
  view: '檢視',
  continue: '在對話中繼續',
  favorite: '加入最愛',
  unfavorite: '從最愛中移除',
  rename: '重新命名',
  get reveal() {
    return revealLabel();
  },
  viewTask: '檢視任務',
  trash: '丟到垃圾桶',
  restore: '從垃圾桶回復',
  purge: '永久刪除',
  clear: '清除',
  columnMeasure: '長度或尺寸',
  columnStatus: '狀態',
  noValue: '—',
  favorited: '已加入最愛',

  // 工具条
  statusPicker: '狀態',
  refreshMenu: '重新整理',
  rescan: '重新掃描專案資料夾',
  rescanHint: '重新讀取每個專案與對話資料夾中的檔案',
  rebuild: '重建索引',
  rebuildHint: '捨棄衍生的目錄與內容索引並重新建立；最愛、顯示名稱與垃圾桶都會保留',
  scanning: '正在掃描專案資料夾',
  rebuilt: (entries: number, pending: number) =>
    pending > 0
      ? `已重建索引 · ${entries} 個項目 · 還有 ${pending} 部影片的內容索引正在背景更新`
      : `已重建索引 · ${entries} 個項目`,

  // 新建
  newLabel: '新增',
  newBlank: '新增空白影片',
  newBlankHint: '16:9 的空白影片，會立即開啟，不轉錄也不排隊',
  newFromFile: '從檔案新增影片',
  newFromFileHint: '影片或音訊會放到 Home 的輸入框，讓你說明要怎麼處理；圖片會直接放上時間軸',
  newFromPackage: '從可攜式套件新增影片',
  newFromPackageHint: '在其他地方匯出的 .baocut，所有素材都包含在內',
  pickPackageTitle: '選擇可攜式套件',
  pickPackageButton: '開啟',
  pickPackageFilter: 'BaoCut 可攜式套件',
  openPackage: '開啟為新影片',
  packageBlocked: (reason: string) => `開啟為新影片：${reason}`,
  packageOpening: (name: string) => `正在開啟「${name}」…`,
  packageOpened: (name: string) => `已將「${name}」開啟為新影片`,
  importAssets: '匯入素材',
  importAssetsHint: '將檔案登記為專案素材；專案外的檔案會複製到專案的 imports/',
  whichProject: '哪個專案',
  noProject: '請先在 Home 中開啟專案資料夾',
  pickNotMedia: '這不是影片、音訊或圖片檔',
  createdFromFile: (name: string) => `已建立影片「${name}」並放入素材`,
  createdEmpty: (reason: string) => `影片已建立，但素材未放入：${reason}`,

  // 导入框（原型 SpaceImport）
  importTitle: '匯入素材',
  importProject: '匯入到專案',
  importHint:
    '選擇影片、音訊或圖片。專案資料夾中的檔案會就地登記；專案外的檔案會複製到專案的 imports/，原始檔案保持不動。不會加入任何影片。',
  importPick: '選擇檔案…',
  importNoProject: '還沒有專案：請先在 Home 中開啟專案資料夾。',
  importing: '正在匯入',

  // 查看框
  factSource: '來源',
  factFile: '檔案',
  factMeasure: '長度或尺寸',
  factSize: '大小',
  factStatus: '狀態',
  factActivity: '最近活動',
  factConversation: '來源對話',
  factGenerated: '生成',
  factVersion: '版本',
  factNote: '備註',
  viewConversation: '檢視來源對話',
  close: '關閉',
  editBlocked: (reason: string) => `再次編輯：${reason}`,
  continueBlocked: (reason: string) => `在對話中繼續：${reason}`,
  version: (frozen: string, current: string | null) =>
    current && current !== frozen ? `影片版本 ${frozen}；影片目前為 ${current}` : `影片版本 ${frozen}`,
  missingTitle: '找不到這個檔案',
  // 卡片角标与列表缩略图的读屏说明（原型 sp-prev__flag）
  missingFile: '找不到檔案',
  missingBody: '項目仍在這裡。檔案回來後，狀態會自動回復正常。',
  failedTitle: '生成失敗',
  failedBody: '沒有產生檔案。可以在「任務」頁面查看原因並重試；如果不需要，可以清除。',
  changedTitle: '來源影片之後有修改',
  changedBody: '這個結果對應的是較早版本的影片。它仍可使用，但已不反映目前的影片。',
  reexport: '從來源影片重新匯出',
  noPreviewVideo: '影片會在編輯器中開啟。',

  // 能力（origin.capability）
  capability: {
    synthesizeSpeech: '配音',
    generateImage: '生成圖片',
    generateText: '生成文字',
    export: '匯出',
  },

  // 动作的结果
  trashed: (name: string) => `已丟到垃圾桶 · ${name}`,
  undo: '還原',
  restored: (name: string) => `已回復 · ${name}`,
  purged: (name: string) => `已永久刪除 · ${name}`,
  cleared: (name: string) => `已清除 · ${name}`,
  renamed: '已重新命名',
  continued: (created: boolean, name: string, title: string) =>
    created
      ? `已開始新對話並附上「${name}」：寫下要做什麼，然後傳送`
      : `已回到「${title}」並附上「${name}」：寫下要做什麼，然後傳送`,
  sourceGone: '來源影片目前不在任何專案或對話資料夾中，因此無法開啟',
  failed: (what: string, reason: string) => `無法${what}：${reason}`,

  // 删除视频（产品设计 §4.9）
  trashVideoTitle: '要刪除這部影片嗎？',
  trashVideoBody: '整個影片資料夾會移到專案的垃圾桶，之後可以回復。連結的原始素材會留在原處。',
  trashVideoRelated: (n: number) => `由它匯出或生成的 ${n} 個項目會留在 Space 中，不會隨影片刪除：`,
  trashVideoConfirm: '刪除影片',

  // 彻底删除
  purgeTitle: '要永久刪除嗎？',
  purgeBody: (name: string) =>
    `「${name}」會從磁碟中刪除，且無法回復。如果仍有影片或執行中的任務在使用它，就不會刪除任何東西，並會告訴你是誰在使用。`,
  purgeVideoBody: (name: string) => `影片「${name}」的整個資料夾會從磁碟中刪除，且無法回復。連結的原始素材不受影響。`,
  purgeConfirm: '永久刪除',
  blockedTitle: '目前還無法刪除',
  blockedBody: (name: string) => `「${name}」仍在使用中，因此沒有刪除任何東西：`,
  gotIt: '知道了',

  // 改名
  renameTitle: '重新命名',
  renameLabel: '顯示名稱',
  renameHint: (fileName: string) => `只會更改 Space 中顯示的名稱，檔案本身不變。留空則回到「${fileName}」。`,
  save: '儲存',

  // 来源视频改过（产品设计 §4.6）
  changedDialogTitle: '來源影片已有修改',
  changedDialogBody: (frozen: string | null, current: string | null) =>
    `這個結果對應的是影片版本 ${frozen ?? '（未知）'}；影片目前為 ${current ?? '（未知）'}。將開啟目前的工作稿。`,
  changedOpenCurrent: '開啟目前的工作稿',
  changedFromFrozen: '從那個版本繼續',
  changedFromFrozenReason:
    '目前還無法從這份成品所對應的版本繼續（Runtime 沒有回到某個版本的指令）。你可以開啟目前的工作稿，並在「歷史記錄」中檢視那個版本。',

  // 内容命中（架构设计 §5.11）
  hitsTitle: '影片中說過的話',
  hitsCount: (n: number) => `${n} 筆相符`,
  hitsSearching: '正在搜尋內容索引',
  hitsNone: '影片中沒有相符的內容',
  hitsError: (reason: string) => `無法搜尋內容索引：${reason}`,
  hitUnopenable: '這部影片目前不在任何專案或對話資料夾中，或在垃圾桶中，因此無法開啟',
  hitSourceClock: '這一處在素材中，不在時間軸上：請開啟影片自行尋找',
  hitStale: '影片在建立索引後有修改，位置可能有偏差',
  // 内容命中的过滤与分组（设计稿 page-projects.jsx HitGroup；种类、说话人是合同 space.search 的筛选）
  hitsGrouped: (n: number, videos: number) => `${n} 筆相符 · ${videos} 部影片`,
  hitKind: '文件類型',
  hitKindAll: '所有類型',
  hitSpeaker: '說話者',
  hitSpeakerAll: '所有說話者',
  hitSpeakerNone: '這些相符結果都沒有標示說話者',
  hitsNoneFiltered: '這個類型或說話者沒有相符的結果，請換一個試試。',
  hitsMore: (n: number) => `再顯示 ${n} 筆`,

  // 页面里的其余文字
  cancel: '取消',
  openForEdit: '開啟以編輯',
  newVideo: '新增影片',
  revealUnavailable: '這個檔案不在任何專案或對話資料夾中，因此沒有可顯示的位置',
  sidebarLabel: 'Space 分類',
  kindsHeader: '分類',
  mineHeader: '整理',
  sidebarNote: 'Space 顯示你所有專案中的影片、素材和產出。檔案仍留在各自的專案資料夾中。從影片匯出或產生的檔案會收在影片裡，依類型瀏覽時逐一列出。',
  all: '全部',
  emptyFiltered: '沒有符合的項目',
  emptyTrash: '垃圾桶是空的',
  emptyFavorite: '還沒有最愛',
  emptyAll: '還沒有項目',
  emptyCategory: (label: string) => `還沒有${label}`,
  emptyFilteredBody: '試試其他關鍵字，或清除專案與狀態篩選。',
  emptyTrashBody: '你丟到垃圾桶的項目會顯示在這裡。可以回復，也可以永久刪除。',
  emptyBody: '在對話中請 Agent 處理，產出就會顯示在這裡。你也可以從「新增」匯入素材，或在 Home 中開啟現有的資料夾。',
  projectPicker: '專案',
  allProjects: '所有專案',
  sortPicker: '排序',
  viewPicker: '檢視',
  viewGrid: '格狀',
  viewList: '清單',
  issuesTitle: (n: number) => `${n} 個資料夾未完整列出`,
  issueTruncated: (detail: string) => `檔案太多，只列出了一部分：${detail}`,
  issueUnreadable: (detail: string) => `無法讀取：${detail}`,
  preparing: '正在準備 Space…',
  preparingBody: '第一次需要掃描專案資料夾，請稍候。',
  createIn: (project: string, hint: string) => `在「${project}」中 · ${hint}`,
  whichProjectFor: (label: string) => `${label}：哪個專案`,
  entryActions: (name: string) => `「${name}」的操作`,
  entriesLabel: 'Space 項目',
  columnName: '名稱',
  columnKind: '類型',
  columnSource: '來源',
  columnActivity: '最近活動',
  columnMenu: '操作',
  relatedMore: (n: number) => `…共 ${n} 個`,
  importSummaryIn: (text: string, project: string) => `${text}（${project}）`,
  activityAt: (ago: string, at: string) => `${ago}（${at}）`,
  withReason: (reason: string, body: string) => `${reason}。${body}`,
};
