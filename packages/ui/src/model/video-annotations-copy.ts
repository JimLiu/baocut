import { defineMessages } from '@baocut/protocol';
import { zhHans } from './video-annotations-copy.zh-Hans.ts';
import { zhHant } from './video-annotations-copy.zh-Hant.ts';
import { ja } from './video-annotations-copy.ja.ts';
import { ko } from './video-annotations-copy.ko.ts';
import { es } from './video-annotations-copy.es.ts';
import { fr } from './video-annotations-copy.fr.ts';
import { de } from './video-annotations-copy.de.ts';
import { nl } from './video-annotations-copy.nl.ts';
import { ptBR } from './video-annotations-copy.pt-BR.ts';
import { it } from './video-annotations-copy.it.ts';
import { ru } from './video-annotations-copy.ru.ts';
import { pl } from './video-annotations-copy.pl.ts';
import { tr } from './video-annotations-copy.tr.ts';
import { vi } from './video-annotations-copy.vi.ts';

/**
 * 视频标注的界面文案（产品设计 §3.2.3「视频标注」、§5.3「标注」；原型 stage-notes.jsx、model-stage-notes.js）：舞台工具条的
 * 「标注」钮、画面上方的小工具条、批注框、画面上的标记，与 composer 上方、已发送消息里的「视频标注 · N 条」。
 * 标签与标注列表的键名与设计稿的 `DESIGN` 对齐（`AnnotationsToken` 共用）。英文写在这里，译文在 `video-annotations-copy.zh-Hans.ts` 等。
 */
const en = {
  /**
   * 九种标注（给模型看的 kind 是英文的 box / arrow / text / pin / pen / line / ellipse / element / comment，不随界面语言变）；
   * 后五种从标记工具来（docs/design/lite-editor §4.1）。
   */
  kinds: {
    box: 'Box',
    arrow: 'Arrow',
    text: 'Text',
    pin: 'Number',
    pen: 'Pen',
    line: 'Line',
    ellipse: 'Circle',
    element: 'Element',
    comment: 'Comment',
  },
  /** 画面九宫位置（按标注的中心点）。 */
  places: {
    topLeft: 'top left',
    top: 'top',
    topRight: 'top right',
    left: 'left',
    center: 'center',
    right: 'right',
    bottomLeft: 'bottom left',
    bottom: 'bottom',
    bottomRight: 'bottom right',
  },
  /** 给人看的位置：「00:42.3 · 框 · 画面右上」。 */
  label: (timecode: string, kind: string, place: string) => `${timecode} · ${kind} · ${place} of the frame`,
  /** 画面上的标记：编号钮的读屏名、弹层里的移除。 */
  mark: (n: number, text: string) => `Annotation ${n}: ${text}`,
  removeFromChat: 'Remove from chat',
  /** composer 上方与已发送消息里的那一行。 */
  token: (n: number) => `Video annotations · ${n}`,
  added: (token: string) => `Added to chat · ${token}`,
  removeAll: 'Remove all video annotations',
  removeOne: (n: number) => `Remove annotation ${n}`,
  /** 列表里一条的读屏名称。 */
  item: (n: number, label: string, text: string) => `Annotation ${n}, ${label}: ${text}`,
  empty: 'Write an annotation first, then add it to the chat',
  tooLong: (max: number) => `An annotation can be at most ${max} characters`,
  tooMany: (max: number) => `A message can carry at most ${max} video annotations. Send these first.`,
  /** 框与箭头只点了一下、没有拖开。 */
  noArea: 'Drag out a box with some area',
  noArrowEnd: 'Drag the arrow to where it points',
  /** 轻量视图的标记：直线只点了一下、画笔不成一道、元素标注没点中元素。 */
  noLineEnd: 'Drag the line to its other end',
  noPath: 'Draw a stroke with the pen',
  noElement: 'Click an element in the picture first',
  /**
   * 点中元素给人看的说法（lite-editor §4.1）：字幕行带它的文字（截短过的，可能为空）；合成层与贴片带文字，没有文字时带 id。
   * HTML 节点直接写选择器与尺寸，不经文案。
   */
  elementCaption: (text: string) => (text ? `Caption · “${text}”` : 'Caption'),
  elementNode: (text: string, id: string) => (text ? `Element · “${text}”` : id ? `Element · ${id}` : 'Element'),
  /** 标签里落点的那一句（lite-editor §4.2）：「… · s03 · 第 2 句」，句序从 1 起。 */
  lineNo: (n: number) => `line ${n}`,
  /** 点列表里的一条，那部视频已经找不到了。 */
  gone: 'This video has been moved or deleted',
  /** 只带标注、没写话时发给智能体的那句。 */
  message: 'Please revise the video according to these annotations.',
};
export type VideoAnnotationMessages = typeof en;
export const VIDEO_NOTES = defineMessages(en, {
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
