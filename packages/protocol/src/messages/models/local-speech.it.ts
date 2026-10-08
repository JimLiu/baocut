import type { ModelsLocalSpeechMessages } from './local-speech.ts';

export const it: ModelsLocalSpeechMessages = {
  paceQwen06: 'circa 55 volte più lento del tempo reale; una frase di 3 secondi richiede da due a tre minuti',
  paceQwen17: 'si prevede che sia più lento dello 0.6B (circa 55 volte più lento del tempo reale); questo non è stato misurato',
  paceIndexTts2: 'si prevede che sia simile a IndexTTS 2.5 (120–145 volte più lento del tempo reale); questo non è stato misurato',
  paceIndexTts25: '120–145 volte più lento del tempo reale; una frase di quattro o cinque secondi richiede da sette a dieci minuti',
  paceGptSovits: 'circa 6 volte più lento del tempo reale; una frase di 4 secondi richiede circa mezzo minuto',
  paceVoxcpm2: 'il modello più grande; si prevede che ogni frase richieda diversi minuti; questo non è stato misurato',
  paceOmnivoice: 'circa 30 volte più lento del tempo reale; una frase di 4 secondi richiede circa due minuti',
  paceDefault: 'ogni frase richiede qualche minuto',
  cpuNote: (p) => `Sintetizza sulla CPU di questo computer usando solo uno o due core: ${p.pace}. Dovrebbe essere molto più veloce con una GPU NVIDIA (CUDA) (non misurato)`,
  oneVoiceSource: 'Indica solo uno tra voice, reference e voiceDescription',
  modeUnsupported: (p) => `Il modello ${p.modelId} non supporta ${p.what} (${p.mode})`,
  modeClone: 'clonazione da una registrazione di riferimento', modeDescribe: 'creazione di una voce da una descrizione',
  noReferenceTranscript: (p) => `Il modello ${p.modelId} non legge la trascrizione della registrazione di riferimento (reference.transcript)`,
  descriptionEmpty: 'La descrizione non può essere vuota',
  noPresetVoice: (p) => `Il modello ${p.modelId} non ha voci preset; indica ${p.need}`,
  noSuchVoice: (p) => `Il modello ${p.modelId} non ha la voce ${p.voice}`, noDefaultVoice: (p) => `Il modello ${p.modelId} non ha una voce predefinita; specifica voice`,
  termNotInVocabulary: (p) => `Le descrizioni vocali del modello ${p.modelId} accettano solo parole del suo vocabolario: «${p.term}» non è presente`,
  onePerCategory: (p) => `Le descrizioni vocali del modello ${p.modelId} accettano al massimo un termine per categoria (${p.category})`,
  builtinReferenceLabel: 'registrazione della voce integrata',
  referenceUnreadable: (p) => `Impossibile leggere la registrazione di riferimento «${p.name}»: manca, non è un file o non è leggibile. Prova un’altra registrazione`,
};
