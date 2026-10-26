import type { ProjectsMessages } from './projects-copy.ts';

export const pl: ProjectsMessages = {
  help: `Użycie:
  baocut projects git-status [<projekt>]
                                   Stan git projektu: repozytorium, gałąź, czy BaoCut może tworzyć commity
                                   i dlaczego są wstrzymane (commit: baocut projects git-commit)
  baocut projects git-init [<projekt>]
                                   Inicjuje git w folderze projektu (nie w folderze domowym, standardowym folderze
                                   użytkownika, katalogu głównym woluminu ani wewnątrz innego repozytorium)
  baocut projects git-allow [<projekt>] [--yes]
                                   Pokazuje filtry i include z lokalnej konfiguracji repozytorium, a potem je zezwala:
                                   dopiero wtedy BaoCut uruchamia polecenia git, które je wykonują
  baocut projects remove <projekt> [--yes]
                                   Usuwa projekt z BaoCut: jego sesje są usuwane, folder i pliki zostają na dysku
                                   (otwórz folder ponownie, aby przywrócić projekt)
  <projekt> to ID, nazwa lub folder projektu; bez niego projekt zawierający bieżący folder`,
  noProject: (cwd) => `Żaden projekt nie zawiera ${cwd}. Podaj ID, nazwę lub folder projektu (baocut projects list)`,
  unknownProject: (text) => `Nie znaleziono projektu: ${text} (baocut projects list)`,
  ambiguousProject: (text) => `Jest więcej niż jeden projekt o nazwie ${text}; podaj jego ID`,
  states: {
    ready: 'gotowe',
    paused: 'wstrzymane',
    'not-repo': 'poza repozytorium git',
    unavailable: 'git niedostępny',
    error: 'błąd',
  },
  head: (name, id) => `Projekt ${name} (${id})`,
  state: (state) => `Git: ${state}`,
  branch: (branch) => `Gałąź: ${branch}`,
  detached: 'Gałąź: (odłączony HEAD)',
  version: (version) => `Wersja git: ${version}`,
  repo: (root) => `Repozytorium: ${root}`,
  autoCommit: (on) => `Automatyczny commit: ${on ? 'włączony' : 'wyłączony'}`,
  lastCommit: (commit, auto, at) => `Ostatni commit: ${commit.slice(0, 12)} (${auto ? 'automatyczny' : 'ręczny'}, ${at})`,
  lastError: (message) => `Ostatni błąd: ${message}`,
  entriesHead: 'Lokalne filtry i include:',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: 'Sprawdź je, a potem zezwól na nie poleceniem baocut projects git-allow',
  initDone: (root) => `Zainicjowano git w ${root}`,
  nothingToAllow: 'To repozytorium nie ma lokalnych filtrów ani include czekających na zezwolenie',
  allowPrompt: 'Zezwolić na te wpisy? BaoCut będzie uruchamiać polecenia git, które je wykonują [y/N] ',
  notTtyAllow: 'To nie jest terminal: sprawdź wpisy poleceniem baocut projects git-status, a potem uruchom ponownie z --yes',
  notAllowed: 'Nie zezwolono: commity BaoCut w tym repozytorium pozostają wstrzymane',
  allowed: 'Zezwolono: BaoCut znowu tworzy commity w tym repozytorium',
  removeHead: (name, id, dir) => `Projekt ${name} (${id}): ${dir}`,
  removeMissing: 'Folderu już nie ma',
  removeEffect: (count) => `Usunięcie skasuje jego sesje (${count}). Folder z wideo i plikami zostaje na dysku`,
  removePrompt: 'Usunąć ten projekt z BaoCut? [y/N] ',
  notTtyRemove: 'Nie w terminalu: sprawdź projekt przez baocut projects list, a potem uruchom ponownie z --yes',
  notRemoved: 'Nie usunięto',
  removed: (name, count) => `Usunięto ${name} z BaoCut i skasowano sesje (${count}). Folder pozostał bez zmian: otwórz go ponownie (lub uruchom baocut projects create <folder>), aby przywrócić projekt`,
};
