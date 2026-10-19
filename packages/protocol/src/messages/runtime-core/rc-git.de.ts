import type { RcGitMessages } from './rc-git.ts';

export const de: RcGitMessages = {
  gitPurpose: 'Committet die BaoCut-Dateien eines Projekts in git (optional)',
  gitMissingRemedyMac: 'Installieren Sie git: Führen Sie im Terminal xcode-select --install aus, um die Command Line Tools zu erhalten, oder installieren Sie es mit Homebrew (brew install git)',
  gitMissingRemedyWin: 'Installieren Sie Git for Windows von https://git-scm.com/download/win',
  gitMissingRemedyLinux: 'Installieren Sie git mit Ihrem Paketmanager',
  xcodeStub: '/usr/bin/git bietet nur an, die Command Line Tools zu installieren, solange sie nicht installiert sind',

  notRepo: 'Dieses Projekt liegt in keinem git-Repository',
  initRemedy: 'Führen Sie baocut projects git-init im Projektordner aus, oder führen Sie git init selbst dort aus, wo Sie das Repository haben möchten',
  initHome: 'BaoCut legt kein git-Repository in Ihrem Benutzerordner an: Für andere Werkzeuge sähe jeder Ordner darin wie Teil eines einzigen Repositorys aus',
  initUserFolder: (p) =>
    `BaoCut legt kein git-Repository in einem Standard-Benutzerordner (${p.path}) an: Für andere Werkzeuge sähe jeder Ordner darin wie Teil eines einzigen Repositorys aus`,
  initVolumeRoot: 'BaoCut legt kein git-Repository im Stammverzeichnis eines Volumes oder Laufwerks an',
  initInsideRepo: 'Dieses Projekt liegt bereits in einem git-Repository',
  initElsewhere: 'Verschieben Sie das Projekt zuerst in einen eigenen Ordner oder führen Sie git init selbst dort aus, wo das Repository liegen soll',
  pausedLocked: 'Das Repository wird von einem anderen git-Befehl verwendet (index.lock existiert)',
  lockedRemedy:
    'Lassen Sie den anderen git-Befehl fertig werden. BaoCut versucht es beim nächsten Commit erneut und löscht die Sperrdatei nie; läuft kein git-Befehl, entfernen Sie die Sperre selbst',
  pausedMerge: 'Im Repository läuft gerade ein Merge',
  pausedRebase: 'Im Repository läuft gerade ein Rebase',
  pausedCherryPick: 'Im Repository läuft gerade ein Cherry-Pick',
  pausedRevert: 'Im Repository läuft gerade ein Revert',
  pausedBisect: 'Im Repository läuft gerade ein Bisect',
  pausedDetached: 'HEAD ist losgelöst (das Repository ist auf keinem Branch)',
  repoStateRemedy: 'Schließen Sie den Vorgang in git ab oder brechen Sie ihn ab; danach committet BaoCut wieder',
  detachedRemedy: 'Wechseln Sie in git auf einen Branch; danach committet BaoCut wieder',
  pausedLocalConfig:
    'Die lokale Konfiguration des Repositorys führt Programme aus oder bindet andere Dateien ein (Filter oder include), daher führt BaoCut keine git-Befehle aus, die Ihre Dateien lesen',
  pausedLocalConfigChanged: 'Die lokalen Filter oder includes des Repositorys haben sich nach Ihrer Freigabe geändert, daher hat BaoCut seine Commits wieder pausiert',
  localConfigRemedy: 'Prüfen Sie die Einträge und die Befehle, die sie ausführen, und erlauben Sie sie dann mit baocut projects git-allow',
  gitFailed: (p) => `git ist in diesem Repository fehlgeschlagen: ${p.detail}`,

  manageOnlyInAppOrCli: 'Nur die Desktop-App oder die CLI kann git initialisieren oder lokale Filter erlauben',
  digestChanged: 'Die lokale Konfiguration hat sich nach der Prüfung geändert; prüfen Sie die Einträge erneut',
  commitFailed: (p) => `Commit in git fehlgeschlagen: ${p.detail}`,
  initFailed: (p) => `git-Initialisierung fehlgeschlagen: ${p.detail}`,

  commitSummary: (p) => `BaoCut-Dateien im Projekt „${p.name}“ in git committen`,
  commitTitle: (p) => `BaoCut: ${p.names} aktualisieren`,
};
