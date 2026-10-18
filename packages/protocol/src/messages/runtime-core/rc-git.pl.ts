import type { RcGitMessages } from './rc-git.ts';

export const pl: RcGitMessages = {
  gitPurpose: 'Commituje pliki BaoCut z projektu do git (opcjonalnie)',
  gitMissingRemedyMac: 'Zainstaluj git: uruchom xcode-select --install w Terminalu, aby pobrać Command Line Tools, albo zainstaluj go przez Homebrew (brew install git)',
  gitMissingRemedyWin: 'Zainstaluj Git for Windows ze strony https://git-scm.com/download/win',
  gitMissingRemedyLinux: 'Zainstaluj git za pomocą menedżera pakietów',
  xcodeStub: 'Dopóki Command Line Tools nie są zainstalowane, /usr/bin/git tylko proponuje ich instalację',

  notRepo: 'Ten projekt nie znajduje się w repozytorium git',
  initRemedy: 'Uruchom baocut projects git-init w folderze projektu albo sam uruchom git init tam, gdzie chcesz mieć repozytorium',
  initHome: 'BaoCut nie tworzy repozytorium git w folderze domowym: dla innych narzędzi każdy folder w nim wyglądałby na część jednego repozytorium',
  initUserFolder: (p) =>
    `BaoCut nie tworzy repozytorium git w standardowym folderze użytkownika (${p.path}): dla innych narzędzi każdy folder w nim wyglądałby na część jednego repozytorium`,
  initVolumeRoot: 'BaoCut nie tworzy repozytorium git w katalogu głównym woluminu ani dysku',
  initInsideRepo: 'Ten projekt jest już w repozytorium git',
  initElsewhere: 'Najpierw przenieś projekt do osobnego folderu albo sam uruchom git init tam, gdzie chcesz mieć repozytorium',
  pausedLocked: 'Repozytorium jest używane przez inne polecenie git (istnieje index.lock)',
  lockedRemedy:
    'Poczekaj, aż inne polecenie git się zakończy. BaoCut spróbuje ponownie przy następnym commicie i nigdy nie usuwa pliku blokady; jeśli żadne polecenie git nie działa, usuń blokadę sam',
  pausedMerge: 'Repozytorium jest w trakcie scalania (merge)',
  pausedRebase: 'Repozytorium jest w trakcie rebase',
  pausedCherryPick: 'Repozytorium jest w trakcie cherry-pick',
  pausedRevert: 'Repozytorium jest w trakcie revert',
  pausedBisect: 'Repozytorium jest w trakcie bisect',
  pausedDetached: 'HEAD jest odłączony (repozytorium nie jest na żadnej gałęzi)',
  repoStateRemedy: 'Dokończ lub przerwij to w git; potem BaoCut znów będzie commitować',
  detachedRemedy: 'Przełącz się na gałąź w git; potem BaoCut znów będzie commitować',
  pausedLocalConfig:
    'Lokalna konfiguracja repozytorium uruchamia programy lub dołącza inne pliki (filtry lub include), więc BaoCut nie uruchamia poleceń git, które czytają twoje pliki',
  pausedLocalConfigChanged: 'Lokalne filtry lub include repozytorium zmieniły się po twojej zgodzie, więc BaoCut znów wstrzymał commity',
  localConfigRemedy: 'Przejrzyj wpisy i uruchamiane przez nie polecenia, a potem zezwól na nie poleceniem baocut projects git-allow',
  gitFailed: (p) => `git zakończył się błędem w tym repozytorium: ${p.detail}`,

  manageOnlyInAppOrCli: 'Tylko aplikacja desktopowa lub CLI może zainicjować git albo zezwolić na lokalne filtry',
  digestChanged: 'Lokalna konfiguracja zmieniła się po przejrzeniu; przejrzyj wpisy ponownie',
  commitFailed: (p) => `Nie udało się zrobić commitu do git: ${p.detail}`,
  initFailed: (p) => `Nie udało się zainicjować git: ${p.detail}`,

  commitSummary: (p) => `Commit plików BaoCut z projektu „${p.name}” do git`,
  commitTitle: (p) => `BaoCut: aktualizacja ${p.names}`,
};
