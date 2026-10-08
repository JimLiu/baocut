import { defineMessages } from '@baocut/protocol';
import { zhHans } from './font-copy.zh-Hans.ts';
import { zhHant } from './font-copy.zh-Hant.ts';
import { ja } from './font-copy.ja.ts';
import { ko } from './font-copy.ko.ts';
import { es } from './font-copy.es.ts';
import { fr } from './font-copy.fr.ts';
import { de } from './font-copy.de.ts';
import { nl } from './font-copy.nl.ts';
import { ptBR } from './font-copy.pt-BR.ts';
import { it } from './font-copy.it.ts';
import { ru } from './font-copy.ru.ts';
import { pl } from './font-copy.pl.ts';
import { tr } from './font-copy.tr.ts';
import { vi } from './font-copy.vi.ts';

/** 字体表、字体详情、字体框与字体下载条的文案。译文在 `font-copy.zh-Hans.ts`。 */
const en = {
  cancelDownload: 'Cancel download',
  searchFonts: 'Search fonts',
  searchFontsPlaceholder: 'Search fonts…',
  category: 'Category',
  allCategories: 'All categories',
  script: 'Script',
  allScripts: 'All scripts',
  listFailed: 'Couldn’t get the font list',
  listLoading: 'Getting the font list…',
  noMatch: 'No matching fonts',
  downloadable: (count: string) => ` · ${count} downloadable`,
  use: (family: string) => `Use ${family}`,
  download: 'Download',
  downloadFamily: (family: string) => `Download ${family}`,
  cancelDownloadFamily: (family: string) => `Cancel download of ${family}`,
  retryTip: (message: string) => `Try again · ${message}`,
  retryFamily: (family: string) => `Try downloading ${family} again`,
  detailsTip: 'Font details and license',
  detailsFamily: (family: string) => `${family} details and license`,
  skipThis: 'Skip this one',
  cancelAllTip: 'Cancel all · use fallback fonts for now',
  cancelAll: 'Cancel all',
  collapse: 'Hide',
  view: 'View',
  gotIt: 'Got it',
  settings: 'Settings',
  progress: 'Font download progress',
  retry: 'Try again',
  systemFont: 'System font',
  pingFang: 'PingFang SC',
  songti: 'Songti SC',
  kaiti: 'Kaiti SC',
  font: 'Font',
  fontValue: (label: string, font: string) => `${label}: ${font}`,
  backToList: 'Back to font list',
  deleteDownloaded: 'Delete downloaded files',
  useThis: 'Use this font',
};

export type FontMessages = typeof en;
export const FONT_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
