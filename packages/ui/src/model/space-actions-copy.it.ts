import type { SpaceActionsMessages } from './space-actions-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: SpaceActionsMessages = {
  edit: { video: 'Apri video', 'source-video': 'Modifica nel video di origine', 'new-video': 'Nuovo video da questo materiale', text: 'Modifica testo', version: 'Salva una copia e modifica' },
  trashed: 'Ripristina prima questa voce dal Cestino', editGenerating: 'Generazione in corso; puoi modificare al termine', editMissing: 'File non trovato; ricollegalo prima di modificare', editFailed: 'Generazione non riuscita; non c’è un file da modificare', editPackage: 'I pacchetti video (pacchetti portatili) non possono essere modificati',
  editText: 'Non è ancora possibile salvare qui una nuova versione del testo; continua in una sessione e lascia che l’agente lo modifichi',
  editVersion: 'Le modifiche manuali a immagini, audio e template non sono ancora disponibili; continua in una sessione e lascia che l’agente li modifichi',
  newVideoOutside: 'Questo file non è in una cartella di progetto o sessione, quindi non può ancora essere usato per un nuovo video',
  packageGenerating: 'Esportazione in corso; puoi aprire al termine', packageMissing: 'Impossibile trovare questo file', packageFailed: 'Esportazione non riuscita; non c’è un pacchetto da aprire', packageOutside: 'Questo pacchetto non è in una cartella di progetto o sessione, quindi non può ancora essere aperto',
  continueTrashed: 'Ripristina questa voce dal Cestino prima di portarla in una sessione', purgeGenerating: 'L’attività è ancora in corso; annullala prima nella pagina Attività', purgeNotTrashed: 'Spostalo prima nel Cestino, poi eliminalo dal Cestino',
  referenceKind: { 'video-asset': 'Materiale video', job: 'Attività in corso', unverified: 'Impossibile confermare', 'user-file': 'Altri file nella cartella del video' },
  importAllFailed: (count: number, error: string) => `Nessuno dei ${count} file è stato importato: ${error}`,
  importFailed: (error: string) => `Non importato: ${error}`,
  imported: (count: number) => pluralForm('it', count, { one: `${count} materiale importato`, other: `${count} materiali importati` }),
  copiedAll: 'copiati in imports/ del progetto', copiedSome: (count: number) => pluralForm('it', count, { one: `${count} copiato in imports/ del progetto`, other: `${count} copiati in imports/ del progetto` }), notImported: (count: number) => pluralForm('it', count, { one: `${count} non importato`, other: `${count} non importati` }),
  references: (names: readonly string[], total: number) => { const quoted = names.map((name) => `«${name}»`).join(', '); return total > names.length ? `Voci dello Space ${quoted} e altre ${total - names.length}` : `${pluralForm('it', total, { one: 'Voce dello Space', other: 'Voci dello Space' })} ${quoted}`; },
  referenceOutput: 'Risultato',
};
