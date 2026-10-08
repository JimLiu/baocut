import { pluralForm } from '@baocut/protocol';
import type { LegacyImportMessages } from './legacy-import-copy.ts';

const projects = (n: number) => pluralForm('pl', n, { one: 'projekt', few: 'projekty', many: 'projektów', other: 'projektu' });

export const pl: LegacyImportMessages = {
  title: 'Zaimportować projekty z wcześniejszej wersji?',
  lead: (n) =>
    `Na tym komputerze znaleziono: ${n} ${projects(n)} z wcześniejszej wersji BaoCut. Po zaimportowaniu można je dalej edytować w tej wersji. Oryginalne pliki zostają na miejscu, bez zmian.`,
  found: 'Znalezione projekty',
  destination: 'Importuj do',
  resetDefault: 'Użyj domyślnej lokalizacji',
  change: 'Zmień…',
  pickTitle: 'Wybierz, dokąd importować',
  destinationNote: 'Ten folder pojawi się w Home jako projekt, a każdy wcześniejszy projekt stanie się w nim filmem.',
  hint: 'Jeśli pominiesz, pytanie pojawi się znowu przy następnym uruchomieniu BaoCut. Zaznacz „Nie przypominaj więcej”, aby nigdy ich nie importować.',
  never: 'Nie przypominaj więcej',
  skip: 'Pomiń',
  import: 'Importuj',
  importing: (n) => `Import w tle: ${n} ${projects(n)} z wcześniejszej wersji`,
  neverDone: 'Nie będziemy już przypominać o imporcie wcześniejszych projektów. Oryginalne pliki zostają bez zmian.',
  skipped: 'Pominięto. Pytanie pojawi się znowu przy następnym uruchomieniu BaoCut.',
  failed: (message) => `Nie udało się zaimportować: ${message}`,
};
