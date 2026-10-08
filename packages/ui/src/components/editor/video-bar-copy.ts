import { defineMessages } from '@baocut/protocol';
import { zhHans } from './video-bar-copy.zh-Hans.ts';
import { zhHant } from './video-bar-copy.zh-Hant.ts';
import { ja } from './video-bar-copy.ja.ts';
import { ko } from './video-bar-copy.ko.ts';
import { es } from './video-bar-copy.es.ts';
import { fr } from './video-bar-copy.fr.ts';
import { de } from './video-bar-copy.de.ts';
import { nl } from './video-bar-copy.nl.ts';
import { ptBR } from './video-bar-copy.pt-BR.ts';
import { it } from './video-bar-copy.it.ts';
import { ru } from './video-bar-copy.ru.ts';
import { pl } from './video-bar-copy.pl.ts';
import { tr } from './video-bar-copy.tr.ts';
import { vi } from './video-bar-copy.vi.ts';

/** 视频栏（名称、保存状态、版本与历史）的文案。译文在 `video-bar-copy.zh-Hans.ts`。 */
const en = {
  closeToSpace: 'Close video · back to Space',
  closeToHome: 'Close video · back to Home',
  untitled: 'Video',
  rename: 'Rename video',
  details: 'Video details',
  actions: 'Video actions',
  showInSpace: 'Show in Space',
  revealVideoFolder: 'Show Video Folder',
  close: 'Close video',
  nameLabel: 'Name',
  save: 'Save',
  openFailed: 'Can’t open',
  stale: 'Not caught up · can’t edit for now',
  openingAria: 'Opening',
  opening: 'Opening…',
  savingAria: 'Saving',
  saving: 'Saving…',
  agentChanged: (label: string) => `The agent changed the video: ${label}`,
  savedByAgent: (label: string) => `Saved · Agent: ${label}`,
  saved: 'Saved',
  versionHistory: (revision: string) => `Version ${revision}, view history`,
  version: (revision: string) => `Version ${revision}`,
  historyFailed: (message: string) => `Couldn’t load history: ${message}`,
  history: 'History',
  historyLoading: 'Loading history',
  noChanges: 'No changes yet.',
  undoneMark: ' (undone)',
  historyMeta: (revision: string, actor: string, ago: string) => `Version ${revision} · ${actor} · ${ago}`,
  undo: 'Undo',
  actorAgent: 'Agent',
  actorSystem: 'System',
  actorYou: 'You',
};

export type VideoBarMessages = typeof en;
export const VIDEO_BAR_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
