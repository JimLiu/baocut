import { defineMessages } from '@baocut/protocol';
import type { AddChapterRefusal } from '../../model/chapters.ts';
import { zhHans } from './chapter-copy.zh-Hans.ts';
import { zhHant } from './chapter-copy.zh-Hant.ts';
import { ja } from './chapter-copy.ja.ts';
import { ko } from './chapter-copy.ko.ts';
import { es } from './chapter-copy.es.ts';
import { fr } from './chapter-copy.fr.ts';
import { de } from './chapter-copy.de.ts';
import { nl } from './chapter-copy.nl.ts';
import { ptBR } from './chapter-copy.pt-BR.ts';
import { it } from './chapter-copy.it.ts';
import { ru } from './chapter-copy.ru.ts';
import { pl } from './chapter-copy.pl.ts';
import { tr } from './chapter-copy.tr.ts';
import { vi } from './chapter-copy.vi.ts';

/** 编辑器里章节的文案：时间线章节条、右键菜单、加 / 改名浮层、走带的上一章 / 下一章、文稿的章节头行。译文在 `chapter-copy.zh-Hans.ts`。 */
const en = {
  band: 'Chapters',
  prev: 'Previous chapter',
  next: 'Next chapter',
  noChapters: 'No chapters yet',
  /** 章节条上没有章的空当（第一章之前、章与章之间）。 */
  gap: 'No chapter',
  beforeFirst: 'Before the first chapter',
  add: 'Add chapter at playhead',
  rename: 'Rename…',
  remove: 'Delete this chapter',
  menuLabel: (title: string) => `Chapter “${title}”`,
  gapMenuLabel: 'Chapter bar',
  /** 章节条一段的读屏名：标题加起止。 */
  segmentLabel: (title: string, range: string) => `${title}, ${range}, click to jump to the start`,
  dragHint: 'Drag to move the start of this chapter',
  /** 加 / 改名浮层。 */
  addTitle: 'Add chapter',
  renameTitle: 'Rename chapter',
  titleLabel: 'Title',
  addAt: (time: string) => `Starts at ${time} and runs to the next chapter`,
  confirmAdd: 'Add',
  confirmRename: 'Rename',
  cancel: 'Cancel',
  refusal: {
    exists: 'There’s already a chapter at the playhead',
    beyond: 'The playhead is at the end; a chapter can’t be added here',
    blank: 'The title can’t be blank',
  } satisfies Record<AddChapterRefusal, string>,
  /** 编辑事务的名字（撤销按钮上「撤销「…」」）。 */
  labels: { add: 'Add chapter', rename: 'Rename chapter', remove: 'Delete chapter', move: 'Move chapter start' },
  added: (title: string) => `Added chapter “${title}”`,
  renamed: (title: string) => `Renamed to “${title}”`,
  removed: (title: string) => `Deleted chapter “${title}”`,
  undo: 'Undo',
  /** 文稿的章节头行。 */
  clickRename: 'Click to rename',
  jump: 'Jump to the start of this chapter',
  paragraphs: (n: number) => `${n} paragraph${n === 1 ? '' : 's'}`,
  empty: 'This chapter has no paragraphs yet',
};

export type ChapterMessages = typeof en;
export const CHAPTER_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
