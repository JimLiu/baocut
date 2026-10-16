import { defineMessages } from '@baocut/protocol';
import { zhHans } from './save-download-copy.zh-Hans.ts';
import { zhHant } from './save-download-copy.zh-Hant.ts';
import { ja } from './save-download-copy.ja.ts';
import { ko } from './save-download-copy.ko.ts';
import { es } from './save-download-copy.es.ts';
import { fr } from './save-download-copy.fr.ts';
import { de } from './save-download-copy.de.ts';
import { nl } from './save-download-copy.nl.ts';
import { ptBR } from './save-download-copy.pt-BR.ts';
import { it } from './save-download-copy.it.ts';
import { ru } from './save-download-copy.ru.ts';
import { pl } from './save-download-copy.pl.ts';
import { tr } from './save-download-copy.tr.ts';
import { vi } from './save-download-copy.vi.ts';

/** 下载与另存的结果提示（save-download.ts）。 */
const en = {
  saved: (path: string) => `Saved to ${path}`,
  failed: (reason: string) => `Couldn't save: ${reason}`,
};
export type SaveDownloadMessages = typeof en;
export const SAVE = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
