import { pluralForm } from '@baocut/protocol';
import type { LegacyImportRunMessages } from './legacy-import-run.ts';

const imported = (n: number) => pluralForm('it', n, { one: `${n} importato`, other: `${n} importati` });
const notImported = (n: number) => pluralForm('it', n, { one: `${n} non importato`, other: `${n} non importati` });
const stillNotImported = (n: number) =>
  pluralForm('it', n, { one: `${n} ancora non importato`, other: `${n} ancora non importati` });

export const it: LegacyImportRunMessages = {
  offlineTitle: (name) => `L’unità «${name}» non è collegata`,
  offlineWhy: (n, root) =>
    pluralForm('it', n, {
      one: `I video usati da questo progetto sono su questa unità (${root}), che al momento non è leggibile.`,
      other: `I video usati da questi ${n} progetti sono su questa unità (${root}), che al momento non è leggibile.`,
    }),
  offlineFix:
    'Collega l’unità, poi fai clic su «Riprova». Se non fai nulla, BaoCut riprova al prossimo avvio. Se il materiale non ti serve più, fai clic su «Salta» e non verrà importato.',
  offlineShort: (n, name) =>
    pluralForm('it', n, {
      one: `${n} progetto ha il materiale sull’unità «${name}», che non è collegata`,
      other: `${n} progetti hanno il materiale sull’unità «${name}», che non è collegata`,
    }),
  missingTitle: 'I file multimediali non sono più al loro posto',
  missingWhy:
    'I file usati dal progetto sono stati spostati, rinominati o eliminati, quindi i percorsi salvati nel progetto precedente non li trovano più.',
  missingFix: 'Rimetti i file dove si trovavano, poi fai clic su «Riprova». Se non riesci a recuperarli, fai clic su «Salta».',
  missingShort: (n) =>
    pluralForm('it', n, {
      one: `${n} progetto ha file multimediali introvabili`,
      other: `${n} progetti hanno file multimediali introvabili`,
    }),
  unreadableTitle: 'Impossibile leggere il file del progetto precedente',
  unreadableWhy: 'Il file del progetto precedente potrebbe essere danneggiato, quindi riprovare probabilmente non servirà.',
  unreadableFix:
    'Mostralo nella cartella per verificare che l’originale ci sia ancora e si apra nella versione precedente. Se non ti serve, fai clic su «Salta».',
  unreadableShort: (n) =>
    pluralForm('it', n, {
      one: `${n} file di progetto non è leggibile`,
      other: `${n} file di progetto non sono leggibili`,
    }),
  failedTitle: 'Importazione interrotta a metà',
  failedWhy: 'Il progetto è stato letto, ma l’importazione si è interrotta a metà. Il report di importazione registra cosa è successo.',
  failedFix:
    'Fai clic su «Riprova» per tentare di nuovo. Se non funziona ancora, mostra il report nella cartella. Se il progetto non ti serve, fai clic su «Salta».',
  failedShort: (n) =>
    pluralForm('it', n, {
      one: `${n} progetto si è interrotto a metà importazione`,
      other: `${n} progetti si sono interrotti a metà importazione`,
    }),
  missingMany: (n, first) => `Mancano ${n} file, per esempio ${first}`,
  missingOne: (file) => `Manca ${file}`,
  missingNone: 'File multimediali non trovati',
  failedReport: (report) => `Report di importazione: ${report}`,
  failedNoReport: 'Non è stato scritto alcun report di importazione',
  note: (parts) => `${parts.join('; ')}.`,
  hintOffline: (name) =>
    `Collega «${name}», poi fai clic su «Riprova tutti». Se non fai nulla, BaoCut riprova al prossimo avvio. Per gestirli uno alla volta, apri i dettagli.`,
  hintOther: 'Nei dettagli trovi il motivo e cosa fare per ciascuno. Puoi saltare quelli che non ti servono.',
  subProgress: (done, total) => `Importati ${done}/${total}`,
  subImported: (n) => `Importati ${n}`,
  subPending: (n) => `Da risolvere ${n}`,
  subSkipped: (n) => `Saltati ${n}`,
  subDest: (dest) => `In ${dest}`,
  attention: (n) => `${n} da risolvere`,
  phaseImporting: 'Importazione',
  phaseWaiting: 'In attesa di altre attività',
  detailImporting: (title) => `Importazione di «${title}»`,
  detailWaiting: 'Sono in corso altre attività, quindi l’importazione è in pausa. Riprende automaticamente quando finiscono.',
  bannerRunning: (done, total) => `Importazione dei progetti precedenti · ${done}/${total}`,
  bannerResult: (done, pending) => `Importazione dei progetti precedenti terminata: ${imported(done)}, ${notImported(pending)}`,
  doneAll: (n) =>
    pluralForm('it', n, { one: `${n} progetto precedente importato`, other: `${n} progetti precedenti importati` }),
  doneSome: (done, pending) => `Importazione terminata: ${imported(done)}, ${notImported(pending)}`,
  retriedAll: (n) =>
    pluralForm('it', n, {
      one: 'Il progetto riprovato è stato importato',
      other: `Tutti i ${n} progetti riprovati sono stati importati`,
    }),
  retriedSome: (n, ok) => `Dei ${n} progetti riprovati, ${imported(ok)} e ${stillNotImported(n - ok)}`,
  retriedNone: (n) =>
    pluralForm('it', n, {
      one: 'Il progetto riprovato non è ancora stato importato',
      other: `I ${n} progetti riprovati non sono ancora stati importati`,
    }),
  retrying: (n) => pluralForm('it', n, { one: `Nuova importazione di ${n} progetto`, other: `Nuova importazione di ${n} progetti` }),
  skipped: (n) =>
    pluralForm('it', n, {
      one: `${n} progetto saltato. Non verrà importato automaticamente.`,
      other: `${n} progetti saltati. Non verranno importati automaticamente.`,
    }),
  actionFailed: (message) => `Impossibile completare l’azione: ${message}`,
  undo: 'Annulla',
  viewReasons: 'Vedi perché',
  viewInSpace: 'Visualizza nello Space',
  viewProgress: 'Vedi avanzamento',
  close: 'Chiudi',
  retryAll: 'Riprova tutti',
  skipAll: 'Salta tutti',
  retry: 'Riprova',
  skip: 'Salta',
  reveal: 'Mostra nella cartella',
  importInstead: 'Importa',
  statImported: 'Importati',
  statPending: 'Non importati',
  statSkipped: 'Saltati',
  statLive: 'Non ancora importati',
  pendingSection: 'Progetti non importati',
  pendingHint: 'Se non fai nulla, BaoCut riprova al prossimo avvio. Quelli saltati non vengono importati.',
  howTo: 'Cosa fare: ',
  groupTitle: (title, n) => `${title} · ${n}`,
  liveSection: 'In importazione',
  importingChip: 'In importazione',
  queuedChip: 'In coda',
  importedSection: 'Importati',
  skippedSection: 'Saltati',
  skippedHint: 'Non verranno importati automaticamente. I file originali restano dove sono.',
  expand: (n) => `Mostra altri ${n}`,
  collapse: 'Mostra meno',
};
