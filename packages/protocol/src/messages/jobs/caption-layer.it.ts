import type { JobsCaptionLayerMessages } from './caption-layer.ts';
import { pluralForm } from '../../i18n.ts';

export const it: JobsCaptionLayerMessages = {
  label: 'Aggiungi livello di sottotitoli',
  noSource: 'Non c’è un documento per cui aggiungere un livello di sottotitoli',
  videoClosed: 'Il video è stato chiuso, quindi non è stato aggiunto alcun livello di sottotitoli. Apri il video e riprova.',
  empty: 'Il documento non ha sottotitoli da mostrare, quindi non è stato aggiunto alcun livello di sottotitoli',
  notOnTimeline: 'Nessuna clip nella timeline usa questo materiale, quindi i sottotitoli non possono comparire sullo schermo. Non è stato aggiunto alcun livello di sottotitoli.',
  noDocumentId: 'Il livello di sottotitoli è stato aggiunto, ma il suo ID documento non è stato restituito',
  rejected: 'La transazione per aggiungere il livello di sottotitoli è stata rifiutata',
  documentGone: 'Il documento del livello di sottotitoli non è più nel video',
  needsOutputStore: 'La lettura dei sottotitoli dello Speech Worker richiede l’archivio dei risultati',
  notSpeech: 'Il documento non è una trascrizione',
  speechUnreadable: 'Impossibile leggere il corpo della trascrizione',
  translationUnreadable: 'Impossibile leggere il corpo della traduzione',
  unaligned: (p: { count: number }) => pluralForm('it', p.count, { one: `${p.count} unità di traduzione non è allineata (alignment è null), quindi non è possibile determinarne i tempi`, other: `${p.count} unità di traduzione non sono allineate (alignment è null), quindi non è possibile determinarne i tempi` }),
  noSourceSpeech: 'Impossibile trovare la trascrizione da cui è stata creata questa traduzione',
  subtitlesName: 'Sottotitoli', translationName: 'Traduzione', styleName: 'Stile dei sottotitoli',
};
