import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const it: ProjectSettingsMessages = {
  menuItem: 'Impostazioni del progetto…',
  title: 'Impostazioni del progetto',
  close: 'Chiudi impostazioni del progetto',
  done: 'Fatto',
  loading: 'Verifica di git',
  loadFailed: (message: string) => `Impossibile verificare git: ${message}`,

  gitHeading: 'git',
  gitLead:
    'BaoCut può eseguire il commit delle istantanee dello spazio di lavoro dei tuoi video nel repository git in cui si trova il progetto. La cronologia delle versioni non ha bisogno di git e funziona allo stesso modo fuori da un repository.',
  branch: (name: string) => `Branch ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: 'Verifica di nuovo',
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: 'Pronto',
  lightPaused: (label: string) => `In pausa · ${label}`,
  lightNotRepo: 'Non in un repository git',
  lightUnavailable: 'git non trovato',
  lightError: 'git non riuscito',
  pauseLocked: 'Repository in uso',
  pauseMerge: 'Merge in corso',
  pauseRebase: 'Rebase in corso',
  pauseCherryPick: 'Cherry-pick in corso',
  pauseRevert: 'Revert in corso',
  pauseBisect: 'Bisect in corso',
  pauseDetached: 'HEAD scollegato',
  pauseLocalConfig: 'Filtri locali',
  pauseLocalConfigChanged: 'Filtri locali cambiati',

  pausedHeading: (label: string) => `Commit in pausa: ${label}`,
  pausedNote:
    'Mentre i commit sono in pausa, il commit automatico e «Commit in git» restano in attesa. Apertura, modifica e cronologia delle versioni non sono interessate.',
  errorHeading: 'git non riuscito',
  unavailableHeading: 'git non trovato',

  lcEntry: 'Voce',
  lcValue: 'Comando o file incluso',
  lcExplain:
    'Dopo che li hai consentiti, BaoCut segue queste voci quando esegue git (per esempio per la cifratura con git-crypt). Il consenso è salvato solo su questo computer, non nel progetto, e BaoCut si rimette in pausa se le voci o i file inclusi cambiano. Non significa fidarsi della cartella: apertura, modifica e agenti non sono interessati.',
  lcWeb:
    'Queste voci sono elencate, e si possono consentire, solo nelle impostazioni del progetto dell’app desktop di BaoCut (o con baocut projects git-allow). Mentre i commit sono in pausa, apertura, modifica e cronologia delle versioni non sono interessate.',
  allow: 'Consenti',
  allowedTitle: 'Filtri locali consentiti',
  allowedText: 'Il consenso è salvato su questo computer, non nel progetto. Ora puoi eseguire il commit.',
  allowFailed: 'Non consentito',

  commit: 'Commit in git',
  committing: 'Commit in corso',
  commitDesc: (maxMiB: number) =>
    `Esegue il commit solo dei file di BaoCut: le istantanee dello spazio di lavoro dei video modificati e i materiali fino a ${maxMiB} MiB. Gli altri file del progetto e le modifiche che hai già messo in stage restano come sono. BaoCut non esegue il push.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `Ultimo commit ${commit} · ${auto ? 'automatico' : 'manuale'} · ${ago}`,
  lastFailed: (message: string) => `Ultimo tentativo non riuscito: ${message}`,
  committedTitle: 'Commit in git eseguito',
  committedText: (commit: string, files: number, videos: string[]) =>
    `Commit ${commit} eseguito: ${files} file${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `«${name}»` : from === to ? `«${name}» versione ${to}` : `«${name}» versioni ${from}–${to}`,
  unnamedVideo: 'un video',
  nothingTitle: 'Niente di cui eseguire il commit',
  nothingText: 'I file di BaoCut sono uguali a quelli dell’ultimo commit.',
  commitFailed: 'Commit non eseguito',

  autoCommit: 'Commit automatico',
  autoCommitDesc:
    'Esegue il commit una volta dopo 5 minuti senza modifiche nel progetto, quando chiudi l’ultimo video aperto del progetto o quando esci da BaoCut. Tutti i progetti su questo computer condividono questa impostazione.',

  initTitle: 'Inizializza git',
  initDesc: 'Crea un repository git nella cartella del progetto per poterci eseguire il commit delle istantanee.',
  initWebNote: 'Solo l’app desktop di BaoCut o la CLI (baocut projects git-init) possono creare un repository in una cartella sul computer del Runtime.',
  initRefused: (why: string) => `Non disponibile qui: ${why}`,
  initRefusedNote: 'Se te ne serve uno, sposta i video in una cartella di progetto tutta loro e inizializza git lì.',
  refusalHome:
    'il progetto è la tua cartella home. Con un repository qui, per gli altri strumenti ogni cartella nella tua cartella home sembrerebbe farne parte.',
  refusalUserFolder:
    'il progetto è una cartella utente standard (come Scrivania, Documenti, Download, Filmati, Musica o Immagini). Con un repository qui, per gli altri strumenti ogni cartella al suo interno sembrerebbe farne parte.',
  refusalVolumeRoot: 'il progetto è la radice di un disco. Con un repository qui, l’intero disco sembrerebbe farne parte.',
  refusalInsideRepo: 'il progetto è già in un repository git.',
  initConfirmTitle: 'Inizializzare git nella cartella del progetto?',
  initConfirmBody: (path: string) =>
    `Crea un repository git in ${path}. Le regole di esclusione di BaoCut vanno nella cartella .git/info/ del repository stesso, quindi nessun file del progetto cambia. Non viene eseguito alcun commit né push.`,
  cancel: 'Annulla',
  initDoneTitle: 'git inizializzato',
  initDoneText: 'Non c’è ancora nessun commit. Usa «Commit in git» per eseguire il primo commit.',
  initFailed: 'Non inizializzato',

  recheckSame: 'Non è cambiato nulla',
  recheckReadyTitle: 'Pronto per il commit',
  recheckReadyText: 'Il repository non è più in pausa.',

  outsideHeading: 'Materiali fuori dal progetto',
  outsideLead:
    'Quando un video usa materiali fuori dalla cartella del progetto, la sua istantanea dello spazio di lavoro registra il percorso del materiale (che inizia con ~/ se si trova nella tua cartella home, altrimenti il percorso completo). Dopo un commit o un push, gli altri ricevono solo il percorso, non il file. Per consegnare anche i materiali, usa un pacchetto portatile.',

  stripLabel: 'git del progetto',
  projectSettings: 'Impostazioni del progetto',
};
