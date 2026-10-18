import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const it: SettingDescriptionMessages = {
  'agent.defaultDriver': "Agente per le nuove sessioni; null preferisce un agente rilevato disponibile (Codex per primo). Fissato alla creazione della sessione",
  'agent.defaultModel': 'Modello per le nuove sessioni; null usa il modello consigliato (Sonnet per Claude Code, un modello -sol per Codex), __agent-default__ non passa alcun modello e segue la configurazione della CLI dell’agente',
  'agent.defaultEffort': 'Intensità di ragionamento per le nuove sessioni; null usa il predefinito dell’agente',
  'agent.defaultAccessMode': 'Usato dalle sessioni che non hanno mai cambiato modalità di accesso: ask, autoAcceptEdits, auto, fullAccess o plan (i vecchi valori controlled e authorized sono trattati come ask e fullAccess)',
  'ui.language': `Lingua dell’interfaccia: system segue la lingua del sistema (inglese se non c’è una lingua corrispondente) o un codice di lingua (${LOCALES.join(', ')}). Anche il testo del Runtime rivolto alle persone usa questa lingua`,
  'captions.maxLineLength': 'Lunghezza desiderata per le interruzioni di riga automatiche (caratteri): cjk per testo cinese, giapponese e coreano; other per tutto il resto',
  'transcribe.afterComplete': 'Dopo la trascrizione: open-video apre il video, notify invia solo una notifica, nothing non fa nulla',
  'downloads.directory': 'Posizione di salvataggio predefinita per risultati di strumenti senza video, media scaricati da link e file consegnati da downloads_save (percorso assoluto); null usa ~/Downloads su questo host, indipendentemente dal progetto',
  'downloads.cookieBrowsers': 'Accesso al sito per i download dai link (Scarica video, trascrizione da un link, e download e transcribe dell’agente): all usa tutti i browser con un archivio di cookie su questo host, dal più recente; un elenco di id di browser (chrome, edge, firefox, safari, brave, chromium, opera, vivaldi, whale) li prova in quell’ordine; un elenco vuoto scarica in modo anonimo. Espanso con i browser rilevati all’avvio di ogni download',
  'models.downloadEndpoint': 'Origine del download dei modelli locali (URL di base del mirror, http(s)://); null usa l’hub pubblico dei modelli; https://www.modelscope.cn scarica da ModelScope. La variabile d’ambiente BAOCUT_MODELS_ENDPOINT ha la precedenza',
  'models.dir': 'Cartella dei modelli locali (percorso assoluto); null usa models nella cartella dei dati. La variabile d’ambiente BAOCUT_MODELS_DIR ha la precedenza. Cambiala con models.setDir, non con settings set',
  'tools.downloadEndpoint': 'Origine del download degli strumenti esterni gestiti (yt-dlp) (URL di base del mirror, http(s)://, file in <base>/<tool>/<version>/<file>); null usa l’URL della versione ufficiale. La variabile d’ambiente BAOCUT_TOOLS_ENDPOINT ha la precedenza',
  'models.downloadMirrors':
    "Mirror del repository di modelli aggiunti (elenco di { name, base }; base è un URL http(s):// senza duplicati). Solo un elenco da cui scegliere: i download usano models.downloadEndpoint",
  'tools.downloadMirrors':
    "Mirror delle pagine di rilascio aggiunti (elenco di { name, base }; base è un URL http(s):// senza duplicati). Solo un elenco da cui scegliere: i download usano tools.downloadEndpoint",
  'fonts.autoDownload': 'Scarica automaticamente i font richiesti dal layout, assenti su questo computer e presenti nel catalogo dei font (anteprima ed esportazione); quando disattivato, usa un font alternativo e mostra un avviso',
  'fonts.cssEndpoint': 'URL di base dell’API CSS dei font (mirror, https://); null usa https://fonts.googleapis.com',
  'fonts.fileEndpoint': 'URL di base per i file dei font (mirror, https://; i file vengono recuperati solo da questo URL); null usa https://fonts.gstatic.com',
  'space.trashRetentionDays': 'Giorni di conservazione delle voci nel Cestino dello Space (1–3650): voci senza riferimenti e video eliminati più vecchi vengono eliminati definitivamente a intervalli regolari',
  'versions.keep': "Versioni senza nome da conservare nella cronologia delle versioni di ogni video (1–100); le versioni salvate restano sempre. I file delle versioni di un video hanno anche un limite di 64 MiB: oltre, vengono rimosse le versioni senza nome più vecchie",
  'versions.cadence': "Quando la cronologia delle versioni di un video inizia una nuova versione: segment dopo 5 minuti di pausa, ogni 30 minuti di modifica continua e attorno a salvataggi e ripristini; turn anche all'inizio di ogni turno dell'Agent",
  'cache.maxSizeMiB': 'Limite di dimensione della cache nella cartella dei dati, in MiB (256–1048576): oltre il limite, i file di cache più vecchi (analisi dei media, copie di riproduzione) vengono eliminati fino a scendere al 90%. L’indice di ricerca tra video non viene mai eliminato',
  'resources.capacity': 'Avanzato: capacità del computer per la pianificazione delle risorse { memoryMiB, gpuMemoryMiB, cpuThreads }; una voce impostata su null viene rilevata automaticamente; null rileva tutto (memoria e CPU provengono dal sistema, la memoria GPU su Apple silicon è stimata dalla memoria unificata)',
  'runtime.idleExitMinutes': 'Minuti durante i quali un Runtime avviato dalla CLI resta inattivo prima di terminare autonomamente (1–1440): nessuna connessione, attività o servizio esterno aperto. Anche un Runtime lasciato in background alla chiusura dell’app desktop termina dopo questo tempo dalla fine delle sue attività. Gli altri Runtime non sono interessati',
  'updates.autoCheck': 'Verifica automaticamente gli aggiornamenti dell’app', 'updates.autoDownload': 'Scarica nuove versioni in background (senza installarle automaticamente)',
  'diagnostics.enabled': 'Invia statistiche d’utilizzo e riepiloghi delle prestazioni anonimi (senza media, testo o percorsi)', 'offline.strict': 'Rigorosamente offline: non inviare nulla a nessun servizio online',
  'semantic.channels': 'Canali dell’indice semantico da creare: text (parlato: trascrizioni, sottotitoli, traduzioni, capitoli); visual (un fotogramma chiave ogni 8 secondi; richiede un modello multimodale e più tempo); audio non è ancora disponibile',
  'semantic.excludedProjects': 'Progetti esclusi dall’indice semantico (elenco di id di progetto): tutti i progetti BaoCut e i video fuori dai progetti vengono indicizzati tranne questi, i cui video restano trovabili con le parole esatte',
  'semantic.folders': 'Cartelle indicizzate fuori dai progetti (elenco di {id, path}): i video e le immagini al loro interno compaiono in Space e sono indicizzati per significato, in sola lettura. Si cambiano con space.folderAdd e space.folderRemove',
  'semantic.excludedVideos': 'Singoli video esclusi dall’indice semantico (elenco di id di video), oltre ai progetti esclusi; il loro indice esistente viene rimosso',
  'semantic.indexDir':
    'Cartella dell’indice semantico (percorso assoluto); null lo lascia nella cache dell’app. Si cambia con space.indexSetDir, che sposta o ricrea l’indice',
  'semantic.pauseOnBattery': 'Sospendi la creazione dell’indice semantico quando si usa la batteria e riprendi con l’alimentazione collegata (si sospende sempre se il sistema rallenta per il calore)',
  'semantic.translationMemory': 'Suggerisci traduzioni precedenti di frasi quasi identiche durante la traduzione (richiede il modello di ricerca testuale)',
  'semantic.glossaryCandidates': 'Suggerisci termini di glossario da grafie quasi identiche tra le trascrizioni (richiede il modello di ricerca testuale)',
};
