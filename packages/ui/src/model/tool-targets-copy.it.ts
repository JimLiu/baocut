import type { ToolTargetsMessages } from './tool-targets-copy.ts';

export const it: ToolTargetsMessages = {
  unknownLanguage: 'Lingua sconosciuta',
  langCount: (label, count) => `${label} ×${count}`, joinLangs: (labels) => labels.join(', '),
  tagTranscript: (langs) => `Trascrizione · ${langs}`, tagTranslation: (langs) => `Traduzione · ${langs}`, tagDub: (langs) => `Doppiaggio · ${langs}`,
  tagPending: 'Lettura dei contenuti in corso; verrà scelta una trascrizione all’avvio',
  blockTranscribing: 'Trascrizione in corso; potrai ritrascrivere al termine',
  blockQueued: 'Già in coda per la trascrizione',
  blockTranscribingWait: 'Trascrizione in corso; puoi scegliere al termine',
  blockQueuedWait: 'In coda per la trascrizione; puoi scegliere una volta trascritto',
  blockFailed: 'L’ultima trascrizione non è riuscita; trascrivi prima di nuovo',
  blockNoTranscript: 'Nessuna trascrizione ancora presente; trascrivi prima',
  duplicateTranscript: (langs) =>
    `Questo video ha già una trascrizione in ${langs}. Per impostazione predefinita viene creato un nuovo video e questo video e le sue traduzioni restano invariati. «Sostituisci la trascrizione di questo video» cambia la trascrizione attuale: le traduzioni vengono riportate abbinando l’originale, le frasi con originale cambiato vengono segnate come non aggiornate, e il tutto è un’unica modifica annullabile.`,
  duplicateTranslation: (lang) =>
    `Questo video ha già una traduzione in ${lang}. Ne viene aggiunta un’altra e conservata quella esistente; scegli quale usare nell’editor.`,
  duplicateDub: (lang) => `Questo video ha già un doppiaggio in ${lang}. Viene aggiunto un altro gruppo e conservato quello esistente.`,
  duplicateTitle: {
    transcribe: 'Questo video ha già una trascrizione',
    'translate-subtitles': 'Le traduzioni esistenti vengono conservate',
    dub: 'I doppiaggi esistenti vengono conservati',
  },
  translationOption: (lang, nth) => `Traduzione in ${lang}${nth === null ? '' : ` #${nth}`}`,
  translatedFrom: (lang) => `Dalla trascrizione in ${lang}`,
  destNewVideo: 'Nuovo video',
  destNewVideoNote:
    'Un nuovo video nello stesso progetto collegato allo stesso materiale; questo video e le sue traduzioni restano invariati',
  destReplace: 'Sostituisci la trascrizione di questo video',
  destReplaceNote:
    'Cambia la trascrizione attuale; traduzioni, sottotitoli e doppiaggi vengono riportati nella stessa modifica, che puoi annullare',
  newVideoName: (name) => `${name} · Ritrascritto`,
  impactTranslation: (lang, units) => `${lang} · ${units} ${units === 1 ? 'frase' : 'frasi'}`,
  impactDub: (lang, groups) =>
    `${lang} · ${groups} ${groups === 1 ? 'gruppo' : 'gruppi'} · il doppiaggio delle frasi con traduzione invariata viene mantenuto e segnato come forse non sincronizzato`,
  impactRule:
    'Le frasi con originale invariato mantengono traduzione e stato di revisione, allineate per frase; quelle cambiate o non abbinabili vengono segnate come non aggiornate, da ritradurre poi con «Aggiorna traduzioni non aggiornate». I numeri esatti sono nel risultato.',
  impactUndo: 'Un’unica modifica, che puoi annullare',
};
