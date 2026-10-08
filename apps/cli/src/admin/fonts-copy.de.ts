import type { FontsMessages } from './fonts-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const de: FontsMessages = {
  help: `Verwendung:
  baocut fonts [downloaded]        Heruntergeladene Schriften (Google Fonts, bei Bedarf geladen):
                                   Familie, Stärken, Größe, Lizenz und Gesamtgröße
  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]
                                   Schriftauswahl: mitgelieferte, auf diesem Computer installierte und im Katalog verfügbare
                                   Familien mit Status (integriert, auf diesem Computer, heruntergeladen, herunterladbar,
                                   wird geladen, fehlgeschlagen). Kategorien: sans-serif, serif, display, handwriting,
                                   monospace; Schriftsysteme: chinese, japanese, korean, latin…
  baocut fonts download <family> [--weights 400,700] [--italic]
                                   Familie herunterladen (standardmäßig normal und fett); Fortschritt an stderr, Ctrl-C
                                   bricht ab. Nur Familienname und Stärken werden gesendet; für Mirrors siehe
                                   fonts.cssEndpoint und fonts.fileEndpoint; im strikten Offlinemodus abgelehnt
  baocut fonts remove <family>     Heruntergeladene Schriften der Familie löschen (abgelehnt, solange ein laufender Export sie nutzt)
  baocut fonts clear               Heruntergeladene Schriften löschen (von laufenden Exporten genutzte bleiben erhalten)`, alreadyDownloaded: (family) => `„${family}“ wurde bereits heruntergeladen`, downloadDone: 'Download abgeschlossen', remedy: (text) => `Abhilfe: ${text}`, usage: 'Verwendung: baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear', listSep: ', ', categoryChoices: (choices) => `--category muss einer dieser Werte sein: ${choices.join(', ')}`, scriptChoices: (choices) => `--script muss einer dieser Werte sein: ${choices.join(', ')}`, limitRange: '--limit muss eine ganze Zahl von 1 bis 500 sein', italicNeedsWeights: '--italic gehört zu --weights', weightsFormat: '--weights akzeptiert durch Kommas getrennte Stärken von 1 bis 1000', stateLabels: { 'built-in': 'Integriert', installed: 'Auf diesem Computer', downloaded: 'Heruntergeladen', downloadable: 'Herunterladbar', downloading: 'Wird heruntergeladen', failed: 'Fehlgeschlagen', unavailable: 'Nicht verfügbar' }, face: (weight, italic) => `${weight}${italic ? ' kursiv' : ''}`, noDownloads: 'Noch keine heruntergeladenen Schriften', downloadedTotal: (families, faces, size) => `${families} ${pluralForm('de', families, { one: 'Familie', other: 'Familien' })}, ${faces} ${pluralForm('de', faces, { one: 'Stärke', other: 'Stärken' })}, insgesamt ${size}`, noMatches: 'Keine passenden Schriften', failedWithReason: (state, message) => `${state} (${message})`, truncated: (total, shown) => `(${total} insgesamt, die ersten ${shown} werden angezeigt)`, removed: (count, freed) => `${count} ${pluralForm('de', count, { one: 'Stärke gelöscht', other: 'Stärken gelöscht' })}, ${freed} freigegeben`, nothingToRemove: 'Keine Schriften zu löschen', kept: (count, faces) => `${count} beibehalten (von laufenden Exporten genutzt): ${faces.join(', ')}`,
};
