import type { ModelsInstallMessages } from './models-install-copy.ts';
import { pluralForm } from '@baocut/protocol';

const KEEP = 'Ciò che è già stato scaricato viene conservato e il prossimo download riprende da dove si è fermato.';
const SOURCE = '«Origine del download dei modelli» in Impostazioni › Generali';
const and = (items: readonly string[]) => new Intl.ListFormat('it', { type: 'conjunction' }).format(items);
const files = (n: number) => `${n} file`;

export const it: ModelsInstallMessages = {
  planSize: (size: string) => `Download di ${size}`, planSizeEstimate: (size: string) => `Circa ${size} (alcune dimensioni dei file sono sconosciute, quindi viene usata la stima registrata)`, amountEstimate: (size: string) => `Circa ${size}`,
  noSpace: (need: string, have: string) => `Spazio su disco insufficiente: richiede ${need} e il disco con la cartella dei modelli ha solo ${have} disponibili. Libera spazio prima del download.`,
  resumed: (size: string) => `${size} scaricati in precedenza vengono riutilizzati, senza scaricarli di nuovo.`, space: (size: string) => `${size} liberi su disco`, lineKeep: 'Già installato, lasciato invariato',
  lineSize: (size: string, count: number) => `${size} · ${files(count)}`, lineUnknown: (count: number) => `Dimensione sconosciuta · ${files(count)}`,
  queued: 'In coda per il download', downloading: (amount: string) => `Download di ${amount}`, downloadingUnknown: (amount: string) => `Download · ricevuti ${amount}`, verifying: 'Verifica e pubblicazione',
  pausedKept: (amount: string) => `In pausa · ${amount} conservati; riprendendo continua da dove si è fermato`, paused: 'In pausa',
  remedyNoSpace: (need: string | null, have: string | null) => `${need !== null && have !== null ? `Richiede ${need} e rimangono solo ${have}. ` : ''}Libera spazio su disco, poi scarica di nuovo. ${KEEP}`,
  remedyNetwork: `Controlla la rete, poi scarica di nuovo. ${KEEP} Se l’origine predefinita non è raggiungibile, passa a un mirror in ${SOURCE}.`,
  remedyIntegrity: `I file dell’origine del download non corrispondono alla dimensione o al valore sha256 del manifesto e i file non validi sono stati eliminati. Passa a un’altra origine del download (${SOURCE}), poi scarica di nuovo.`,
  remedySource: `L’origine del download non ha questo file o ha negato l’accesso. Verifica che il mirror impostato in ${SOURCE} (o nella variabile d’ambiente BAOCUT_MODELS_ENDPOINT) sia completo.`,
  remedyManifest: 'Il manifesto integrato di questo pacchetto di modelli non ha un sha256 attendibile, quindi non può essere installato finché BaoCut non viene aggiornato.',
  remedyOffline: 'La modalità rigorosamente offline è attiva, quindi non viene scaricato nulla. Per scaricare, disattivala prima nelle Impostazioni.',
  remedySizeChanged: 'La dimensione del download è cambiata. Conferma di nuovo con il nuovo piano.',
  remedyInUse: 'Un’attività sta usando questo pacchetto di modelli (trascrizione, sintesi, verifica o installazione). Attendi il completamento o annullala in «Attività in background», poi prova a eliminare di nuovo.',
  remedyUnavailable: 'Il pacchetto di modelli non è utilizzabile al momento (installazione incompleta, disattivato o non supportato su questo computer). Riparalo o riattivalo prima.', remedyInstallFailed: `Prova a scaricare di nuovo. ${KEEP}`,
  problemText: (message: string, remedy: string) => /[.!?。！？]$/.test(message) ? `${message} ${remedy}` : `${message}. ${remedy}`,
  removalBody: (unknown: boolean, frees: string | null, kept: readonly { repo: string; usedBy: readonly string[] }[]) => [ unknown ? 'Elimina i file usati solo da questo pacchetto di modelli.' : frees !== null ? `Libera circa ${frees}.` : null, ...kept.map((k) => `${k.repo} viene conservato perché ${and(k.usedBy)} ${pluralForm('it', k.usedBy.length, { one: 'lo usa', other: 'lo usano' })} ancora.`), 'Per usarlo di nuovo, dovrai scaricarlo di nuovo.' ].filter(Boolean).join(' '),
  removed: (bundleId: string) => `Eliminato: ${bundleId}`,
  removedKept: (bundleId: string, repos: readonly string[]) => `Eliminato: ${bundleId} · ${pluralForm('it', repos.length, { one: `${and(repos)} conservato perché altri pacchetti di modelli lo usano ancora`, other: `${and(repos)} conservati perché altri pacchetti di modelli li usano ancora` })}`,
};
