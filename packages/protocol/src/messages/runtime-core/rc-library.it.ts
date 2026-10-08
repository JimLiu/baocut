import type { RcLibraryMessages } from './rc-library.ts';
import { pluralForm } from '../../i18n.ts';

export const it: RcLibraryMessages = {
  problemSeparator: '; ', referenceUndecodable: (p) => `Impossibile decodificare la registrazione di riferimento: ${p.problems}`,
  clonesNotReady: 'La clonazione delle voci non è ancora pronta', entryHasNoFile: 'Questa voce non ha un file',
  notCopyable: (p) => `${p.library === 'glossaries' ? 'Glossari' : p.library === 'voices' ? 'Voci' : 'Colori'} non possono essere copiati direttamente in un video: i glossari si scelgono durante trascrizione e traduzione, le voci durante la sintesi vocale e i colori durante la modifica degli stili`,
  captionItemIdsStyleOnly: 'captionItemIds si applica solo agli stili dei sottotitoli', addFromLibraryLabel: (p) => `Aggiungi «${p.name}» dalla libreria`, duplicateGlossaries: (p) => `glossaries.${p.step} elenca lo stesso glossario più di una volta`,
  tooManyGlossaries: (p) => pluralForm('it', p.max, { one: `Ogni passaggio può usare al massimo ${p.max} glossario`, other: `Ogni passaggio può usare al massimo ${p.max} glossari` }),
  glossaryWrongStep: (p) => `«${p.name}» è un glossario di ${p.transcription ? 'trascrizione' : 'traduzione'} e non può essere usato per ${p.transcribeStep ? 'trascrizione' : 'traduzione'}`,
  selectionDocumentName: 'Voci della libreria in uso', changeSelectionLabel: 'Cambia voci della libreria in uso', adoptDefaultsLabel: 'Usa le voci predefinite della libreria', noDocumentIdAfterWrite: 'Non è stato restituito un ID documento dopo la scrittura',
  speakerBoundTwice: (p) => `Il parlante ${p.speakerId} è stato assegnato due volte`, noSuchDocument: (p) => `Il video non ha il documento ${p.documentId}`,
  documentNotSpeech: (p) => `Il documento ${p.documentId} è ${p.kind}; i parlanti esistono solo nelle trascrizioni (speech)`,
  speakerNotInTranscript: (p) => `La trascrizione ${p.documentId} non ha il parlante ${p.speakerId}`,
  libraryVoiceNoProvider: 'Le voci della libreria vengono sostituite dal clone sul provider scelto per il doppiaggio: non passare providerId',
  outputNotFound: 'Il risultato non esiste', pathNotAbsolute: 'Il percorso del file deve essere assoluto',
  serviceClientNoLibraryVoice: 'I client dei servizi esterni non possono usare le voci della libreria',
  clonerNotConfigured: (p) => `Impossibile clonare voci su ${p.label}: il provider è disattivato o non ha una chiave`,
  cloneExists: (p) => `La voce «${p.name}» ha già un clone valido su ${p.label}`, clonePurpose: (p) => `Clona voce «${p.name}»`, noClone: 'Questa voce non ha un clone su questo provider',
  remoteCloneNotDeleted: (p) => `Il clone su ${p.label} non è stato eliminato, quindi il record è stato conservato: ${p.reason}`,
  cloneUnsupported: (p) => `${p.providerId} non ha un’API di clonazione vocale (per ora la offre solo ElevenLabs)`, cloneVersionGone: 'La versione della voce da clonare non esiste più',
  oldCloneNotDeleted: (p) => `Il vecchio clone sostituito (${p.voiceId}) non è stato eliminato da ${p.label}: ${p.reason}`,
};
