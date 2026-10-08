import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const it: SettingDescriptionMessages = {
  'agent.defaultDriver': 'Agente per le nuove sessioni; null usa il predefinito integrato (codex). Fissato alla creazione della sessione',
  'agent.defaultModel': 'Modello per le nuove sessioni; null usa il modello consigliato (Sonnet per Claude Code, un modello -sol per Codex), __agent-default__ non passa alcun modello e segue la configurazione della CLI dell’agente',
  'agent.defaultEffort': 'Intensità di ragionamento per le nuove sessioni; null usa il predefinito dell’agente',
  'agent.defaultAccessMode': 'Usato dalle sessioni che non hanno mai cambiato modalità di accesso: ask, autoAcceptEdits, auto, fullAccess o plan (i vecchi valori controlled e authorized sono trattati come ask e fullAccess)',
  'ui.language': `Lingua dell’interfaccia: system segue la lingua del sistema (inglese se non c’è una lingua corrispondente) o un codice di lingua (${LOCALES.join(', ')}). Anche il testo del Runtime rivolto alle persone usa questa lingua`,
  'captions.maxLineLength': 'Lunghezza desiderata per le interruzioni di riga automatiche (caratteri): cjk per testo cinese, giapponese e coreano; other per tutto il resto',
  'transcribe.afterComplete': 'Dopo la trascrizione: open-video apre il video, notify invia solo una notifica, nothing non fa nulla',
  'downloads.directory': 'Posizione di salvataggio predefinita per risultati di strumenti senza video, media scaricati da link e file consegnati da downloads_save (percorso assoluto); null usa ~/Downloads su questo host, indipendentemente dal progetto',
  'models.downloadEndpoint': 'Origine del download dei modelli locali (URL di base del mirror, http(s)://); null usa l’hub pubblico dei modelli. La variabile d’ambiente BAOCUT_MODELS_ENDPOINT ha la precedenza',
  'models.dir': 'Cartella dei modelli locali (percorso assoluto); null usa models nella cartella dei dati. La variabile d’ambiente BAOCUT_MODELS_DIR ha la precedenza. Cambiala con models.setDir, non con settings set',
  'tools.downloadEndpoint': 'Origine del download degli strumenti esterni gestiti (yt-dlp) (URL di base del mirror, http(s)://, file in <base>/<tool>/<version>/<file>); null usa l’URL della versione ufficiale. La variabile d’ambiente BAOCUT_TOOLS_ENDPOINT ha la precedenza',
  'fonts.autoDownload': 'Scarica automaticamente i font richiesti dal layout, assenti su questo computer e presenti nel catalogo dei font (anteprima ed esportazione); quando disattivato, usa un font alternativo e mostra un avviso',
  'fonts.cssEndpoint': 'URL di base dell’API CSS dei font (mirror, https://); null usa https://fonts.googleapis.com',
  'fonts.fileEndpoint': 'URL di base per i file dei font (mirror, https://; i file vengono recuperati solo da questo URL); null usa https://fonts.gstatic.com',
  'space.trashRetentionDays': 'Giorni di conservazione delle voci nel Cestino dello Space (1–3650): voci senza riferimenti e video eliminati più vecchi vengono eliminati definitivamente a intervalli regolari',
  'cache.maxSizeMiB': 'Limite di dimensione della cache nella cartella dei dati, in MiB (256–1048576): oltre il limite, i file di cache più vecchi (analisi dei media, copie di riproduzione) vengono eliminati fino a scendere al 90%. L’indice di ricerca tra video non viene mai eliminato',
  'resources.capacity': 'Avanzato: capacità del computer per la pianificazione delle risorse { memoryMiB, gpuMemoryMiB, cpuThreads }; una voce impostata su null viene rilevata automaticamente; null rileva tutto (memoria e CPU provengono dal sistema, la memoria GPU su Apple silicon è stimata dalla memoria unificata)',
  'runtime.idleExitMinutes': 'Minuti durante i quali un Runtime avviato dalla CLI resta inattivo prima di terminare autonomamente (1–1440): nessuna connessione, attività o servizio esterno aperto. L’app desktop e i Runtime avviati manualmente non sono interessati',
  'updates.autoCheck': 'Verifica automaticamente gli aggiornamenti dell’app', 'updates.autoDownload': 'Scarica nuove versioni in background (senza installarle automaticamente)',
  'diagnostics.enabled': 'Invia statistiche d’utilizzo e riepiloghi delle prestazioni anonimi (senza media, testo o percorsi)', 'offline.strict': 'Rigorosamente offline: non inviare nulla a nessun servizio online',
};
