import type { TranscriptMessages, TranscriptToolsMessages } from './transcript-copy.ts';

function secondsLabel(seconds: number): string {
  return seconds < 10 ? `${(Math.round(seconds * 10) / 10).toFixed(1)} 秒` : `${Math.round(seconds)} 秒`;
}

export const zhHantSeconds = secondsLabel;

export const zhHantTranscript: TranscriptMessages = {
  title: '逐字稿',
  modes: '逐字稿編輯模式',
  modeEdit: '編輯文字',
  modeCut: '剪輯影音',
  hintEdit: '只會變更轉錄的文字，影片與音訊保持不變。按兩下字詞即可編輯；⌫ 只會刪除文字。',
  hintCut: '選取一段文字後按 ⌫，就會把它從影片、音訊與字幕中一起剪掉。剪掉的字會以刪除線保留，可以回復。',

  emptyTitle: '還沒有逐字稿',
  emptyNoMedia: '請先新增影片或音訊檔。轉錄完成後，說話的內容會出現在這裡。',
  emptyNotPlaced: '影片或音訊還沒放到時間軸上。放上去並轉錄後，逐字稿就會出現在這裡。',
  emptyNotTranscribed: '時間軸上的素材還沒有轉錄。在字幕面板中轉錄後，逐字稿就會出現在這裡。',
  gotoSubtitle: '到字幕面板轉錄',
  addMedia: '新增媒體',
  loading: '正在載入逐字稿…',
  noWords: '這份逐字稿沒有可顯示的字詞。',
  notSpeech: '無法辨認這份逐字稿的格式。',

  stats: (count: number, cut: number) => (cut ? `${count} 個詞 · 已剪掉 ${cut} 個` : `${count} 個詞`),
  jump: '跳到這裡',
  cutWordTitle: '已從時間軸剪掉',
  partialWordTitle: '剪下點落在這個詞中間；時間軸上只剩下一部分',

  // 选区条
  selected: (count: number, seconds: number | null) =>
    seconds === null ? `已選取 ${count} 個詞` : `已選取 ${count} 個詞 · ${secondsLabel(seconds)}`,
  cut: '剪下',
  restore: '回復',
  editWord: '編輯字詞',
  deleteText: '刪除文字',
  clear: '取消選取 · Esc',
  aiFind: '找出可剪片段',
  aiFindHint: '或先讓 AI 找出贅詞與停頓',

  // 结果
  cutDone: (seconds: number, ranges: number) =>
    ranges > 1 ? `已剪掉 ${secondsLabel(seconds)} · ${ranges} 段` : `已剪掉 ${secondsLabel(seconds)}`,
  cutNothing: '選取的字詞已經不在時間軸上，沒有可剪的內容。',
  cutTooShort: '選取的範圍不到一個影格，無法剪下。',
  restoreDone: (seconds: number) => `已回復 ${secondsLabel(seconds)}`,
  restoreNotRelaid: '有些剪下點在時間軸上找不到對應的接縫。它們已從剪下清單中移除，但內容沒有放回去。',
  restoreRefused: {
    untracked: '這段範圍不是用剪下移除的（例如是拖曳片段邊緣修剪掉的），所以沒有可回復的剪下點。請在時間軸上拖曳片段邊緣把它拉回來。',
    partial: '這段範圍只有一部分是用剪下移除的，因此無法變更範圍。請先點剪下帶回復那一部分。',
  },
  textSaved: '已更新文字 · 影片與音訊未變更',
  textDeleted: (count: number) => `已刪除 ${count} 個詞的文字 · 影片與音訊未變更`,
  stale: (count: number) => `${count} 條字幕軌是由舊版逐字稿產生的，沒有更新。`,
  gotoCaptions: '開啟字幕',
  undo: '還原',

  // 时间线剪口
  seamLabel: (seconds: number) => `已剪掉 ${secondsLabel(seconds)} · 按一下即可回復`,
  cutLabel: '在逐字稿中剪下',
  restoreLabel: '回復剪掉的內容',
  liveCopy: '複製已轉錄的部分',
  liveCopied: '已複製已轉錄的部分 · 轉錄仍在進行',
  liveSpeaker: '辨識中',
  liveWaiting: '辨識出來的文字會陸續出現在這裡；有些服務要等全部辨識完才一起傳回。',
  liveNote: '辨識出來的部分會一段一段出現，轉錄完成後才能編輯。',
  liveJump: '回到最新',
  liveSaving: '正在儲存轉錄',
};

export const zhHantTranscriptTools: TranscriptToolsMessages = {
  // 查找替换
  findTip: '尋找與取代 · ⌘F',
  findLabel: '尋找與取代',
  findPlaceholder: '在逐字稿中尋找',
  lockTranslation: '譯文在這裡只能搜尋、不能編輯——逐字稿面板只編輯原文',
  lockLoading: '這份逐字稿的新版本還在載入，載入完成後再取代',
  replaceLabel: '取代逐字稿文字',
  replaceDone: (count: number) => `已取代 ${count} 處 · 影片與音訊未變更`,
  replaceNothing: '沒有需要變更的相符項目',

  // 复制
  copyMenu: '複製逐字稿',
  copyAllHead: (lang: string) => `全部複製 · ${lang}`,
  copyText: '複製文字',
  copySettings: '複製設定',
  copyWithSettings: '依複製設定',
  copyTextOnly: '只複製文字',
  textOnly: '只有文字',
  keepCut: '含已剪掉的部分',
  copyConfirm: '複製',
  copyTranslationOnly: '只看譯文時由面板排出：不寫文首資訊，剪掉的部分不會出現。',
  copyScopeHead: (scope: string) => `複製${scope}`,
  copied: (scope: string, receipt: string) => `已複製${scope} · ${receipt}`,
  copyFailed: '無法複製 · 瀏覽器拒絕了剪貼簿存取權',
  copyEmpty: '沒有可複製的內容',
  scopeAll: '全部',
  scopePara: '這一段',
  scopeChapter: (title: string) => `「${title}」`,
  scopeSelection: '選取的文字',
  copySelection: '複製',
  copySelectionTip: '複製選取的文字 · ⌘C',

  // 语言视图（设计稿 `langShort` 与「文稿语言」菜单）
  langLabel: '逐字稿語言',
  langSource: '原文',
  langTranslation: '譯文',
  langBoth: (source: string, translation: string) => `${source} + ${translation}`,
  showBoth: '同時顯示原文',
  showBothNeedsTranslation: '請先選擇一份譯文',
  showBothHint: '雙語對照',
  noTranslation: '還沒有譯文',
  noTranslationHint: '在字幕面板中用「+ 翻譯成…」翻譯',
  translationNote: '譯文只會以段落為單位跟隨播放——字詞時間只存在於原文，逐詞醒目提示會是捏造的。',
  translationOnly: '只檢視譯文時無法編輯或剪下；請切回原文或雙語對照再編輯。',
  noParagraphTranslation: '這一段沒有譯文',

  // 段落行（设计稿 `ParaRow`）
  paraMenu: '這一段…',
  moveUp: '移到上一章',
  moveDown: '移到下一章',
  play: '播放這一段',
  moveHead: '移到章節',
  moveTo: (title: string) => `移到「${title}」`,
  moveWith: (count: number) => (count > 1 ? `會連同那一側的相鄰段落一起移動，共 ${count} 段` : '只移動這一段'),
  noPrev: '這一段之前沒有章節了',
  noNext: '這一段之後沒有章節了',
  moveBlocked: '移過去會讓這一章變空，或越過相鄰章節的起點',
  moveLabel: '把段落移到相鄰章節',
  moved: (title: string, count: number) => (count > 1 ? `已把 ${count} 段移到「${title}」` : `已移到「${title}」`),
  cutPara: '剪掉這一段',
  cutParaHint: '影片、音訊與字幕會一起剪掉；可以回復',

  // 章节头「这一章…」
  chapterMenu: '這一章…',
  renameChapter: '重新命名…',
  cutChapter: '剪掉這一章',
  cutChapterHint: '影片、音訊與字幕會一起剪掉；後面的章節會往前移',
  cutChapterLabel: '剪掉章節',
  cutChapterRefused: {
    empty: '這一章沒有長度',
    whole: '這一章就是整部影片；剪掉後就什麼都不剩了',
    'no-tracks': '時間軸上沒有軌道使用轉錄過的素材，所以沒有可剪的內容',
  },
  cutChapterDone: (title: string, seconds: number) => `已剪掉「${title}」 · ${secondsLabel(seconds)}`,
  removeMarker: '刪除章節標記',
  removeMarkerHint: '只刪除標記；內容保留',
  find: '尋找',
  badRegex: '無效的正規表示式',
  noResults: '沒有結果',
  previous: '上一個',
  next: '下一個',
  closeFind: '關閉尋找',
  replaceWith: '取代為',
  matchCase: '區分大小寫',
  wholeWordShort: '全字',
  wholeWord: '全字相符',
  regex: '正規表示式 · 取代文字會照字面插入',
  replace: '取代',
  replaceAll: '全部取代',
  regexError: (error: string) => `正規表示式錯誤：${error}`,
};
