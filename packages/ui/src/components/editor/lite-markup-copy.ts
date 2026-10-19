import { defineMessages } from '@baocut/protocol';
import { zhHans } from './lite-markup-copy.zh-Hans.ts';
import { zhHant } from './lite-markup-copy.zh-Hant.ts';
import { ja } from './lite-markup-copy.ja.ts';
import { ko } from './lite-markup-copy.ko.ts';
import { es } from './lite-markup-copy.es.ts';
import { fr } from './lite-markup-copy.fr.ts';
import { de } from './lite-markup-copy.de.ts';
import { nl } from './lite-markup-copy.nl.ts';
import { ptBR } from './lite-markup-copy.pt-BR.ts';
import { it } from './lite-markup-copy.it.ts';
import { ru } from './lite-markup-copy.ru.ts';
import { pl } from './lite-markup-copy.pl.ts';
import { tr } from './lite-markup-copy.tr.ts';
import { vi } from './lite-markup-copy.vi.ts';

/**
 * 轻量视图的标记（轻量编辑器设计 §4）：舞台条上的「标记」钮、画面底上浮的工具条、标记层上的文字与评论、关闭时的确认。
 * 标注的种类名、标签与加不进去的原因在 video-annotations-copy。译文在 `lite-markup-copy.zh-Hans.ts` 等。
 */
const en = {
  /** 舞台条上的开关（轻量视图里叫「标记」，时间线视图仍是「标注」）。 */
  markup: 'Markup',
  exitMarkup: 'Exit markup',
  /** 工具条的读屏名与各个工具。 */
  toolbar: 'Markup tools',
  tools: { element: 'Select element', comment: 'Comment', pen: 'Pen', shape: 'Shape', text: 'Text' },
  shapes: { line: 'Line', arrow: 'Arrow', box: 'Rectangle', ellipse: 'Circle', pin: 'Number' },
  shapeMenu: 'Choose a shape',
  colors: { red: 'Red', blue: 'Blue', green: 'Green', black: 'Black', white: 'White' },
  color: 'Color',
  width: 'Stroke width',
  widthValue: (px: number) => `${px} px`,
  /** 下拉钮的提示：「颜色 · 红」。 */
  current: (name: string, value: string) => `${name} · ${value}`,
  /** 带快捷键的提示：「评论 · ⇧⌘C」。 */
  withKeys: (label: string, keys: string) => `${label} · ${keys}`,
  addToChat: 'Add to chat',
  close: 'Close markup',
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
  /** 「选择元素」悬停 HTML 动画里的节点时，说明卡上可访问性的标题与三行（照 DevTools 的检查提示）；空的值显示「—」。 */
  pickInfo: { heading: 'Accessibility', name: 'Name', role: 'Role', focusable: 'Keyboard-focusable' },
};

export type LiteMarkupMessages = typeof en;
export const LITE_MARKUP_COPY = defineMessages(en, {
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
