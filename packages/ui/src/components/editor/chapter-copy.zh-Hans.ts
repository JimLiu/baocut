import type { ChapterMessages } from './chapter-copy.ts';

export const zhHans: ChapterMessages = {
  band: '章节',
  prev: '上一章',
  next: '下一章',
  noChapters: '还没有章节',
  /** 章节条上没有章的空当（第一章之前、章与章之间）。 */
  gap: '没有章节',
  beforeFirst: '第一章之前',
  add: '在播放头处加章节',
  rename: '改标题…',
  remove: '删除这一章',
  menuLabel: (title: string) => `章节「${title}」`,
  gapMenuLabel: '章节条',
  /** 章节条一段的读屏名：标题加起止。 */
  segmentLabel: (title: string, range: string) => `${title}，${range}，点一下跳到开头`,
  dragHint: '拖动改这一章的起点',
  /** 加 / 改名浮层。 */
  addTitle: '加章节',
  renameTitle: '改章节标题',
  titleLabel: '标题',
  addAt: (time: string) => `从 ${time} 开始，到下一章为止`,
  confirmAdd: '加上',
  confirmRename: '改名',
  cancel: '取消',
  refusal: {
    exists: '播放头这一帧已经有一章',
    beyond: '播放头在片尾，这里加不了章节',
    blank: '标题不能是空白',
  },
  /** 编辑事务的名字（撤销按钮上「撤销「…」」）。 */
  labels: { add: '加章节', rename: '改章节标题', remove: '删除章节', move: '移动章节起点' },
  added: (title: string) => `已加章节「${title}」`,
  renamed: (title: string) => `已改名为「${title}」`,
  removed: (title: string) => `已删除章节「${title}」`,
  undo: '撤销',
  /** 文稿的章节头行。 */
  clickRename: '点击改名',
  jump: '跳到这一章开头',
  paragraphs: (n: number) => `${n} 段`,
  empty: '这一章还没有段落',
};
