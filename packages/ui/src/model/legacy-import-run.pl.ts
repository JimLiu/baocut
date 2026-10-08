import { pluralForm } from '@baocut/protocol';
import type { LegacyImportRunMessages } from './legacy-import-run.ts';

const projects = (n: number) =>
  `${n} ${pluralForm('pl', n, { one: 'projekt', few: 'projekty', many: 'projektów', other: 'projektu' })}`;
const earlierProjects = (n: number) =>
  `${n} ${pluralForm('pl', n, {
    one: 'wcześniejszy projekt',
    few: 'wcześniejsze projekty',
    many: 'wcześniejszych projektów',
    other: 'wcześniejszego projektu',
  })}`;

export const pl: LegacyImportRunMessages = {
  offlineTitle: (name) => `Dysk „${name}” nie jest podłączony`,
  offlineWhy: (n, root) =>
    `Filmy używane przez ${n === 1 ? 'ten projekt' : `te projekty (${n})`} są na tym dysku (${root}), którego teraz nie da się odczytać.`,
  offlineFix:
    'Podłącz dysk i kliknij „Spróbuj ponownie”. Jeśli nic nie zrobisz, BaoCut spróbuje ponownie przy następnym uruchomieniu. Jeśli materiały nie są już potrzebne, kliknij „Pomiń” — wtedy nic nie zostanie zaimportowane.',
  offlineShort: (n, name) => `${projects(n)}: materiały na niepodłączonym dysku „${name}”`,
  missingTitle: 'Pliki multimedialne nie są tam, gdzie były',
  missingWhy:
    'Pliki używane przez projekt zostały przeniesione, przemianowane lub usunięte, więc ścieżki zapisane we wcześniejszym projekcie już ich nie znajdują.',
  missingFix: 'Przywróć pliki na dawne miejsce i kliknij „Spróbuj ponownie”. Jeśli nie da się ich odzyskać, kliknij „Pomiń”.',
  missingShort: (n) => `${projects(n)}: nie można znaleźć plików multimedialnych`,
  unreadableTitle: 'Nie można odczytać pliku wcześniejszego projektu',
  unreadableWhy: 'Plik wcześniejszego projektu może być uszkodzony, więc ponowna próba raczej nie pomoże.',
  unreadableFix:
    'Pokaż go w folderze i sprawdź, czy oryginał nadal tam jest i otwiera się we wcześniejszej wersji. Jeśli nie jest potrzebny, kliknij „Pomiń”.',
  unreadableShort: (n) => `${projects(n)}: nie można odczytać pliku projektu`,
  failedTitle: 'Import zatrzymał się w połowie',
  failedWhy: 'Projekt został odczytany, ale jego import zatrzymał się w połowie. Przebieg zapisano w raporcie importu.',
  failedFix:
    'Kliknij „Spróbuj ponownie”, aby spróbować jeszcze raz. Jeśli nadal się nie uda, pokaż raport w folderze. Jeśli projekt nie jest potrzebny, kliknij „Pomiń”.',
  failedShort: (n) => `${projects(n)}: import zatrzymał się w połowie`,
  missingMany: (n, first) => `Brakuje plików: ${n}, na przykład ${first}`,
  missingOne: (file) => `Brakuje pliku ${file}`,
  missingNone: 'Nie można znaleźć plików multimedialnych',
  failedReport: (report) => `Raport importu: ${report}`,
  failedNoReport: 'Nie zapisano raportu importu',
  note: (parts) => `${parts.join('; ')}.`,
  hintOffline: (name) =>
    `Podłącz „${name}” i kliknij „Ponów wszystkie”. Jeśli nic nie zrobisz, BaoCut spróbuje ponownie przy następnym uruchomieniu. Aby zająć się nimi pojedynczo, otwórz szczegóły.`,
  hintOther: 'Przyczyna i to, co zrobić z każdym z nich, są w szczegółach. Niepotrzebne możesz pominąć.',
  subProgress: (done, total) => `Zaimportowano ${done}/${total}`,
  subImported: (n) => `Zaimportowano ${n}`,
  subPending: (n) => `Do rozwiązania ${n}`,
  subSkipped: (n) => `Pominięto ${n}`,
  subDest: (dest) => `Do ${dest}`,
  attention: (n) => `Do rozwiązania: ${n}`,
  phaseImporting: 'Importowanie',
  phaseWaiting: 'Czeka na inne zadania',
  detailImporting: (title) => `Importowanie „${title}”`,
  detailWaiting: 'Trwają inne zadania, więc import jest wstrzymany. Wznowi się automatycznie, gdy się zakończą.',
  bannerRunning: (done, total) => `Importowanie wcześniejszych projektów · ${done}/${total}`,
  bannerResult: (imported, pending) =>
    `Import wcześniejszych projektów zakończony: zaimportowano ${imported}, nie zaimportowano ${pending}`,
  doneAll: (n) => `Zaimportowano ${earlierProjects(n)}`,
  doneSome: (imported, pending) => `Import zakończony: zaimportowano ${imported}, nie zaimportowano ${pending}`,
  retriedAll: (n) =>
    n === 1 ? 'Ponowiony projekt został zaimportowany' : `Zaimportowano wszystkie ponowione projekty (${n})`,
  retriedSome: (n, ok) => `Z ponowionych (${n}): zaimportowano ${ok}, nadal nie zaimportowano ${n - ok}`,
  retriedNone: (n) =>
    n === 1 ? 'Ponowiony projekt nadal nie został zaimportowany' : `Ponowione projekty (${n}) nadal nie zostały zaimportowane`,
  retrying: (n) => `Ponowny import: ${projects(n)}`,
  skipped: (n) => `Pominięto ${projects(n)}. Automatyczny import nie nastąpi.`,
  actionFailed: (message) => `Nie udało się: ${message}`,
  undo: 'Cofnij',
  viewReasons: 'Pokaż przyczyny',
  viewInSpace: 'Pokaż w Space',
  viewProgress: 'Pokaż postęp',
  close: 'Zamknij',
  retryAll: 'Ponów wszystkie',
  skipAll: 'Pomiń wszystkie',
  retry: 'Spróbuj ponownie',
  skip: 'Pomiń',
  reveal: 'Pokaż w folderze',
  importInstead: 'Importuj',
  statImported: 'Zaimportowane',
  statPending: 'Niezaimportowane',
  statSkipped: 'Pominięte',
  statLive: 'Jeszcze niezaimportowane',
  pendingSection: 'Niezaimportowane projekty',
  pendingHint: 'Jeśli nic nie zrobisz, BaoCut spróbuje ponownie przy następnym uruchomieniu. Pominięte nie są importowane.',
  howTo: 'Co zrobić: ',
  groupTitle: (title, n) => `${title} · ${n}`,
  liveSection: 'Importowane',
  importingChip: 'Importowanie',
  queuedChip: 'W kolejce',
  importedSection: 'Zaimportowane',
  skippedSection: 'Pominięte',
  skippedHint: 'Nie będą importowane automatycznie. Oryginalne pliki zostają na miejscu.',
  expand: (n) => `Pokaż jeszcze ${n}`,
  collapse: 'Pokaż mniej',
};
