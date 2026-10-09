import type { ThreadMessages } from './thread-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ThreadMessages = {
  withDetail: (text, detail) => `${text} (${detail})`,
  copy: 'Copia', copied: 'Copiato', copyFailed: 'Impossibile copiare. Riprova', copyCode: 'Copia codice', copyReply: 'Copia questa risposta',
  change: {
    added: (n) => `Aggiunti: ${n}`, updated: (n) => `Modificati: ${n}`, deleted: (n) => `Eliminati: ${n}`,
    duration: (clock) => `Durata ${clock}`, durationChange: (before, after) => `Durata ${before} → ${after}`, revision: (before, after) => `Versione ${before} → ${after}`,
    locked: 'Il video non può essere modificato al momento',
    undoStep: (videoName, label) => `Annullato un passaggio in «${videoName}»: ${label}`,
    changed: (videoName, label) => `Modificato «${videoName}»: ${label}`, aria: (label) => `Modifica video: ${label}`,
  },
  message: {
    contextTitle: 'Stato dell’editor inviato con il messaggio',
    context: (videoName, revision, playhead, selected) => `«${videoName}» · Versione ${revision} · Testina di riproduzione ${playhead}${selected ? ` · ${pluralForm('it', selected, { one: `${selected} clip selezionata`, other: `${selected} clip selezionate` })}` : ''}`,
  },
  output: { aria: (name, detail) => `${name}, ${detail}` },
  steps: { more: (n) => `${n} in corso`, failed: (n) => pluralForm('it', n, { one: `${n} non riuscito`, other: `${n} non riusciti` }), thinking: 'Ragionamento', viewFile: (name) => `Visualizza ${name}`, input: 'Input', error: 'Errore', output: 'Output', waiting: 'In attesa di output', noOutput: 'Nessun output' },
};
