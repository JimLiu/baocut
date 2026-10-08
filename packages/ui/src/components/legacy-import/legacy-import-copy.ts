import { defineMessages } from '@baocut/protocol';
import { zhHans } from './legacy-import-copy.zh-Hans.ts';
import { zhHant } from './legacy-import-copy.zh-Hant.ts';
import { ja } from './legacy-import-copy.ja.ts';
import { ko } from './legacy-import-copy.ko.ts';
import { es } from './legacy-import-copy.es.ts';
import { fr } from './legacy-import-copy.fr.ts';
import { de } from './legacy-import-copy.de.ts';
import { nl } from './legacy-import-copy.nl.ts';
import { ptBR } from './legacy-import-copy.pt-BR.ts';
import { it } from './legacy-import-copy.it.ts';
import { ru } from './legacy-import-copy.ru.ts';
import { pl } from './legacy-import-copy.pl.ts';
import { tr } from './legacy-import-copy.tr.ts';
import { vi } from './legacy-import-copy.vi.ts';

/** 启动时旧版项目导入询问的文案（英文是键与类型的来源，译文在 `legacy-import-copy.<语言>.ts`）。 */
const en = {
  title: 'Import projects from an earlier version?',
  lead: (n: number) =>
    n === 1
      ? 'There’s 1 project from an earlier version of BaoCut on this computer. Import it to keep editing in this version. The original files stay where they are, unchanged.'
      : `There are ${n} projects from an earlier version of BaoCut on this computer. Import them to keep editing in this version. The original files stay where they are, unchanged.`,
  found: 'Projects found',
  destination: 'Import to',
  resetDefault: 'Use default location',
  change: 'Change…',
  pickTitle: 'Choose where to import',
  destinationNote: 'This folder appears as a project in Home, and each earlier project becomes a video in it.',
  hint: 'If you skip, you’ll be asked again the next time BaoCut starts. Check “Don’t remind me again” to never import them.',
  never: 'Don’t remind me again',
  skip: 'Skip',
  import: 'Import',
  importing: (n: number) =>
    n === 1 ? 'Importing 1 earlier project in the background' : `Importing ${n} earlier projects in the background`,
  neverDone: 'You won’t be reminded to import earlier projects again. The original files stay as they are.',
  skipped: 'Skipped. You’ll be asked again the next time BaoCut starts.',
  failed: (message: string) => `Couldn’t import: ${message}`,
};

export type LegacyImportMessages = typeof en;

export const LI = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
