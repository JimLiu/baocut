import type { ModelsProbeMessages } from './models-probe-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ModelsProbeMessages = {
  speechText: 'Ciao, questo è un test di sintesi vocale di BaoCut.',
  noResult: 'L’attività è terminata, ma non è stato restituito alcun risultato.',
  failed: 'L’attività non è riuscita.', cancelled: 'L’attività è stata annullata.',
  interrupted: 'Il Runtime si è riavviato, quindi questo test non è stato completato.',
  unknownOutcome: 'Il Runtime si è riavviato prima che questa chiamata ricevesse una risposta, quindi il risultato è sconosciuto.',
  audioFacts: (seconds, khz, type) => `${seconds} s · ${khz} kHz · ${type}`,
  videoFacts: (width, height, seconds, type) => `${width} × ${height} · ${seconds} s · ${type}`,
  textFacts: (entries, seconds, type) => `${pluralForm('it', entries, { one: `${entries} voce`, other: `${entries} voci` })} · ${seconds} s · ${type}`,
  packageFacts: (files, type) => `${files} file · ${type}`,
  projectFacts: (clips, seconds, type) => `${clips} clip · ${seconds} s · ${type}`,
  chars: (count) => `${count} caratteri`, inputTokens: (count) => `${count} token di input`, outputTokens: (count) => `${count} token di output`,
  hitLimit: 'Limite di output raggiunto', filtered: 'Bloccato dal filtro dei contenuti del provider',
  untested: 'Non testato', testing: 'Test in corso…', passed: 'Test superato',
  passedIn: (seconds) => `Test superato · ${seconds} s`,
};
