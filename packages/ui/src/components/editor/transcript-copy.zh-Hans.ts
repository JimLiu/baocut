import type { TranscriptMessages, TranscriptToolsMessages } from './transcript-copy.ts';

/** 秒数的短写：不足 10 秒留一位小数。 */
function secondsLabel(seconds: number): string {
  return seconds < 10 ? `${(Math.round(seconds * 10) / 10).toFixed(1)} 秒` : `${Math.round(seconds)} 秒`;
}

export const zhSeconds = secondsLabel;

export const zhTranscript: TranscriptMessages = {
  title: '文稿',
  modes: '文稿的编辑模式',
  modeEdit: '改原文',
  modeCut: '剪辑音画',
  /** 模式标签下面那一句：这个模式改的是什么、⌫ 做什么（§5.7：同一个删除键在不同模式下含义不同）。 */
  hintEdit: '改的是转写文字，不动音画。双击词改字，⌫ 只删文字。',
  hintCut: '拖选一段文字，按 ⌫ 剪掉，视频、音频和字幕一起变。剪掉的字划线保留，可以恢复。',

  emptyTitle: '还没有文稿',
  emptyNoMedia: '先添加视频或音频，转录之后口播的文字会出现在这里。',
  emptyNotPlaced: '视频或音频还没放上时间线。放上去、转录之后，文稿会出现在这里。',
  emptyNotTranscribed: '时间线上的素材还没有转写。在字幕面板里转录，文稿会出现在这里。',
  gotoSubtitle: '去字幕面板转录',
  addMedia: '添加媒体',
  loading: '正在读取转写…',
  noWords: '这份转写里没有可显示的词。',
  notSpeech: '这份转写的格式认不出来。',

  /** 一份转写的小标题：素材名 + 统计。 */
  stats: (words: number, cut: number) => (cut ? `${words} 个词 · ${cut} 个已剪掉` : `${words} 个词`),
  jump: '跳到这里',
  cutWordTitle: '已从时间线剪掉',
  partialWordTitle: '剪口落在这个词中间，只剩一部分在时间线上',

  // 选区条
  selected: (count: number, seconds: number | null) =>
    seconds === null ? `选中 ${count} 个词` : `选中 ${count} 个词 · ${secondsLabel(seconds)}`,
  cut: '剪掉',
  restore: '恢复',
  editWord: '改字',
  deleteText: '删除文字',
  clear: '取消选区 · Esc',
  aiFind: '找可剪的口',
  aiFindHint: '也可以让 AI 先把口癖和停顿找出来',

  // 结果
  cutDone: (seconds: number, ranges: number) =>
    ranges > 1 ? `已剪掉 ${secondsLabel(seconds)} · ${ranges} 段` : `已剪掉 ${secondsLabel(seconds)}`,
  cutNothing: '选中的词已经不在时间线上，没有可剪的。',
  cutTooShort: '选中的这段不足一帧，剪不了。',
  restoreDone: (seconds: number) => `已恢复 ${secondsLabel(seconds)}`,
  restoreNotRelaid: '有的剪口在时间线上找不到接缝，只从剪口里去掉了，内容没有放回。',
  restoreRefused: {
    untracked: '这段不是用剪口剪掉的（比如拖片段边缘裁掉的），没有剪口可以恢复。请在时间线上拖片段的边缘恢复。',
    partial: '这一处只有一部分是剪口剪掉的，改不了范围。点一下剪口带可以先恢复剪口那部分。',
  },
  textSaved: '已改原文 · 音画没动',
  textDeleted: (count: number) => `已删除 ${count} 个词的文字 · 音画没动`,
  /** 改原文之后，由旧版本生成的字幕过期了；不自动重新生成（任务约定）。 */
  stale: (count: number) => `${count} 份字幕由旧版文稿生成，没有自动更新。`,
  gotoCaptions: '去字幕面板',
  undo: '撤销',

  // 时间线剪口
  seamLabel: (seconds: number) => `剪掉了 ${secondsLabel(seconds)} · 点击恢复`,
  cutLabel: '在文稿里剪掉',
  restoreLabel: '恢复剪掉的内容',
  liveCopy: '复制已转录的部分',
  liveCopied: '已复制已转录的部分 · 转录仍在进行',
  liveSpeaker: '识别中',
  liveWaiting: '识别出来的文字会陆续出现在这里；有的服务要等全部识别完才一起返回。',
  liveNote: '识别出来的部分会一段一段出现，转录完成后才能编辑。',
  liveJump: '回到最新',
  liveSaving: '正在保存转写',
};

export const zhTranscriptTools: TranscriptToolsMessages = {
  // 工具菜单（原型 panels.jsx 文稿头上的 ✦，产品设计 §5.10）：整理文稿的四件，和从文稿出发的写作、发布
  toolsMenu: '整理文稿',
  toolsTidy: '整理全文',
  toolsFrom: '从文稿出发',
  // 查找替换
  findTip: '查找和替换 · ⌘F',
  findLabel: '查找和替换',
  findPlaceholder: '在文稿里查找',
  /** 当前命中改不了的原因（设计稿 `lockHint`）：译文只查不改；转写的新版本还没取到时先不改，免得盖掉新版本。 */
  lockTranslation: '译文只查不改——文稿面板只改原文',
  lockLoading: '这份转写的新版本还在读取，读完再替换',
  replaceLabel: '替换文稿文字',
  replaceDone: (count: number) => `已替换 ${count} 处 · 音画没动`,
  replaceNothing: '没有需要改动的匹配',

  // 复制
  copyMenu: '复制文稿',
  copyAllHead: (lang: string) => `复制全文 · ${lang}`,
  copyText: '复制文字',
  copySpeaker: '带说话人',
  copyTimed: '带时间码与说话人',
  copyScopeHead: (scope: string) => `复制${scope}`,
  copied: (scope: string, receipt: string) => `已复制${scope} · ${receipt}`,
  copyFailed: '复制失败 · 浏览器拒绝了剪贴板权限',
  copyEmpty: '没有可复制的文字',
  scopeAll: '全文',
  scopePara: '这一段',
  scopeChapter: (title: string) => `「${title}」`,
  scopeSelection: '选中的文字',
  copySelection: '复制',
  copySelectionTip: '复制选中的文字 · ⌘C',

  // 语言视图（设计稿 `langShort` 与「文稿语言」菜单）
  langLabel: '文稿语言',
  langSource: '原文',
  langTranslation: '译文',
  langBoth: (source: string, translation: string) => `${source} ＋ ${translation}`,
  showBoth: '同时显示原文',
  showBothNeedsTranslation: '先选一门译文',
  showBothHint: '双语对照',
  noTranslation: '还没有译文',
  noTranslationHint: '在字幕页用「＋ 翻译成…」翻译',
  translationNote: '译文只做段级跟随——词级时间戳只在原文，按词对齐播放进度会是编出来的。',
  translationOnly: '只看译文时不能改字、不能剪；切回原文或双语对照再编辑。',
  noParagraphTranslation: '这一段没有对应的译文',

  // 段落行（设计稿 `ParaRow`）
  paraMenu: '这一段…',
  moveUp: '移到上一章',
  moveDown: '移到下一章',
  play: '播放本段',
  moveHead: '换到哪一章',
  moveTo: (title: string) => `移到「${title}」`,
  moveWith: (count: number) => (count > 1 ? `连同同侧的邻居共 ${count} 段一起走` : '只挪这一段'),
  /** 挪不了的原因：章节是连续的时间区间，只挪跨过的那一条边界。 */
  noPrev: '这一段前面没有别的章节了',
  noNext: '这一段后面没有别的章节了',
  moveBlocked: '挪过去本章就空了，或会越过相邻章节的起点',
  moveLabel: '把段落移到相邻章节',
  moved: (title: string, count: number) => (count > 1 ? `已把 ${count} 段移到「${title}」` : `已移到「${title}」`),
  cutPara: '剪掉这一段',
  cutParaHint: '视频、音频和字幕一起剪，可以恢复',

  // 章节头「这一章…」
  chapterMenu: '这一章…',
  renameChapter: '改名…',
  cutChapter: '剪掉这一章',
  cutChapterHint: '视频、音频和字幕一起剪，后面的章节跟着前移',
  cutChapterLabel: '剪掉一章',
  cutChapterRefused: {
    empty: '这一章没有长度',
    whole: '这一章就是整个视频，剪掉就什么都不剩了',
    'no-tracks': '时间线上没有取用了转写素材的轨道可剪',
  },
  cutChapterDone: (title: string, seconds: number) => `已剪掉「${title}」· ${secondsLabel(seconds)}`,
  removeMarker: '删除章节标记',
  removeMarkerHint: '只删标记，内容不动',
  find: '查找',
  badRegex: '正则无效',
  noResults: '无结果',
  previous: '上一个',
  next: '下一个',
  closeFind: '关闭查找',
  replaceWith: '替换为',
  matchCase: '区分大小写',
  wholeWordShort: '全词',
  wholeWord: '全词匹配',
  regex: '正则表达式 · 替换文字按字面插入',
  replace: '替换',
  replaceAll: '全部替换',
  regexError: (error: string) => `正则写错了：${error}`,
};
