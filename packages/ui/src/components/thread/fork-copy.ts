import { defineMessages } from '@baocut/protocol';
import { zhHans } from './fork-copy.zh-Hans.ts';
import { zhHant } from './fork-copy.zh-Hant.ts';
import { ja } from './fork-copy.ja.ts';
import { ko } from './fork-copy.ko.ts';
import { es } from './fork-copy.es.ts';
import { fr } from './fork-copy.fr.ts';
import { de } from './fork-copy.de.ts';
import { nl } from './fork-copy.nl.ts';
import { ptBR } from './fork-copy.pt-BR.ts';
import { it } from './fork-copy.it.ts';
import { ru } from './fork-copy.ru.ts';
import { pl } from './fork-copy.pl.ts';
import { tr } from './fork-copy.tr.ts';
import { vi } from './fork-copy.vi.ts';

/**
 * 分叉（产品设计 §3.2.2「分叉」，原型 agent-fork.jsx）的文案：回合页脚的分叉按钮与菜单、「把视频回到那时」对话框、分叉后的提示，
 * 以及线程顶上「分叉自…」那一条。英文是键与类型的来源，译文在 `fork-copy.<语言>.ts`。
 */
const en = {
  /** 回合页脚分叉按钮与菜单的无障碍标签。 */
  button: 'Fork from this turn',
  fork: 'Continue in a new session',
  forkHint: 'Brings the conversation up to this turn',
  restore: 'Continue with videos restored to then…',
  /** 菜单第二项的副文案：只有一部时写它，多部时写几部，都回不去时写原因；还在查版本记录时。 */
  restoreOne: (name: string) => `“${name}” goes back to the end of this turn`,
  restoreMany: (n: number) => `${n} videos go back to the end of this turn`,
  restoreNone: 'Versions from then are gone or can’t be read',
  checking: 'Checking version history…',
  dialogTitle: 'Fork and restore videos',
  dialogLead:
    'The new session brings the conversation up to this turn. The videos below go back to the end of this turn. Each restore is saved as a new version, so you can return from version history.',
  listLabel: 'Videos to restore',
  cancel: 'Cancel',
  confirm: 'Fork and restore',
  /** 每部视频的一行说明。 */
  ok: (version: number, undone: number) =>
    `Restore version ${version}. The ${undone} later ${undone === 1 ? 'version' : 'versions'} (your changes and other sessions’) are undone`,
  pruned: 'The version from then is gone (version history keeps only recent and saved versions)',
  createdAfter: 'This video was made after this turn, so it stays as is',
  chainBroken: 'Version history can’t be read back to then',
  done: 'Forked into a new session',
  doneRestored: (n: number) =>
    `Forked into a new session and restored ${n} ${n === 1 ? 'video' : 'videos'} to then. You can return from version history`,
  failed: (error: string) => `Couldn’t fork: ${error}`,
  /** 线程顶上那一条：分叉自哪条会话的第几轮；原会话删了时；带进去的记录。 */
  forkedFrom: (title: string, turn: number) => `Forked from “${title}” · through turn ${turn}`,
  sourceDeleted: '(original session deleted)',
  history: (turns: number, omitted: number) =>
    `History brought in · ${turns} ${turns === 1 ? 'turn' : 'turns'}${omitted ? ` (${omitted} earlier omitted)` : ''}`,
  hideHistory: 'Hide history',
};

export type ForkMessages = typeof en;

export const FORK_COPY = defineMessages(en, {
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
