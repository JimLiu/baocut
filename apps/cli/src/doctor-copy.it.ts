import type { DoctorMessages } from './doctor-copy.ts';

export const it: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'Perché BaoCut non si avvia o non riesce a leggere qualcosa: quale baocut trovano i terminali, quale Runtime',
    'avvierebbe la CLI e con quale cartella, se l’archivio delle credenziali risponde e l’Accesso completo al disco',
    'su macOS. Ogni controllo è ok, warn, fail o skip, con un comando di correzione quando c’è; next è la correzione',
    'del primo problema. Sola lettura: non avvia mai un Runtime e non legge mai una chiave (il controllo del',
    'Portachiavi chiede solo se esiste una chiave inventata). Chiedi all’utente prima di eseguire le correzioni.',
    'Da una copia del repository esegue anche l’autoverifica del Runtime, che avvia una volta ogni programma nativo e confronta le build con il codice sorgente.',
    '',
    'Opzioni: --json',
  ].join('\n'),
  checkName: {
    entry: 'Riga di comando',
    runtime: 'Runtime',
    credentials: 'Credenziali',
    fullDiskAccess: 'Accesso completo al disco',
    build: 'Build',
  },
  remedyLabel: 'correzione',

  entryApp: (found, version) => `I terminali eseguono ${found}, la riga di comando dell’app BaoCut${version ? ` ${version}` : ''}`,
  entryOtherApp: (found, target, app) =>
    `I terminali eseguono ${found} (${target}), non la riga di comando dell’app BaoCut in ${app}`,
  entryNoApp: (found, target) => `I terminali eseguono ${found} (${target}); nessuna app BaoCut trovata`,
  entryMissing: 'I terminali non trovano baocut. Installalo dall’app BaoCut (non servono diritti di amministratore).',
  entryMissingNoApp: 'I terminali non trovano baocut e nessuna app BaoCut è stata trovata nelle posizioni consuete',
  entryStandalone: (found, version) => `I terminali usano ${found}, il pacchetto autonomo della riga di comando di BaoCut ${version}`,
  entryOtherStandalone: (found, target, own) => `I terminali usano ${found} (${target}), non un pacchetto autonomo della riga di comando di BaoCut come ${own}`,
  entryMissingStandalone: 'I terminali non trovano baocut. Installa questo pacchetto della riga di comando con cli install (non servono permessi di amministratore).',

  runtimeRunning: (version, pid, by) =>
    `In esecuzione: versione ${version}, processo ${pid}, avviato ${by === 'cli' ? 'dalla riga di comando' : 'dall’app BaoCut'}`,
  runtimeStopped: (entry) => `Non in esecuzione. Il prossimo comando lo avvia in background con ${entry}`,
  runtimeUnreachable: (pid, reason) => `Un Runtime è in esecuzione (processo ${pid}) ma non risponde: ${reason}`,
  runtimeNoLaunch:
    'Non in esecuzione e nessun Runtime da avviare: installa l’app BaoCut, esegui dal repository, oppure imposta BAOCUT_RUNTIME_ENTRY sul punto di ingresso del Runtime.',

  credentialsFile: (file) => `Questa versione conserva le chiavi in un file: ${file}`,
  credentialsKeychain: (platform) =>
    platform === 'win32' ? 'Gestione credenziali di Windows risponde' : 'Il Portachiavi di macOS risponde',
  credentialsDenied:
    'Il Portachiavi ha negato l’accesso. Via SSH o senza una sessione aperta sul desktop, macOS può tenerlo bloccato: esegui baocut in un terminale sul desktop, oppure sblocca il portachiavi «login».',
  credentialsNoHelper: (file) =>
    `Manca il programma di supporto delle credenziali${file ? ` (${file})` : ''}, quindi le chiavi non si possono leggere. Reinstalla l’app BaoCut.`,
  credentialsUnavailable: (reason) => `Impossibile raggiungere l’archivio delle credenziali: ${reason}`,
  credentialsUnknown: 'BAOCUT_RUNTIME_ENTRY decide dove sono conservate le chiavi; non controllato',
  credentialsTimedOut: (seconds) => `il programma di supporto non ha risposto entro ${seconds} s`,

  fdaGranted: 'L’Accesso completo al disco è attivo',
  fdaMissingApp:
    'L’Accesso completo al disco è disattivato per BaoCut.app, quindi i file nelle posizioni protette (Scrivania, Documenti, Download, altri dischi) potrebbero non essere leggibili. Attiva BaoCut in Impostazioni di Sistema › Privacy e sicurezza › Accesso completo al disco, poi esegui di nuovo baocut doctor.',
  fdaMissingCli: (app) =>
    `L’Accesso completo al disco è disattivato per il Runtime avviato dalla riga di comando; macOS usa il permesso di questa app: ${app ?? 'l’app che ha eseguito il comando (il tuo terminale o l’app che ospita l’agente)'}. Attiva quell’app in Impostazioni di Sistema › Privacy e sicurezza › Accesso completo al disco e riaprila, oppure ferma questo Runtime (baocut runtime stop) e apri l’app BaoCut; poi esegui di nuovo baocut doctor.`,
  fdaMissingOwn: (app) =>
    `L’Accesso completo al disco è disattivato per il Runtime avviato dalla riga di comando. Viene eseguito da solo come ${app}, quindi macOS usa il permesso di ${app}, non quello del tuo terminale: attiva ${app} in Impostazioni di Sistema › Privacy e sicurezza › Accesso completo al disco, ferma questo Runtime (baocut runtime stop), poi esegui di nuovo baocut doctor.`,
  fdaNotRunning: 'Controllato solo mentre un Runtime è in esecuzione',
  buildOk: (count) => `I programmi nativi si avviano e le ${count} build corrispondono al codice sorgente`,
  buildNotSource: 'Si controlla quando il Runtime gira da una copia del repository',
  buildFailed: (reason) => `L’autoverifica del Runtime non è terminata: ${reason}`,
  buildTimedOut: (seconds) => `nessuna risposta entro ${seconds} s`,
  buildProblems: (count, first) =>
    count === 1 ? `L’autoverifica del Runtime ha trovato un problema: ${first}` : `L’autoverifica del Runtime ha trovato ${count} problemi, il primo: ${first}`,
  buildMore: (first, more) => `${first} (e altri ${more})`,
};
