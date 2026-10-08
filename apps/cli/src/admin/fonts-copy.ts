import { defineMessages, type FontFamilyState } from '@baocut/protocol';
import { zhHans } from './fonts-copy.zh-Hans.ts';
import { zhHant } from './fonts-copy.zh-Hant.ts';
import { ja } from './fonts-copy.ja.ts';
import { ko } from './fonts-copy.ko.ts';
import { es } from './fonts-copy.es.ts';
import { fr } from './fonts-copy.fr.ts';
import { de } from './fonts-copy.de.ts';
import { nl } from './fonts-copy.nl.ts';
import { ptBR } from './fonts-copy.pt-BR.ts';
import { it } from './fonts-copy.it.ts';
import { ru } from './fonts-copy.ru.ts';
import { pl } from './fonts-copy.pl.ts';
import { tr } from './fonts-copy.tr.ts';
import { vi } from './fonts-copy.vi.ts';

/** `baocut fonts …` 的文案（英文是键与类型的来源，译文在 `fonts-copy.<语言>.ts`）。 */
const en = {
  /** `baocut fonts --help` 的正文。 */
  help: `Usage:
  baocut fonts [downloaded]        Downloaded fonts (Google Fonts, downloaded on demand):
                                   family, weights, size, license, and the total size
  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]
                                   Font picker list: families bundled with the app, on this computer, and in the font
                                   catalog, with their status (built-in, on this computer, downloaded, downloadable,
                                   downloading, failed). Categories: sans-serif, serif, display, handwriting,
                                   monospace; scripts: chinese, japanese, korean, latin…
  baocut fonts download <family> [--weights 400,700] [--italic]
                                   Download a family (regular and bold by default); progress goes to stderr, Ctrl-C
                                   cancels. Only the family name and weights are sent; for mirrors see the
                                   fonts.cssEndpoint and fonts.fileEndpoint settings; refused in strict offline mode
  baocut fonts remove <family>     Delete this family's downloaded fonts (refused while an unfinished export uses them)
  baocut fonts clear               Clear downloaded fonts (ones used by unfinished exports are kept)`,
  alreadyDownloaded: (family: string) => `"${family}" is already downloaded`,
  downloadDone: 'Download complete',
  remedy: (text: string) => `To fix: ${text}`,
  usage:
    'Usage: baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear',
  listSep: ', ',
  categoryChoices: (choices: readonly string[]) => `--category must be one of ${choices.join(', ')}`,
  scriptChoices: (choices: readonly string[]) => `--script must be one of ${choices.join(', ')}`,
  limitRange: '--limit must be a whole number from 1 to 500',
  italicNeedsWeights: '--italic goes with --weights',
  weightsFormat: '--weights takes comma-separated weights from 1 to 1000',
  stateLabels: {
    'built-in': 'Built-in',
    installed: 'On this computer',
    downloaded: 'Downloaded',
    downloadable: 'Downloadable',
    downloading: 'Downloading',
    failed: 'Failed',
    unavailable: 'Unavailable',
  } satisfies Record<FontFamilyState, string>,
  face: (weight: number, italic: boolean) => `${weight}${italic ? ' italic' : ''}`,
  noDownloads: 'No downloaded fonts yet',
  downloadedTotal: (families: number, faces: number, size: string) =>
    `${families} ${families === 1 ? 'family' : 'families'}, ${faces} ${faces === 1 ? 'weight' : 'weights'}, ${size} in total`,
  noMatches: 'No matching fonts',
  failedWithReason: (state: string, message: string) => `${state} (${message})`,
  truncated: (total: number, shown: number) => `(${total} in total, showing the first ${shown})`,
  removed: (count: number, freed: string) => `Deleted ${count} ${count === 1 ? 'weight' : 'weights'}, freed ${freed}`,
  nothingToRemove: 'No fonts to delete',
  kept: (count: number, faces: readonly string[]) => `Kept ${count} (in use by unfinished exports): ${faces.join(', ')}`,
};

export type FontsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
