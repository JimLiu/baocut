import type { FontsMessages } from './fonts-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const nl: FontsMessages = {
 help: `Gebruik:
  baocut fonts [downloaded]        Gedownloade lettertypen (Google Fonts, op aanvraag gedownload):
                                   familie, gewichten, grootte, licentie en totale grootte
  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]
                                   Lettertypelijst: families uit de app, op deze computer en in de catalogus,
                                   met hun status (ingebouwd, op deze computer, gedownload, downloadbaar,
                                   wordt gedownload, mislukt). Categorieën: sans-serif, serif, display, handwriting,
                                   monospace; schriften: chinese, japanese, korean, latin…
  baocut fonts download <family> [--weights 400,700] [--italic]
                                   Een familie downloaden (standaard normaal en vet); voortgang naar stderr, Ctrl-C
                                   annuleert. Alleen familienaam en gewichten worden verzonden; voor spiegelservers zie
                                   fonts.cssEndpoint en fonts.fileEndpoint; geweigerd in strikte offlinemodus
  baocut fonts remove <family>     Gedownloade bestanden van deze familie verwijderen (geweigerd bij gebruik door een onvoltooide export)
  baocut fonts clear               Gedownloade lettertypen wissen (gebruikt door onvoltooide exports blijven behouden)`,
 alreadyDownloaded: (family) => `‘${family}’ is al gedownload`, downloadDone: 'Download klaar', remedy: (text) => `Oplossing: ${text}`, usage: 'Gebruik: baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear', listSep: ', ', categoryChoices: (choices) => `--category moet een van ${choices.join(', ')} zijn`, scriptChoices: (choices) => `--script moet een van ${choices.join(', ')} zijn`, limitRange: '--limit moet een geheel getal van 1 tot 500 zijn', italicNeedsWeights: '--italic hoort bij --weights', weightsFormat: '--weights accepteert gewichten van 1 tot 1000, gescheiden door komma’s', stateLabels: { 'built-in': 'Ingebouwd', installed: 'Op deze computer', downloaded: 'Gedownload', downloadable: 'Downloadbaar', downloading: 'Wordt gedownload', failed: 'Mislukt', unavailable: 'Niet beschikbaar' }, face: (weight, italic) => `${weight}${italic ? ' cursief' : ''}`, noDownloads: 'Nog geen gedownloade lettertypen', downloadedTotal: (families, faces, size) => `${families} ${pluralForm('nl', families, { one: 'familie', other: 'families' })}, ${faces} ${pluralForm('nl', faces, { one: 'gewicht', other: 'gewichten' })}, ${size} in totaal`, noMatches: 'Geen passende lettertypen', failedWithReason: (state, message) => `${state} (${message})`, truncated: (total, shown) => `(${total} in totaal, de eerste ${shown} worden getoond)`, removed: (count, freed) => `${count} ${pluralForm('nl', count, { one: 'gewicht', other: 'gewichten' })} verwijderd, ${freed} vrijgemaakt`, nothingToRemove: 'Geen lettertypen om te verwijderen', kept: (count, faces) => `${count} behouden (in gebruik door onvoltooide exports): ${faces.join(', ')}`,
};
