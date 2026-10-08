import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const fr: TranscribeSpeakersMessages = {
  packFallback: 'Diarisation des locuteurs', builtinNote: (model) => `${model} distingue lui-même les locuteurs pendant la transcription`,
  builtinSummary: 'Identifier les locuteurs · intégré au modèle',
  noneNote: (model) => `${model} ne distingue pas les locuteurs. Si nécessaire, choisissez un modèle local ou un service qui intègre cette fonction`,
  missingNote: (pack, size) => `Téléchargez d’abord « ${pack} »${size ? ` (${size})` : ''} pour distinguer les locuteurs`, missingSummary: 'Identifier les locuteurs · téléchargez d’abord le modèle',
  onNote: 'Après la transcription, « Diarisation des locuteurs » attribue chaque phrase à son locuteur, et les sous-titres et transcriptions incluent les noms',
  summaryOn: 'Identifier les locuteurs', offNote: 'Les locuteurs ne sont pas distingués ; les sous-titres et transcriptions n’incluront pas les noms', summaryOff: 'Ne pas identifier les locuteurs',
  downloading: (pack, pct) => `Téléchargement de « ${pack} »${pct === null ? '…' : ` · ${pct} %`}`,
};
