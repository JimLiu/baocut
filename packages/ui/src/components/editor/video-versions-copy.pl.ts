import { pluralForm } from '@baocut/protocol';
import type { VideoVersionsMessages } from './video-versions-copy.ts';

export const pl: VideoVersionsMessages = {
  title: 'Historia wersji',
  close: 'Zamknij historię wersji',
  tipLatest: (version: number) => `Najnowsza wersja: ${version}`,
  tipNone: 'Nie ma jeszcze wersji',
  tipOutside: 'To wideo nie jest w projekcie',
  loading: 'Wczytywanie historii wersji',
  loadFailed: (message: string) => `Nie udało się wczytać historii wersji: ${message}`,
  stateSynced: 'Migawka aktualna',
  stateSyncedDesc: 'Migawka obszaru roboczego w folderze wideo zgadza się z bieżącą treścią.',
  statePending: 'Zapisywanie migawki',
  statePendingDesc: 'Ostatnie zmiany trafią do migawki i historii wersji w ciągu kilku sekund.',
  stateConflict: 'Zmieniono i migawkę, i BaoCut',
  stateConflictDesc:
    'Pliki migawki zmieniono poza BaoCut, a BaoCut też ma zmiany, których jeszcze nie ma w migawce. BaoCut nie nadpisze migawki, dopóki nie wybierzesz, co zachować.',
  stateInvalid: 'Nie można odczytać migawki',
  stateInvalidDesc:
    'Nie można przetworzyć plików migawki, więc BaoCut ich nie zaimportował. BaoCut sprawdzi je ponownie, gdy je naprawisz; możesz też nadpisać je treścią z BaoCut.',
  stateExternal: 'Importowanie zmian zewnętrznych',
  stateExternalDesc:
    'Pliki migawki zmieniono poza BaoCut (git pull, dysk synchronizowany lub ręczna edycja), a BaoCut nie ma innych zmian, więc importuje je jako wersję „Zmiana zewnętrzna”.',
  stateMissing: 'Nie ma jeszcze migawki',
  stateMissingDesc: 'Migawka obszaru roboczego nie została jeszcze zapisana albo brakuje pliku video.json.',
  stateRebuild: 'Wymaga odbudowy',
  stateRebuildDesc: 'Jest tylko migawka obszaru roboczego, bez biblioteki wideo. BaoCut odbuduje z niej wideo przy otwarciu.',
  footer: (keep: number) =>
    `Wersje są przechowywane w folderze wideo w .bcut-snapshot/history/ i nie zależą od git. BaoCut zachowuje ${pluralForm('pl', keep, {
      one: `${keep} najnowszą nienazwaną wersję`,
      few: `${keep} najnowsze nienazwane wersje`,
      many: `${keep} najnowszych nienazwanych wersji`,
      other: `${keep} najnowszej nienazwanej wersji`,
    })} oraz wszystkie zapisane wersje.`,
  save: 'Zapisz wersję',
  saveIntro: 'Zapisz bieżącą treść jako nazwaną wersję. Zapisane wersje nigdy nie są usuwane automatycznie; tylko ty możesz je usunąć.',
  nameLabel: 'Nazwa',
  namePlaceholder: 'Na przykład: Montaż do recenzji',
  nameRequired: 'Nadaj tej wersji nazwę',
  noteLabel: 'Notatka (opcjonalnie)',
  cancel: 'Anuluj',
  saveSubmit: 'Zapisz',
  conflictIntro:
    'Te pliki migawki zmieniono poza BaoCut, być może przez git pull, dysk synchronizowany lub ręczną edycję, a BaoCut też ma zmiany, których jeszcze nie ma w migawce:',
  conflictOutro: 'Dopóki nie wybierzesz, co zachować, BaoCut nie nadpisze migawki. Możesz dalej edytować wideo, ale nie możesz zapisywać wersji ani do nich wracać.',
  invalidIntro: 'Nie można przetworzyć tych plików migawki. Mogą zawierać znaczniki konfliktu scalania, być obcięte albo uszkodzone ręczną edycją:',
  invalidOutro:
    'BaoCut ich nie zaimportował. Możesz dalej edytować wideo, ale nie możesz zapisywać wersji ani do nich wracać. BaoCut sprawdzi je ponownie, gdy naprawisz te pliki; możesz też zachować treść z BaoCut i je nadpisać.',
  externalIntro: 'Te pliki migawki zmieniono poza BaoCut, być może przez git pull, dysk synchronizowany lub ręczną edycję:',
  externalOutro: 'BaoCut nie ma zmian, których nie ma jeszcze w migawce, więc importuje je od razu jako wersję „Zmiana zewnętrzna”. Import możesz potem cofnąć.',
  stripConflict: 'Migawkę zmieniono poza BaoCut, a BaoCut też ma nowe zmiany. Wybierz, co zachować.',
  stripInvalid: 'Nie można odczytać plików migawki. BaoCut ich nie zaimportował.',
  view: 'Pokaż',
  keepVideo: 'Zachowaj treść z BaoCut',
  useSnapshot: 'Użyj migawki z dysku',
  keepTitle: 'Zachować treść z BaoCut?',
  keepConfirm: 'Nadpisz migawkę na dysku',
  keepBody: (count: number, files: string, invalid: boolean) =>
    `Treść z BaoCut zostanie od razu zapisana w migawce i nadpisze ${pluralForm('pl', count, {
      one: `${count} ${invalid ? 'nieczytelny' : 'zmieniony'} plik`,
      few: `${count} ${invalid ? 'nieczytelne' : 'zmienione'} pliki`,
      many: `${count} ${invalid ? 'nieczytelnych' : 'zmienionych'} plików`,
      other: `${count} ${invalid ? 'nieczytelnego' : 'zmienionego'} pliku`,
    })} na dysku${files ? ` (${files})` : ''}. Tych zmian na dysku nie będzie w historii wersji i nie da się ich odzyskać w BaoCut; jeśli pochodziły z git lub dysku synchronizowanego, możesz je tam odzyskać.`,
  diskTitle: 'Użyć migawki z dysku?',
  diskConfirm: 'Użyj migawki z dysku',
  diskBody: (files: string) =>
    `Treść wideo zostanie zastąpiona migawką z dysku${files ? ` (${files})` : ''} i zapisana jako wersja „Zmiana zewnętrzna”. Zmiany w BaoCut, których nie ma jeszcze w migawce, najpierw trafią do historii wersji: wróć do stanu sprzed wersji „Zmiana zewnętrzna”, aby je odzyskać. Możesz też to cofnąć.`,
  keptTitle: 'Zachowano treść z BaoCut',
  keptText: (version: number | null) =>
    `Migawka na dysku jest teraz zgodna z BaoCut${version ? `, a twoje ostatnie zmiany są w wersji ${version}` : ''}. Zmian, które były na dysku, nie ma w historii wersji.`,
  usedDiskTitle: (version: number) => `Użyto migawki z dysku, zapisano jako wersję ${version} „Zmiana zewnętrzna”`,
  usedDiskText: (version: number) => `Wróć do stanu sprzed wersji ${version}, aby odzyskać to, co było w BaoCut. Możesz też to cofnąć.`,
  importedTitle: (version: number | null) => (version ? `Zaimportowano zmiany zewnętrzne jako wersję ${version} „Zmiana zewnętrzna”` : 'Zaimportowano zmiany zewnętrzne'),
  importedText:
    'Pliki migawki zmieniono poza BaoCut, a BaoCut nie miał innych zmian, więc zaimportowano je od razu. Wróć do stanu sprzed tej wersji, aby zobaczyć treść sprzed importu, albo cofnij import.',
  importUndoneTitle: 'Cofnięto import',
  importUndoneText:
    'Wideo ma z powrotem treść sprzed importu i w ciągu kilku sekund zostanie ponownie zapisane w migawce, co odrzuca tę zmianę zewnętrzną. Samo cofnięcie też jest zmianą i trafia do nowej wersji.',
  refusedBroken: 'Nie można wrócić do tej wersji',
  refusedOther: 'Nie wykonano',
  refusedText: (message: string) => `${message}. Wideo się nie zmieniło.`,
  savedTitle: (version: number, name: string) => `Zapisano jako wersję ${version} „${name}”`,
  savedText: 'Zapisane wersje zostają; reguła przechowywania nigdy ich nie usuwa.',
  restoredTitle: (version: number, before: boolean, recorded: number) =>
    before
      ? `Wrócono do stanu sprzed wersji ${version}, zapisano jako wersję ${recorded}`
      : `Wrócono do wersji ${version}, zapisano jako wersję ${recorded}`,
  restoredText: 'To zwykła zmiana: możesz ją cofnąć tutaj albo w edytorze po zamknięciu tego okna.',
  undo: 'Cofnij',
  undoneTitle: (version: number, before: boolean) =>
    before ? `Cofnięto: powrót do stanu sprzed wersji ${version}` : `Cofnięto: powrót do wersji ${version}`,
  undoneText: 'Wideo ma z powrotem poprzednią treść. Samo cofnięcie też jest zmianą i trafia do najnowszej wersji.',
  noopTitle: 'Brak zmian',
  noopText: (version: number, before: boolean) =>
    before
      ? `Wideo jest już w stanie sprzed rozpoczęcia wersji ${version}. Nic nie zatwierdzono i nie utworzono nowej wersji.`
      : `Wideo jest już w stanie z końca wersji ${version}. Nic nie zatwierdzono i nie utworzono nowej wersji.`,
  deletedTitle: (name: string) => `Usunięto zapisaną wersję „${name}”`,
  deletedText: 'Treść wideo się nie zmieniła.',
  emptyTitle: 'Nie ma jeszcze wersji',
  emptyText: (missing: boolean): string =>
    missing
      ? 'Migawka obszaru roboczego nie została jeszcze zapisana. Twoja następna zmiana stanie się wersją 1; możesz też zapisać wersję teraz.'
      : 'Twoja następna zmiana stanie się wersją 1; możesz też zapisać wersję teraz.',
  outsideTitle: 'To wideo nie jest w projekcie',
  outsideText: 'Historia wersji jest prowadzona tylko dla wideo w projekcie. Najpierw przenieś wideo do projektu.',
  listLabel: 'Wersje',
  versionN: (version: number) => `Wersja ${version}`,
  openBadge: 'Wciąż otwarta',
  blockedFlag: 'Nie można wrócić',
  unreadableTitle: 'Nie można odczytać pliku tej wersji',
  kindSegment: 'Edycje',
  kindSave: 'Zapisana wersja',
  kindRestore: 'Powrót do wersji',
  kindExternal: 'Zmiana zewnętrzna',
  kindRebuild: 'Odbudowa',
  revisions: (from: string, to: string) => (from === to ? `Rewizja ${to}` : `Rewizje ${from}–${to}`),
  openHint: 'Najnowsza wersja jest wciąż otwarta: dopóki nie minie 5 minut bez zmian lub nie osiągnie ona 30 minut, kolejne zmiany trafiają do niej.',
  openHintPending: 'Najnowsza wersja jest wciąż otwarta. Ostatnie zmiany są zapisywane i trafią do niej w ciągu kilku sekund.',
  openHintConflict: 'Najnowsza wersja jest wciąż otwarta, ale nowe zmiany nie trafią do historii wersji, dopóki konflikt migawki nie zostanie rozwiązany.',
  openHintExternal: 'Najnowsza wersja jest wciąż otwarta. Trwa import migawki z dysku: najpierw ta wersja zostanie zamknięta, a zmiany zewnętrzne staną się osobną wersją.',
  externalHint:
    'Ta wersja pochodzi spoza BaoCut: pliki migawki zmieniono przez git pull, dysk synchronizowany lub ręczną edycję, a BaoCut zaimportował je jako tę wersję. Wróć do stanu sprzed tej wersji, aby odzyskać to, co było w BaoCut przed importem.',
  restoreEnd: 'Wróć do tej wersji',
  restoreBefore: 'Wróć do stanu sprzed tej wersji',
  deleteSaved: 'Usuń tę zapisaną wersję',
  whyNotFound: 'Ta wersja już nie istnieje',
  whyUnreadable: (version: number) =>
    `Nie można odczytać pliku wersji ${version}, więc nie można wrócić ani do niej, ani do wcześniejszych stanów`,
  whyBroken: (version: number) => `Historia wersji nie zgadza się przy wersji ${version}, więc nie można wrócić do wcześniejszych stanów`,
  noopBoth: (version: number) =>
    `Wideo jest już w stanie wersji ${version} (jej treść przed i po jest taka sama), więc powrót niczego nie zmieni`,
  noopEnd: (version: number) => `Wideo jest już w stanie z końca wersji ${version}, więc powrót niczego nie zmieni`,
  noopBefore: (version: number) => `Wideo jest już w stanie sprzed rozpoczęcia wersji ${version}, więc powrót niczego nie zmieni`,
  factActors: 'Kto zmienił',
  factConversations: 'Sesje',
  factFiles: 'Co się zmieniło',
  factCheckpoint: 'Punkt kontrolny',
  actorYou: 'Ty',
  actorAgent: 'Agent',
  actorExternal: (name: string) => `Usługa zewnętrzna ${name}`,
  actorSystem: 'BaoCut',
  actionCount: (label: string, count: number) => (count > 1 ? `${label} ×${count}` : label),
  listSeparator: ', ',
  noActions: 'Nie zarejestrowano żadnych zmian',
  noActionsRebuild: 'BaoCut odbudował wideo z migawki; treść się nie zmieniła',
  omitted: (count: number) =>
    pluralForm('pl', count, {
      one: `Jeszcze ${count} zmiana została tylko policzona`,
      few: `Jeszcze ${count} zmiany zostały tylko policzone`,
      many: `Jeszcze ${count} zmian zostało tylko policzonych`,
      other: `Jeszcze ${count} zmiany zostało tylko policzone`,
    }),
  notHere: '(nie na tym komputerze)',
  openConversation: (title: string) => `Otwórz sesję „${title}”`,
  fileTimeline: 'Oś czasu',
  fileDocument: 'Dokument',
  changeAdd: 'Dodano',
  changeDelete: 'Usunięto',
  changeModify: 'Zmieniono',
  noFiles: 'Treść się nie zmieniła',
  diffTitle: 'Zmiany',
  copyDiff: 'Kopiuj diff',
  copied: 'Skopiowano',
  copyFailed: 'Nie udało się skopiować. Zaznacz tekst i skopiuj ręcznie.',
  diffEmpty: 'Diff tej wersji jest pusty: treść jest taka sama jak na końcu poprzedniej wersji.',
  diffLabel: (version: number) => `Diff wersji ${version}`,
  diffLoading: 'Wczytywanie diff',
  diffFailed: (message: string) => `Nie udało się odczytać tej wersji: ${message}`,
  diffMore: (count: number) =>
    pluralForm('pl', count, {
      one: `Nie pokazano jeszcze ${count} wiersza. Skopiuj diff, aby zobaczyć całość.`,
      few: `Nie pokazano jeszcze ${count} wierszy. Skopiuj diff, aby zobaczyć całość.`,
      many: `Nie pokazano jeszcze ${count} wierszy. Skopiuj diff, aby zobaczyć całość.`,
      other: `Nie pokazano jeszcze ${count} wiersza. Skopiuj diff, aby zobaczyć całość.`,
    }),
  unreadableHeading: (file: string) => `Nie można odczytać ${file}`,
  unreadableText: (why: string) =>
    `Nagłówek lub diff pliku wersji jest uszkodzony; plik mógł zostać obcięty lub zmieniony ręcznie. ${why}. Nowszych wersji to nie dotyczy.`,
  confirmRestoreTitle: (version: number, before: boolean) =>
    before ? `Wrócić do stanu sprzed wersji ${version}?` : `Wrócić do wersji ${version}?`,
  confirmRestoreBody: (version: number, before: boolean, when: string) =>
    `${
      before
        ? `Treść wideo zostanie zastąpiona jego stanem sprzed rozpoczęcia wersji ${version} (${when}).`
        : `Treść wideo zostanie zastąpiona jego stanem z końca wersji ${version} (${when}).`
    } To zmiana, którą możesz cofnąć; zostanie zapisana jako nowa wersja. Istniejące wersje zostają, a punkty kontrolne i ochrona się nie zmieniają.`,
  confirmDeleteTitle: (name: string) => `Usunąć zapisaną wersję „${name}”?`,
  confirmDeleteMiddle: (next: number) =>
    `Usuwana jest tylko ta wersja i jej punkt kontrolny: jej zmiany zostaną włączone do następnej po niej wersji ${next}. Treść wideo się nie zmieni.`,
  confirmDeleteTop:
    'Usuwane są tylko nazwa, notatka i punkt kontrolny: ta wersja stanie się zwykłym zestawem edycji, a późniejsze zmiany zostaną do niej włączone. Treść wideo się nie zmieni.',
  delete: 'Usuń',
};
