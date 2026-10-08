import { defineMessages } from '@baocut/protocol';
import { zhHans } from './update-copy.zh-Hans.ts';
import { zhHant } from './update-copy.zh-Hant.ts';
import { ja } from './update-copy.ja.ts';
import { ko } from './update-copy.ko.ts';
import { es } from './update-copy.es.ts';
import { fr } from './update-copy.fr.ts';
import { de } from './update-copy.de.ts';
import { nl } from './update-copy.nl.ts';
import { ptBR } from './update-copy.pt-BR.ts';
import { it } from './update-copy.it.ts';
import { ru } from './update-copy.ru.ts';
import { pl } from './update-copy.pl.ts';
import { tr } from './update-copy.tr.ts';
import { vi } from './update-copy.vi.ts';

/** 更新动作失败时说的是哪一步。 */
export type UpdateStep = 'install' | 'check' | 'download' | 'cancel' | 'retry' | 'downloadPage';

const STEP: Record<UpdateStep, string> = {
  install: 'start installing',
  check: 'check for updates',
  download: 'start downloading',
  cancel: 'cancel the download',
  retry: 'retry',
  downloadPage: 'open the download page',
};

/** 应用更新（关于页、更新窗）的文案。英文写在这里，译文在 `update-copy.zh-Hans.ts`。 */
const en = {
  failed: (step: UpdateStep, message: string) => `Couldn’t ${STEP[step]}: ${message}`,
  progress: 'Download progress',
  notes: 'What’s new in this version',
  close: 'Close',
};

export type UpdateMessages = typeof en;

export const U = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
