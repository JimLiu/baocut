import type { TextNotConfiguredMessages, TranslateMessages } from './translate-copy.ts';
import { pluralForm } from '@baocut/protocol';

const sentences = (n: number): string => pluralForm('it', n, { one: `${n} frase`, other: `${n} frasi` });
const subtitles = (n: number): string => pluralForm('it', n, { one: `${n} sottotitolo`, other: `${n} sottotitoli` });

export const itTranslate: TranslateMessages = {
  title: 'Traduci in una nuova lingua', back: 'Torna ai sottotitoli', target: 'Lingua di destinazione', targetPicker: 'Lingua in cui tradurre', source: 'Originale', sourcePicker: 'Trascrizione da tradurre',
  sourceLine: (language: string, count: number | null) => count === null ? language : `${language} · ${sentences(count)}`,
  model: 'Modello di testo', modelPicker: 'Modello di testo per la traduzione', manage: 'Gestisci modelli di testo…', modelsLoading: 'Caricamento dei modelli di testo…', noStructured: 'Nessun output strutturato · non utilizzabile per la traduzione',
  notConfiguredTitle: 'Nessun modello di testo disponibile',
  notConfiguredBody: 'La traduzione chiama un modello di testo un gruppo alla volta. In Impostazioni › Modelli › Generazione di testo, collega un provider (inserisci la sua chiave) e scegli un modello che supporti l’output strutturato, poi torna qui per iniziare.',
  goModels: 'Apri Impostazioni › Modelli › Generazione di testo', style: 'Indicazioni di stile', stylePlaceholder: 'Ad esempio: colloquiale, conciso; mantieni i nomi nell’originale', styleHint: 'Facoltativo; massimo 500 caratteri.', glossary: 'Glossario',
  glossaryNote: 'Spunta = attivo per questo video (modifica annullabile). La traduzione usa i glossari attivi con la direzione corrispondente; se ci sono molte voci, ogni gruppo include solo quelle presenti nell’originale.',
  glossaryManage: 'Gestisci glossari…', glossaryEmpty: (target: string) => `La libreria dei glossari non contiene ancora glossari di traduzione verso ${target}.`, glossaryLoading: 'Caricamento dei glossari…',
  glossaryCount: (terms: number, hits: number) => `${pluralForm('it', terms, { one: `${terms} voce`, other: `${terms} voci` })} · ${pluralForm('it', hits, { one: `${hits} trovata in questo video`, other: `${hits} trovate in questo video` })}`,
  glossaryFailed: (message: string) => `Impossibile leggere quali glossari sono attivi per questo video: ${message}`,
  glossaryReadOnly: 'Il video è di sola lettura, quindi non puoi cambiare i glossari attivi.', glossaryLimit: (max: number) => `Puoi attivare al massimo ${max} glossari alla volta`,
  glossaryOn: (name: string) => `«${name}» attivato per questo video`, glossaryOff: (name: string) => `«${name}» disattivato per questo video`, glossaryWriteFailed: (message: string) => `Impossibile cambiare i glossari attivi: ${message}`,
  bilingual: 'Mostra entrambe le lingue', bilingualHint: 'Al termine della traduzione, l’originale e la traduzione appaiono insieme sullo schermo. Se disattivato, appare solo la traduzione e l’originale viene rimosso dallo schermo (senza eliminarlo).',
  cta: (language: string) => `Traduci in ${language}`, ctaHint: 'Al termine viene posizionata automaticamente sullo schermo e puoi annullare in qualsiasi momento. I modelli online sono fatturati per token.',
  noSpeechTitle: 'Nessuna trascrizione da tradurre', noSpeech: 'La traduzione lavora frase per frase da una trascrizione. Prima trascrivi un materiale con «Genera sottotitoli» nel pannello Sottotitoli; i file di sottotitoli importati non hanno i tempi delle parole e non possono essere tradotti direttamente.',
  busy: 'Questo video è già in traduzione; attendi il termine prima di avviare un’altra lingua.', readOnly: 'Il video è di sola lettura, quindi non può essere tradotto.', allTaken: 'Tutte le lingue comuni hanno già una traduzione.',
  submitting: 'Invio della traduzione', queued: 'In coda', running: (from: string, to: string) => `Traduzione · ${from} → ${to}`,
  stepUnits: (done: number, total: number | null) => total ? `Frasi tradotte: ${done} / ${total}` : `Tradotte: ${sentences(done)}`,
  cancel: 'Annulla traduzione', cancelled: 'Traduzione annullata', cancelFailed: (message: string) => `Impossibile annullare la traduzione: ${message}`,
  liveNote: 'Al termine viene posizionata automaticamente sullo schermo e puoi annullare in qualsiasi momento. Puoi lasciare questa pagina.', foreign: 'Questa traduzione non è stata avviata qui. Al termine, usa «Posiziona sullo schermo» nell’elenco di confronto.', chipTip: (step: string) => `Traduzione · ${step}`,
  notConfigured: (reason: string) => `Impossibile tradurre al momento · ${reason}`, submitFailed: 'Impossibile avviare la traduzione', failed: 'Traduzione non riuscita', interrupted: 'Traduzione interrotta', retry: 'Riprova', retrying: 'Nuovo tentativo', retryFailed: (message: string) => `Impossibile riprovare: ${message}`,
  retryCharges: 'Il nuovo tentativo riprende dal passaggio in cui si è fermato. Se era il passaggio «Traduci», il modello viene chiamato di nuovo e potresti ricevere un nuovo addebito.', retryFree: 'Il nuovo tentativo riprende dal passaggio in cui si è fermato; le traduzioni completate non chiamano di nuovo il modello.', dismiss: 'OK', decide: 'Risolvi in Attività in background',
  emptyTitle: 'La traduzione non ha frasi da posizionare sullo schermo', empty: 'Tutte le frasi della traduzione sono obsolete o vuote.', pendingTitle: 'Traduzione completata, ma non ancora sullo schermo', pending: 'La traduzione è salvata nel video. Fai clic su «Posiziona sullo schermo» nell’elenco di confronto.',
  offTimeline: 'Nessuna clip sulla timeline usa questo materiale, quindi i sottotitoli non possono essere posizionati sullo schermo. La traduzione è salvata nel video; fai clic su «Posiziona sullo schermo» nell’elenco di confronto.', badDocument: 'Il formato della traduzione o della trascrizione non è riconosciuto, quindi non può essere suddiviso in sottotitoli.',
  applied: (language: string, count: number) => `Applicata · tradotta in ${language} · ${subtitles(count)}`,
  appliedNote: (bilingual: boolean): string => bilingual ? 'L’originale e la traduzione appaiono insieme sullo schermo.' : 'Appare solo la traduzione; l’originale è stato rimosso (senza eliminarlo: puoi ripristinarlo dalla barra).',
  undo: 'Annulla', done: 'Fatto', undone: (language: string) => `Annullata · sottotitoli in ${language} rimossi dallo schermo`, undoneNote: 'L’originale non è stato modificato; la traduzione resta nel video e puoi usare di nuovo «Posiziona sullo schermo» dall’elenco di confronto.', undoFailed: 'Impossibile annullare: il video è cambiato dopo questo passaggio. Annulla nell’editor.',
  place: 'Posiziona sullo schermo', placing: 'Posizionamento sullo schermo', unnamed: 'Traduzione', placed: (language: string, count: number) => `Traduzione in ${language} posizionata sullo schermo · ${subtitles(count)}`, notPlaced: 'Questa traduzione non è ancora sullo schermo.',
  list: 'Elenco', modes: { src: 'Solo originale', bi: 'Originale + traduzione', trans: 'Solo traduzione' }, compareLanguage: 'Traduzione da confrontare', noTranslation: 'Nessuna traduzione · usa prima «Traduci in…» sulla barra', original: (language: string) => `Originale · ${language}`, translation: (language: string) => `Traduzione · ${language}`, reading: 'Caricamento della traduzione…', unreadable: 'Il formato di questa traduzione non può ancora essere visualizzato qui.', speechMissing: 'La trascrizione di questa traduzione non è più nel video.', stats: (count: number) => sentences(count),
  untranslated: (n: number) => pluralForm('it', n, { one: `${n} frase non tradotta`, other: `${n} frasi non tradotte` }), stale: (n: number) => pluralForm('it', n, { one: `${n} frase tradotta è obsoleta`, other: `${n} frasi tradotte sono obsolete` }), gone: (n: number) => pluralForm('it', n, { one: `${n} frase originale eliminata`, other: `${n} frasi originali eliminate` }),
  allFresh: 'Tutte le traduzioni sono aggiornate ✓', refreshHint: 'Fai clic su una traduzione per modificarla direttamente; quelle modificate non sono più considerate obsolete. Per ritradurre solo queste frasi, affidale all’Agente:', refreshOpen: 'Aggiorna traduzioni obsolete', refreshHintWeb: 'Fai clic su una traduzione per modificarla direttamente; quelle modificate non sono più considerate obsolete.', chipStale: 'Obsoleta', chipUntranslated: 'Non tradotta', chipGone: 'Originale eliminato', goneTip: 'Questa frase non è più nella trascrizione: la sua traduzione non apparirà sullo schermo e non può essere modificata.', emptyPlaceholder: '(Nessuna traduzione · fai clic per inserirla)',
  editLabel: (n: number) => `Modifica la traduzione della frase ${n}`, editing: 'Traduzione', editHint: 'Fai clic su una frase tradotta per riscriverla: viene salvata quando fai clic altrove, mentre Esc scarta le modifiche. I sottotitoli sullo schermo si aggiornano di conseguenza.', editTail: 'Fai clic su una traduzione per modificarla', noRows: 'Questa traduzione non ha ancora frasi.', edited: 'Frase tradotta riscritta', editFailed: (message: string) => `Impossibile riscrivere: ${message}`, seekTip: 'Sposta la testina di riproduzione su questa frase', cutTip: 'Il filmato di questa frase è stato tagliato', translateTo: (language: string) => `Traduci in ${language}`, rewriteTranslation: 'Modifica traduzione', unknownLanguage: 'Lingua sconosciuta', targetLanguage: 'la lingua di destinazione',
};

export const itTextNotConfigured: TextNotConfiguredMessages = {
  'no-default': 'Nessun modello scelto per la generazione di testo',
  'missing-credential': 'Il provider del modello di testo non ha ancora una chiave',
  'not-installed': 'Il modello di testo non è ancora installato',
  'signed-out': 'L’agente non ha ancora effettuato l’accesso',
  outdated: 'La versione dell’agente è troppo vecchia',
  'not-paired': 'Il nodo remoto non è ancora associato',
  'not-connected': 'Il nodo remoto non è connesso',
  unsupported: 'Il servizio scelto non supporta la generazione di testo',
  disabled: 'Il servizio di generazione di testo è disattivato',
};
