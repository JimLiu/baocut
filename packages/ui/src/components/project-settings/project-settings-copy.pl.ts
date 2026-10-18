import { pluralForm } from '@baocut/protocol';
import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const pl: ProjectSettingsMessages = {
  menuItem: 'Ustawienia projektu…',
  title: 'Ustawienia projektu',
  close: 'Zamknij ustawienia projektu',
  done: 'Gotowe',
  loading: 'Sprawdzanie git',
  loadFailed: (message: string) => `Nie udało się sprawdzić git: ${message}`,

  gitHeading: 'git',
  gitLead:
    'BaoCut może commitować migawki obszaru roboczego twoich wideo do repozytorium git, w którym jest projekt. Historia wersji nie potrzebuje git i działa tak samo poza repozytorium.',
  branch: (name: string) => `Gałąź ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: 'Sprawdź ponownie',
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: 'Gotowe',
  lightPaused: (label: string) => `Wstrzymano · ${label}`,
  lightNotRepo: 'Poza repozytorium git',
  lightUnavailable: 'Nie znaleziono git',
  lightError: 'Błąd git',
  pauseLocked: 'Repozytorium w użyciu',
  pauseMerge: 'Trwa scalanie',
  pauseRebase: 'Trwa rebase',
  pauseCherryPick: 'Trwa cherry-pick',
  pauseRevert: 'Trwa revert',
  pauseBisect: 'Trwa bisect',
  pauseDetached: 'Odłączony HEAD',
  pauseLocalConfig: 'Lokalne filtry',
  pauseLocalConfigChanged: 'Lokalne filtry się zmieniły',

  pausedHeading: (label: string) => `Commity wstrzymane: ${label}`,
  pausedNote:
    'Gdy commity są wstrzymane, automatyczny commit i „Commit do git” czekają. Nie wpływa to na otwieranie, edycję ani historię wersji.',
  errorHeading: 'Błąd git',
  unavailableHeading: 'Nie znaleziono git',

  lcEntry: 'Wpis',
  lcValue: 'Polecenie lub dołączany plik',
  lcExplain:
    'Gdy na nie zezwolisz, BaoCut stosuje się do tych wpisów przy uruchamianiu git (na przykład przy szyfrowaniu git-crypt). Zgoda jest zapisywana tylko na tym komputerze, nie w projekcie, a BaoCut znów wstrzymuje commity, jeśli wpisy lub dołączane pliki się zmienią. To nie jest zaufanie do folderu: nie wpływa to na otwieranie, edycję ani agenta.',
  lcWeb:
    'Te wpisy są wyświetlane i można na nie zezwolić tylko w ustawieniach projektu w aplikacji BaoCut na komputer (albo poleceniem baocut projects git-allow). Gdy commity są wstrzymane, nie wpływa to na otwieranie, edycję ani historię wersji.',
  allow: 'Zezwól',
  allowedTitle: 'Zezwolono na lokalne filtry',
  allowedText: 'Zgoda jest zapisana na tym komputerze, nie w projekcie. Możesz teraz commitować.',
  allowFailed: 'Nie zezwolono',

  commit: 'Commit do git',
  committing: 'Commitowanie',
  commitDesc: (maxMiB: number) =>
    `Commituje tylko pliki BaoCut: migawki obszaru roboczego zmienionych wideo i materiały do ${maxMiB} MiB. Inne pliki w projekcie i zmiany już dodane do indeksu (stage) zostają bez zmian. BaoCut nie robi push.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `Ostatni commit ${commit} · ${auto ? 'automatyczny' : 'ręczny'} · ${ago}`,
  lastFailed: (message: string) => `Ostatnia próba nie powiodła się: ${message}`,
  committedTitle: 'Zrobiono commit do git',
  committedText: (commit: string, files: number, videos: string[]) =>
    `Commit ${commit}: ${pluralForm('pl', files, {
      one: `${files} plik`,
      few: `${files} pliki`,
      many: `${files} plików`,
      other: `${files} pliku`,
    })}${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `„${name}”` : from === to ? `„${name}” wersja ${to}` : `„${name}” wersje ${from}–${to}`,
  unnamedVideo: 'wideo bez nazwy',
  nothingTitle: 'Nie ma czego commitować',
  nothingText: 'Pliki BaoCut są takie same jak przy ostatnim commicie.',
  commitFailed: 'Nie zrobiono commitu',

  autoCommit: 'Automatyczny commit',
  autoCommitDesc:
    'Robi commit raz: po 5 minutach bez zmian w projekcie, gdy zamkniesz ostatnie otwarte wideo projektu albo gdy zamkniesz BaoCut. To ustawienie jest wspólne dla wszystkich projektów na tym komputerze.',

  initTitle: 'Zainicjuj git',
  initDesc: 'Utwórz repozytorium git w folderze projektu, aby móc commitować do niego migawki.',
  initWebNote:
    'Repozytorium w folderze na komputerze, na którym działa Runtime, może utworzyć tylko aplikacja BaoCut na komputer albo CLI (baocut projects git-init).',
  initRefused: (why: string) => `Niedostępne tutaj: ${why}`,
  initRefusedNote: 'Jeśli go potrzebujesz, przenieś wideo do osobnego folderu projektu i tam zainicjuj git.',
  refusalHome:
    'projekt to twój folder domowy. Z repozytorium w tym miejscu każdy folder w folderze domowym wyglądałby dla innych narzędzi na jego część.',
  refusalUserFolder:
    'projekt to standardowy folder użytkownika (np. Biurko, Dokumenty, Pobrane, Filmy, Muzyka lub Obrazki). Z repozytorium w tym miejscu każdy folder w nim wyglądałby dla innych narzędzi na jego część.',
  refusalVolumeRoot: 'projekt to katalog główny dysku. Z repozytorium w tym miejscu cały dysk wyglądałby na jego część.',
  refusalInsideRepo: 'projekt jest już w repozytorium git.',
  initConfirmTitle: 'Zainicjować git w folderze projektu?',
  initConfirmBody: (path: string) =>
    `Tworzy repozytorium git w ${path}. Reguły ignorowania BaoCut trafiają do własnego .git/info/ repozytorium, więc żaden plik w projekcie się nie zmienia. Nic nie jest commitowane ani wypychane (push).`,
  cancel: 'Anuluj',
  initDoneTitle: 'Zainicjowano git',
  initDoneText: 'Nie ma jeszcze żadnego commitu. Użyj „Commit do git”, aby zrobić pierwszy commit.',
  initFailed: 'Nie zainicjowano',

  recheckSame: 'Nic się nie zmieniło',
  recheckReadyTitle: 'Można commitować',
  recheckReadyText: 'Repozytorium nie jest już wstrzymane.',

  outsideHeading: 'Materiały spoza projektu',
  outsideLead:
    'Gdy wideo używa materiałów spoza folderu projektu, jego migawka obszaru roboczego zapisuje ścieżkę materiału (zaczynającą się od ~/ w folderze domowym, w innym przypadku pełną ścieżkę). Po commicie lub push inni dostają tylko ścieżkę, nie plik. Aby przekazać także materiały, użyj pakietu przenośnego.',

  stripLabel: 'git projektu',
  projectSettings: 'Ustawienia projektu',
};
