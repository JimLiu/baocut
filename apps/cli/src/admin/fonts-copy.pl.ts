import { pluralForm } from '@baocut/protocol';
import type { FontsMessages } from './fonts-copy.ts';

export const pl: FontsMessages = {
  help: "Użycie:\n  baocut fonts [downloaded]        Pobrane czcionki (Google Fonts, na żądanie):\n                                   rodzina, grubości, rozmiar, licencja i łączny rozmiar\n  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]\n                                   Lista wyboru czcionek: rodziny aplikacji, komputera i katalogu\n                                   ze stanem (wbudowana, na komputerze, pobrana, do pobrania,\n                                   pobierana, niepowodzenie). Kategorie: sans-serif, serif, display, handwriting,\n                                   monospace; pisma: chinese, japanese, korean, latin…\n  baocut fonts download <family> [--weights 400,700] [--italic]\n                                   Pobierz rodzinę (zwykła i pogrubiona domyślnie); postęp w stderr, Ctrl-C\n                                   anuluje. Wysyłana tylko nazwa rodziny i grubości; serwery lustrzane w ustawieniach\n                                   fonts.cssEndpoint i fonts.fileEndpoint; odrzucane w ścisłym trybie offline\n  baocut fonts remove <family>     Usuń pobrane czcionki rodziny (niemożliwe podczas użycia przez nieukończony eksport)\n  baocut fonts clear               Wyczyść pobrane czcionki (używane przez nieukończony eksport zostają zachowane)",
  alreadyDownloaded: (family) => `„${family}” już pobrano`,
  downloadDone: "Pobieranie ukończone",
  remedy: (text) => `Jak naprawić: ${text}`,
  usage:
    "Użycie: baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear",
  listSep: ", ",
  categoryChoices: (choices: readonly string[]) => `--category musi być jedną z wartości ${choices.join(", ")}`,
  scriptChoices: (choices: readonly string[]) => `--script musi być jedną z wartości ${choices.join(", ")}`,
  limitRange: "--limit musi być liczbą całkowitą od 1 do 500",
  italicNeedsWeights: "--italic stosuje się z --weights",
  weightsFormat: "--weights przyjmuje grubości od 1 do 1000 oddzielone przecinkami",
  stateLabels: {
    'built-in': "Wbudowany",
    installed: "Na tym komputerze",
    downloaded: "Pobrano",
    downloadable: "Do pobrania",
    downloading: "Pobieranie",
    failed: "Niepowodzenie",
    unavailable: "Niedostępne",
  },
  face: (weight: number, italic: boolean) => `${weight}${italic ? " kursywa" : ""}`,
  noDownloads: "Nie ma jeszcze pobranych czcionek",
  downloadedTotal: (families: number, faces: number, size: string) => `${pluralForm('pl', families, { one: `${families} rodzina`, few: `${families} rodziny`, many: `${families} rodzin`, other: `${families} rodziny` })}, ${pluralForm('pl', faces, { one: `${faces} grubość`, few: `${faces} grubości`, many: `${faces} grubości`, other: `${faces} grubości` })}, ${size} łącznie`,
  noMatches: "Brak pasujących czcionek",
  failedWithReason: (state: string, message: string) => `${state} (${message})`,
  truncated: (total: number, shown: number) => `(${total} łącznie, pokazano pierwsze ${shown})`,
  removed: (count: number, freed: string) => `${pluralForm('pl', count, { one: `Usunięto ${count} grubość`, few: `Usunięto ${count} grubości`, many: `Usunięto ${count} grubości`, other: `Usunięto ${count} grubości` })}, zwolniono ${freed}`,
  nothingToRemove: "Brak czcionek do usunięcia",
  kept: (count: number, faces: readonly string[]) => `Zachowano: ${count} (używane przez nieukończony eksport): ${faces.join(", ")}`,
};
