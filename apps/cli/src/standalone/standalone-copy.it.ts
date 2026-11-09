import type { StandaloneMessages } from './standalone-copy.ts';

export const it: StandaloneMessages = {
  cliHelp: `Uso:
  baocut cli install               Installa questo pacchetto della riga di comando per il tuo utente e mette baocut nel
                                   PATH. Il pacchetto viene copiato in ~/.local/share/baocut/versions/<versione> (Windows:
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<versione>) a meno che non sia già lì. macOS: un
                                   link in ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, con quella
                                   cartella aggiunta al PATH del tuo utente. Non servono diritti di amministratore
  baocut cli status                Dove si trova baocut, a quale versione installata punta e quale baocut trova il tuo
                                   terminale
  baocut cli remove                Rimuove ciò che baocut cli install ha messo; le versioni installate restano. Ciò che si
                                   trova in quel percorso e non è stato messo da BaoCut non viene mai sostituito né eliminato`,
  help: `baocut update [--check | --rollback]

Aggiorna il pacchetto autonomo della riga di comando: legge lo stesso feed degli aggiornamenti dell’app BaoCut, scarica il
pacchetto della riga di comando dell’ultima versione, ne controlla dimensione e sha256 (e su macOS firma e notarizzazione),
lo installa accanto alla versione attuale e fa puntare baocut a esso. La versione precedente resta per --rollback; quelle
più vecchie che nessun Runtime usa più vengono eliminate.
  --check      Indica solo se è disponibile una versione più recente
  --rollback   Torna alla versione precedente
Un Runtime già in esecuzione mantiene la vecchia versione finché non si ferma (baocut runtime stop).
Solo il pacchetto autonomo si aggiorna così: l’app BaoCut si aggiorna da sola, le installazioni Homebrew con brew upgrade.
Imposta BAOCUT_UPDATE_APPCAST per leggere un altro feed (un URL o un file locale, per i test).`,
  version: (version, build) => `${version} (build ${build})`,
  state: {
    none: 'Non installato',
    current: 'Punta alla versione attuale',
    stale: 'Punta a un altro BaoCut',
    broken: 'Punta a una posizione che non esiste più',
    foreign: 'C’è altro (lasciato com’è)',
  },
  statusPackage: (version, root) => `Pacchetto ${version}  ${root}`,
  statusVersions: (versions, root) => `Versioni  ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root) => `In ${root} non c’è ancora niente di installato: baocut cli install ci copia questo pacchetto`,
  currentMark: ' (attuale)',
  previousMark: ' (precedente)',
  copied: (dest, from) => `Pacchetto copiato in ${dest}; ${from} non serve più`,
  versionsKept: (dir) => `Le versioni installate restano in ${dir}: elimina quella cartella per rimuoverle`,
  entryTaken: (path) =>
    `${path} non l’ha messo BaoCut, quindi viene lasciato com’è. Spostalo o eliminalo tu, poi esegui di nuovo baocut cli install`,
  pathFailed: (dir) =>
    `Impossibile aggiungere ${dir} al PATH del tuo utente: aggiungila in Proprietà del sistema → Variabili d’ambiente`,
  copyFailed: (from, dest, detail) => `Impossibile copiare ${from} in ${dest}${detail ? `: ${detail}` : ''}`,
  updateUsage: (token) => `baocut update accetta --check o --rollback (uno dei due): ${token}`,
  updateUnavailable:
    'baocut update aggiorna il pacchetto autonomo della riga di comando. Questo baocut appartiene all’app BaoCut, che si aggiorna da sola (BaoCut → Verifica aggiornamenti), o a Homebrew (brew upgrade --cask baocut)',
  upToDate: (current) => `Già aggiornato: ${current}`,
  available: (latest, current) => `È disponibile ${latest} (hai ${current})`,
  downloading: (version, build, megabytes) => `Download di ${version} (build ${build}), ${megabytes} MB…`,
  updated: (from, to) => `Aggiornato ${from} → ${to}`,
  rolledBack: (from, to) => `Tornato da ${from} a ${to}`,
  rollbackHint: 'Per tornare indietro: baocut update --rollback',
  entrySwitched: (path) => `${path} ora punta a questa versione`,
  entryNotInstalled: (path) => `${path} non è installato: baocut cli install mette baocut nel PATH`,
  entryLeftAlone: (path) =>
    `${path} punta a qualcosa di diverso da questo pacchetto ed è stato lasciato com’è: baocut cli install lo fa puntare qui`,
  removedVersions: (versions) => `Versioni più vecchie eliminate: ${versions.join(', ')}`,
  runtimeStillRunning: (pid) =>
    `Un Runtime (pid ${pid}) è ancora in esecuzione con la versione con cui è partito; quando si ferma, il comando successivo avvia quella nuova (baocut runtime stop lo ferma subito)`,
  systemTooOld: (required, system) => `La nuova versione richiede macOS ${required}; questo Mac ha ${system}`,
  feedFailed: (url, detail) => `Impossibile leggere il feed degli aggiornamenti ${url}: ${detail}`,
  feedMissing: (url) =>
    `Il feed degli aggiornamenti ${url} non contiene ancora un pacchetto della riga di comando: riprova dopo la prossima release`,
  downloadFailed: (url, detail) => `Impossibile scaricare ${url}: ${detail}`,
  verifyFailed: (detail) => `Il pacchetto scaricato non ha superato i controlli e non è stato installato: ${detail}`,
  unsignedBuild:
    'Questo pacchetto non è firmato, quindi non può verificare la firma di un aggiornamento. Scarica invece il pacchetto autonomo dalla pagina delle release di BaoCut',
  noPrevious: (dir) => `In ${dir} non c’è una versione precedente a cui tornare`,
  inProgress: (pid) => `È in esecuzione un altro baocut update (pid ${pid}): attendi che finisca`,
};
