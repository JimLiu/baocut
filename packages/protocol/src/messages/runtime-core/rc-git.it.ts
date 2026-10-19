import type { RcGitMessages } from './rc-git.ts';

export const it: RcGitMessages = {
  gitPurpose: 'Esegue il commit in git dei file di BaoCut di un progetto (facoltativo)',
  gitMissingRemedyMac: 'Installa git: esegui xcode-select --install nel Terminale per avere i Command Line Tools, oppure installalo con Homebrew (brew install git)',
  gitMissingRemedyWin: 'Installa Git for Windows da https://git-scm.com/download/win',
  gitMissingRemedyLinux: 'Installa git con il tuo gestore di pacchetti',
  xcodeStub: '/usr/bin/git propone solo di installare i Command Line Tools finché non sono installati',

  notRepo: 'Questo progetto non è in un repository git',
  initRemedy: "Usa «Inizializza git» nelle impostazioni del progetto dell'app desktop di BaoCut o esegui baocut projects git-init, oppure esegui tu git init dove vuoi il repository",
  initHome: 'BaoCut non crea un repository git nella tua cartella home: per gli altri strumenti ogni cartella al suo interno sembrerebbe parte di un unico repository',
  initUserFolder: (p) =>
    `BaoCut non crea un repository git in una cartella utente standard (${p.path}): per gli altri strumenti ogni cartella al suo interno sembrerebbe parte di un unico repository`,
  initVolumeRoot: 'BaoCut non crea un repository git nella radice di un volume o di un\'unità',
  initInsideRepo: 'Questo progetto è già in un repository git',
  initElsewhere: 'Sposta prima il progetto in una cartella tutta sua, oppure esegui tu git init dove vuoi il repository',
  pausedLocked: 'Il repository è in uso da un altro comando git (esiste index.lock)',
  lockedRemedy:
    "Lascia terminare l'altro comando git. BaoCut riprova al commit successivo e non elimina mai il file di blocco; se non è in esecuzione alcun comando git, rimuovi tu il blocco",
  pausedMerge: 'Il repository è nel mezzo di un merge',
  pausedRebase: 'Il repository è nel mezzo di un rebase',
  pausedCherryPick: 'Il repository è nel mezzo di un cherry-pick',
  pausedRevert: 'Il repository è nel mezzo di un revert',
  pausedBisect: 'Il repository è nel mezzo di un bisect',
  pausedDetached: 'HEAD è scollegato (il repository non è su alcun branch)',
  repoStateRemedy: "Completa o annulla l'operazione in git; dopo BaoCut riprende i commit",
  detachedRemedy: 'Passa a un branch in git; dopo BaoCut riprende i commit',
  pausedLocalConfig:
    'La configurazione locale del repository esegue programmi o include altri file (filtri o include), quindi BaoCut non esegue comandi git che leggono i tuoi file',
  pausedLocalConfigChanged: 'I filtri o gli include locali del repository sono cambiati dopo che li hai consentiti, quindi BaoCut ha di nuovo sospeso i commit',
  localConfigRemedy: "Controlla le voci e i comandi che eseguono, poi consentili nelle impostazioni del progetto dell'app desktop di BaoCut o con baocut projects git-allow",
  gitFailed: (p) => `git non è riuscito in questo repository: ${p.detail}`,

  manageOnlyInAppOrCli: "Solo l'app desktop o la CLI possono inizializzare git o consentire i filtri locali",
  digestChanged: 'La configurazione locale è cambiata dopo il controllo; controlla di nuovo le voci',
  commitFailed: (p) => `Commit in git non riuscito: ${p.detail}`,
  initFailed: (p) => `Inizializzazione di git non riuscita: ${p.detail}`,

  commitSummary: (p) => `Eseguire il commit in git dei file di BaoCut del progetto "${p.name}"`,
  commitTitle: (p) => `BaoCut: aggiorna ${p.names}`,
};
