import { defineMessages } from '@baocut/protocol';
import { zhHans } from './markup-copy.zh-Hans.ts';
import { zhHant } from './markup-copy.zh-Hant.ts';
import { ja } from './markup-copy.ja.ts';
import { ko } from './markup-copy.ko.ts';
import { es } from './markup-copy.es.ts';
import { fr } from './markup-copy.fr.ts';
import { de } from './markup-copy.de.ts';
import { nl } from './markup-copy.nl.ts';
import { ptBR } from './markup-copy.pt-BR.ts';
import { it } from './markup-copy.it.ts';
import { ru } from './markup-copy.ru.ts';
import { pl } from './markup-copy.pl.ts';
import { tr } from './markup-copy.tr.ts';
import { vi } from './markup-copy.vi.ts';

/**
 * 轻量视图的标记（轻量编辑器设计 §4）：舞台条上的「标记」钮、画面底上浮的工具条、标记层上的文字与评论、关闭时的确认。
 * 标注的种类名、标签与加不进去的原因在 video-annotations-copy。译文在 `markup-copy.zh-Hans.ts` 等。
 */
const en = {
  /** 舞台条上的开关（轻量视图里叫「标记」，时间线视图仍是「标注」）。 */
  markup: 'Markup',
  exitMarkup: 'Exit markup',
  /** 工具条的读屏名与各个工具；形状钮显示记住的那一种，副工具条上一排形状（`shapeMenu` 是它的读屏名）。 */
  toolbar: 'Markup tools',
  tools: { element: 'Select element', comment: 'Comment', pen: 'Pen', shape: 'Shape', text: 'Text' },
  shapes: { line: 'Line', arrow: 'Arrow', box: 'Rectangle', ellipse: 'Circle', pin: 'Number' },
  shapeMenu: 'Choose a shape',
  colors: { red: 'Red', blue: 'Blue', green: 'Green', black: 'Black', white: 'White' },
  color: 'Color',
  width: 'Stroke width',
  widthValue: (px: number) => `${px} px`,
  /** 文字工具的副工具条：粗体 / 斜体 / 下划线、字号（下拉里是像素数）、字体。 */
  textStyles: { bold: 'Bold', italic: 'Italic', underline: 'Underline' },
  fontSize: 'Font size',
  font: 'Font',
  fonts: { sans: 'Sans serif', serif: 'Serif', mono: 'Monospace' },
  /** 副工具条的读屏名：「文字 · 样式」。 */
  toolOptions: (tool: string) => `${tool} · options`,
  /** 下拉钮的提示：「颜色 · 红」。 */
  current: (name: string, value: string) => `${name} · ${value}`,
  /** 带快捷键的提示：「评论 · ⇧⌘C」。 */
  withKeys: (label: string, keys: string) => `${label} · ${keys}`,
  /** 撤销 / 重做钮（同 ⌘Z / ⇧⌘Z）。 */
  undo: 'Undo',
  redo: 'Redo',
  addToChat: 'Add to chat',
  close: 'Close markup',
  /** 加进去的条数：按帧数（同一帧的几处标记算一条）。 */
  added: (n: number) => `Added to chat · ${n}`,
  /** 关闭时还有没发的标记。 */
  discardTitle: 'Discard these marks?',
  discardBody: 'Some marks on the picture haven’t been added to the chat yet. Discarding removes them.',
  keepMarking: 'Keep marking',
  discard: 'Discard',
  /** 文字标记。 */
  textPlaceholder: 'Type text',
  textMark: 'Text mark',
  /** 评论：印章上的缩写（没有用户名时）、读屏名、批注框。 */
  me: 'Me',
  comment: 'Comment',
  stamp: (text: string) => (text ? `Comment: ${text}` : 'Comment'),
  commentPlaceholder: 'What should change?',
  sendToAgent: 'Send to the agent',
  send: 'Send',
  cancel: 'Cancel',
  kept: 'The comment stays on the picture. “Add to chat” sends it with the other marks.',
  shotFailed: 'Couldn’t capture a frame. The marks were added without that screenshot.',
  /**
   * Web 的截图模式（轻量编辑器设计 §4.1、§8）：「添加到对话」换成复制 / 下载这一帧的图；复制失败（剪贴板不可用或被拒）、
   * 这一帧截不出图（实时合成层拷不进画布）时的提示；关闭时有标记的确认（没有「添加到对话」这一说）。
   */
  copyImage: 'Copy image',
  downloadImage: 'Download image',
  copied: 'Image copied',
  downloaded: (name: string) => `Downloaded ${name}`,
  copyFailed: 'Couldn’t copy the image. Download it instead.',
  /** 宿主不许写图片进剪贴板、退成富文本（HTML 里嵌着图）复制时：只有收富文本的地方贴得进去。 */
  copiedAsHtml: 'Copied as rich text. This browser can’t copy image files, so it pastes into docs and notes only. Download it to get the file.',
  captureFailed: 'Couldn’t capture this frame.',
  discardBodyScreenshot: 'Closing removes the marks on the picture. Copy or download the image first if you need it.',
  /**
   * 标记帧的书签（lite-editor §4.1）：工具条上的书签列表（每项是时码与这一帧的标记条数），时间线章节条上的印章（挤在一起的几帧合成一枚，
   * 读屏名说从哪一刻起几帧）。
   */
  bookmarks: 'Marked frames',
  bookmarkItem: (time: string, n: number) => `${time} · ${n === 1 ? '1 mark' : `${n} marks`}`,
  stampLabel: (time: string, frames: number) => (frames === 1 ? `Marked frame ${time}` : `${frames} marked frames from ${time}`),
  /** 「选择元素」悬停 HTML 动画里的节点时，说明卡上可访问性的标题与三行（照 DevTools 的检查提示）；空的值显示「—」。 */
  pickInfo: { heading: 'Accessibility', name: 'Name', role: 'Role', focusable: 'Keyboard-focusable' },
};

export type MarkupMessages = typeof en;
export const MARKUP_COPY = defineMessages(en, {
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  ja,
  ko,
  es,
  fr,
  de,
  nl,
  'pt-BR': ptBR,
  it,
  ru,
  pl,
  tr,
  vi,
});
