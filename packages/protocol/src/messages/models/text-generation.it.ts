import type { ModelsTextGenerationMessages } from './text-generation.ts';

export const it: ModelsTextGenerationMessages = {
  noMessage: 'È richiesto almeno un messaggio non vuoto di user o assistant', badRole: 'Il ruolo di un messaggio deve essere system, user o assistant',
  inputTooLong: (p) => `L’input ha ${p.chars} caratteri, molto oltre il contesto di ${p.contextTokens} token del modello ${p.modelId}`,
  maxOutput: (p) => `Il modello ${p.modelId} produce al massimo ${p.max} token per chiamata`,
  noTemperature: (p) => `Il modello ${p.modelId} non accetta temperature`, temperatureRange: 'temperature deve essere compresa tra 0 e 2', noSeed: (p) => `Il modello ${p.modelId} non accetta seed`,
  noStructured: (p) => `Il modello ${p.modelId} non supporta l’output strutturato`,
  effortIgnored: (p) => `Il modello ${p.modelId} non può regolare l’intensità di ragionamento; ignorato ${p.requested}`,
  effortChanged: (p) => `Il modello ${p.modelId} non ha l’intensità di ragionamento ${p.requested}; usato ${p.applied}`, contentFiltered: (p) => `Il filtro dei contenuti di ${p.provider} ha bloccato questo output`,
  truncatedJson: (p) => `L’output di ${p.provider} ha raggiunto il limite (${p.max} token) ed è stato troncato; l’output strutturato è incompleto`,
  truncatedProblem: (p) => `Output troncato (maxOutputTokens ${p.max})`, notJson: (p) => `L’output di ${p.provider} non è JSON valido`, notJsonProblem: 'JSON non valido',
  schemaMismatch: (p) => `L’output di ${p.provider} non corrisponde al JSON Schema fornito`,
  limitBeforeText: (p) => `${p.provider} ha raggiunto il limite di output prima di scrivere testo`, emptyOutput: (p) => `${p.provider} ha restituito un output vuoto`,
  limitBeforeTextProblem: (p) => `Ancora nessun testo quando è stato raggiunto il limite di output di ${p.max} token`, emptyProblem: 'L’output è vuoto', cancelled: 'Chiamata annullata',
};
