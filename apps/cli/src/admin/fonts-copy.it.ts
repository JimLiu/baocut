import type { FontsMessages } from './fonts-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: FontsMessages = {
  help: `Uso:
  baocut fonts [downloaded]        Font scaricati (Google Fonts, scaricati su richiesta):
                                   famiglia, pesi, dimensione, licenza e dimensione totale
  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]
                                   Elenco di selezione dei font: famiglie incluse nell’app, su questo computer e nel
                                   catalogo dei font, con il loro stato (integrate, su questo computer, scaricate,
                                   scaricabili, in download, non riuscite). Categorie: sans-serif, serif, display,
                                   handwriting, monospace; sistemi di scrittura: chinese, japanese, korean, latin…
  baocut fonts download <family> [--weights 400,700] [--italic]
                                   Scarica una famiglia (normale e grassetto per impostazione predefinita); l’avanzamento
                                   va a stderr, Ctrl-C annulla. Vengono inviati solo nome della famiglia e pesi; per i mirror
                                   vedi fonts.cssEndpoint e fonts.fileEndpoint; rifiutato in modalità rigorosamente offline
  baocut fonts remove <family>     Elimina i font scaricati della famiglia (rifiutato se usati da un’esportazione non completata)
  baocut fonts clear               Cancella i font scaricati (quelli usati da esportazioni non completate vengono conservati)`,
  alreadyDownloaded: (family: string) => `«${family}»: download già completato`, downloadDone: 'Download completato', remedy: (text: string) => `Per risolvere: ${text}`,
  usage: 'Uso: baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear',
  listSep: ', ', categoryChoices: (choices: readonly string[]) => `--category deve essere uno tra ${choices.join(', ')}`, scriptChoices: (choices: readonly string[]) => `--script deve essere uno tra ${choices.join(', ')}`, limitRange: '--limit deve essere un intero da 1 a 500', italicNeedsWeights: '--italic si usa con --weights', weightsFormat: '--weights accetta pesi da 1 a 1000 separati da virgole',
  stateLabels: { 'built-in': 'Integrato', installed: 'Su questo computer', downloaded: 'Scaricato', downloadable: 'Scaricabile', downloading: 'Download in corso', failed: 'Non riuscito', unavailable: 'Non disponibile' },
  face: (weight: number, italic: boolean) => `${weight}${italic ? ' corsivo' : ''}`, noDownloads: 'Nessun font ancora scaricato',
  downloadedTotal: (families: number, faces: number, size: string) => `${pluralForm('it', families, { one: `${families} famiglia`, other: `${families} famiglie` })}, ${pluralForm('it', faces, { one: `${faces} peso`, other: `${faces} pesi` })}, ${size} in totale`,
  noMatches: 'Nessun font corrispondente', failedWithReason: (state: string, message: string) => `${state} (${message})`, truncated: (total: number, shown: number) => `(${total} in totale, vengono mostrati i primi ${shown})`,
  removed: (count: number, freed: string) => `${pluralForm('it', count, { one: `${count} peso eliminato`, other: `${count} pesi eliminati` })}, spazio liberato ${freed}`,
  nothingToRemove: 'Nessun font da eliminare', kept: (count: number, faces: readonly string[]) => `${pluralForm('it', count, { one: `${count} conservato`, other: `${count} conservati` })} (in uso nelle esportazioni non completate): ${faces.join(', ')}`,
};
