import type { JobsYtDlpMessages } from './yt-dlp.ts';
import { pluralForm } from '../../i18n.ts';

export const it: JobsYtDlpMessages = {
  toolNotFound: (p) => `Impossibile trovare un yt-dlp eseguibile (${p.code})`,
  remedyUnsupported: 'Lo strumento di download non supporta questo link: usa il link alla pagina del video stesso (non a una playlist, una diretta o una pagina di ricerca)',
  remedyLoginRequired: 'Accedi al sito nel browser, poi seleziona quel browser in «Accesso al sito» e scarica di nuovo',
  remedyCookiesUnavailable: 'Impossibile leggere i cookie del browser: assicurati di aver effettuato l’accesso nel browser; se il database è in uso, chiudi completamente il browser (inclusi i processi in background); se l’accesso al Portachiavi è negato, consentilo; Safari richiede Accesso completo al disco; su Windows, yt-dlp non può leggere i cookie protetti da Chrome, Edge o Brave con crittografia legata all’app, quindi usa Firefox; oppure prova un altro browser',
  remedyToolUpdateRequired: 'Impossibile interpretare il sito o strumento non aggiornato: aggiorna yt-dlp, rilevalo di nuovo e riprova',
  remedyUnavailable: 'Il video non è disponibile (eliminato, limitato per regione o senza formato scaricabile)',
  remedyNetworkError: 'Impossibile connettersi o download interrotto: controlla la rete e riprova (le parti già scaricate vengono riprese)',
  remedyDiskFull: 'Spazio su disco insufficiente per la cartella dei download o Runtime Home: libera spazio e riprova',
  remedyDownloadFailed: 'Lo strumento di download ha segnalato un errore: vedi details.stderr; potrebbe essere necessario aggiornare yt-dlp (baocut external-tools detect)',
  exited: (p) => `yt-dlp è terminato con ${p.code}`,
  cookieLoginRequired: (p) => `${p.browser}: il sito richiede ancora l’accesso`,
  cookieUnreadable: (p) => `${p.browser}: impossibile leggere i cookie`, reasonSeparator: '; ',
  cookieAttemptsFailed: (p) => `${pluralForm('it', p.count, { one: `Provati i cookie di ${p.count} browser`, other: `Provati i cookie di ${p.count} browser` })}, nessuno ha funzionato (${p.reasons})`,
  metadataUnreadable: 'Impossibile leggere i metadati dello strumento di download',
  metadataNotObject: 'I metadati dello strumento di download non sono un oggetto',
  playlist: 'Il link è una playlist; importa un video alla volta', live: 'Le dirette non possono essere importate',
};
