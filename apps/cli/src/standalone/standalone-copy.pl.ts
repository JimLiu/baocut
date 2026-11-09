import type { StandaloneMessages } from './standalone-copy.ts';

export const pl: StandaloneMessages = {
  cliHelp: `Użycie:
  baocut cli install               Instaluje ten pakiet wiersza poleceń dla bieżącego użytkownika i umieszcza baocut w PATH.
                                   Pakiet jest kopiowany do ~/.local/share/baocut/versions/<wersja> (Windows:
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<wersja>), chyba że już tam jest. macOS:
                                   dowiązanie w ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, a ten
                                   folder zostaje dodany do PATH użytkownika. Nie wymaga uprawnień administratora
  baocut cli status                Gdzie jest baocut, na którą zainstalowaną wersję wskazuje i które baocut znajduje terminal
  baocut cli remove                Usuwa to, co umieściło baocut cli install; zainstalowane wersje zostają. To, co jest w
                                   tym miejscu, a czego nie umieścił BaoCut, nigdy nie jest zastępowane ani usuwane`,
  help: `baocut update [--check | --rollback]

Aktualizuje samodzielny pakiet wiersza poleceń: czyta ten sam kanał wydań co aplikacja BaoCut, pobiera pakiet wiersza
poleceń najnowszego wydania, sprawdza jego rozmiar i sha256 (a w macOS także podpis i notaryzację), instaluje go obok
bieżącej wersji i przestawia na niego baocut. Poprzednia wersja zostaje na potrzeby --rollback; starsze, których nie
używa już żaden Runtime, są usuwane.
  --check      Tylko sprawdza, czy jest dostępna nowsza wersja
  --rollback   Wraca do poprzedniej wersji
Działający już Runtime używa starej wersji, dopóki się nie zatrzyma (baocut runtime stop).
Tylko samodzielny pakiet aktualizuje się w ten sposób: aplikacja BaoCut aktualizuje się sama, Homebrew przez brew upgrade.
Ustaw BAOCUT_UPDATE_APPCAST, aby czytać inny kanał (URL lub plik lokalny, do testów).`,
  version: (version, build) => `${version} (Build ${build})`,
  state: {
    none: 'Nie zainstalowano',
    current: 'Wskazuje na bieżącą wersję',
    stale: 'Wskazuje na inne BaoCut',
    broken: 'Wskazuje na miejsce, które już nie istnieje',
    foreign: 'Jest tam coś innego (bez zmian)',
  },
  statusPackage: (version, root) => `Pakiet    ${version}  ${root}`,
  statusVersions: (versions, root) => `Wersje    ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root) => `W ${root} nie ma jeszcze zainstalowanych wersji: baocut cli install skopiuje tam ten pakiet`,
  currentMark: ' (bieżąca)',
  previousMark: ' (poprzednia)',
  copied: (dest, from) => `Skopiowano pakiet do ${dest}; ${from} nie jest już potrzebny`,
  versionsKept: (dir) => `Zainstalowane wersje zostają w ${dir}: aby je usunąć, usuń ten folder`,
  entryTaken: (path) =>
    `${path} nie zostało umieszczone przez BaoCut, więc zostaje bez zmian. Przenieś to lub usuń samodzielnie, a potem ponownie uruchom baocut cli install`,
  pathFailed: (dir) => `Nie udało się dodać ${dir} do PATH użytkownika: dodaj ten folder w Właściwości systemu → Zmienne środowiskowe`,
  copyFailed: (from, dest, detail) => `Nie udało się skopiować ${from} do ${dest}${detail ? `: ${detail}` : ''}`,
  updateUsage: (token) => `baocut update przyjmuje --check albo --rollback (jedno z nich): ${token}`,
  updateUnavailable:
    'baocut update aktualizuje samodzielny pakiet wiersza poleceń. To baocut należy do aplikacji BaoCut, która aktualizuje się sama (BaoCut → Sprawdź aktualizacje), albo do Homebrew (brew upgrade --cask baocut)',
  upToDate: (current) => `Masz najnowszą wersję: ${current}`,
  available: (latest, current) => `Dostępna jest wersja ${latest} (masz ${current})`,
  downloading: (version, build, megabytes) => `Pobieranie ${version} (Build ${build}), ${megabytes} MB…`,
  updated: (from, to) => `Zaktualizowano ${from} → ${to}`,
  rolledBack: (from, to) => `Wrócono z ${from} do ${to}`,
  rollbackHint: 'Aby wrócić: baocut update --rollback',
  entrySwitched: (path) => `${path} wskazuje teraz na tę wersję`,
  entryNotInstalled: (path) => `${path} nie jest zainstalowane: baocut cli install umieszcza baocut w PATH`,
  entryLeftAlone: (path) =>
    `${path} wskazuje na coś innego niż ten pakiet i zostało bez zmian: baocut cli install przestawi je na ten pakiet`,
  removedVersions: (versions) => `Usunięto starsze wersje: ${versions.join(', ')}`,
  runtimeStillRunning: (pid) =>
    `Runtime (pid ${pid}) nadal działa w wersji, z którą został uruchomiony; gdy się zatrzyma, następne polecenie uruchomi nową (baocut runtime stop zatrzyma go teraz)`,
  systemTooOld: (required, system) => `Nowa wersja wymaga macOS ${required}; ten Mac ma ${system}`,
  feedFailed: (url, detail) => `Nie udało się odczytać kanału wydań ${url}: ${detail}`,
  feedMissing: (url) => `Kanał wydań ${url} nie ma jeszcze pakietu wiersza poleceń: spróbuj ponownie po następnym wydaniu`,
  downloadFailed: (url, detail) => `Nie udało się pobrać ${url}: ${detail}`,
  verifyFailed: (detail) => `Pobrany pakiet nie przeszedł sprawdzenia i nie został zainstalowany: ${detail}`,
  unsignedBuild:
    'Ten pakiet nie jest podpisany, więc nie może sprawdzić podpisu aktualizacji. Pobierz zamiast tego samodzielny pakiet ze strony wydań BaoCut',
  noPrevious: (dir) => `W ${dir} nie ma poprzedniej wersji, do której można wrócić`,
  inProgress: (pid) => `Działa już inne baocut update (pid ${pid}): poczekaj, aż się zakończy`,
};
