import type { TranscribeSetupMessages } from './transcribe-copy.ts';
export const nl: TranscribeSetupMessages = {
  title: 'Transcriptie-instellingen', language: 'Taal', model: 'Spraakmodel', manageModels: 'Spraakmodellen beheren', modelsLoading: 'Spraakmodellen laden…', downloadThenSelect: (name, pct) => `${name} wordt gedownload${pct === null ? '' : ` · ${pct}%`} · wordt daarna automatisch gekozen`, noDefault: 'Er is nog geen standaardspraakmodel', hint: 'Herkenningshints', glossary: 'Woordenlijst', manageGlossary: 'Woordenlijsten beheren', glossaryLoading: 'Woordenlijsten laden…',
  glossaryEmpty: 'Er is nog geen transcriptwoordenlijst. Maak er een in Instellingen › Woordenlijst om de juiste schrijfwijze van eigennamen vast te leggen.',
  glossaryFailed: (message) => `Kan de ingeschakelde woordenlijsten voor deze video niet lezen: ${message}`,
  glossaryNote: 'Vink een woordenlijst aan om deze voor deze video in te schakelen. Elke volgende transcriptie gebruikt deze; je kunt dit ongedaan maken.',
  glossaryReadOnly: 'Deze video kan momenteel niet worden bewerkt. De ingeschakelde woordenlijsten kunnen niet worden gewijzigd.',
  glossaryLimit: (n) => `Je kunt maximaal ${n} woordenlijsten per video inschakelen`, glossaryOn: (name) => `‘${name}’ ingeschakeld voor deze video`, glossaryOff: (name) => `‘${name}’ uitgeschakeld`, glossaryWriteFailed: (message) => `Kan de ingeschakelde woordenlijsten niet wijzigen: ${message}`,
  undo: 'Ongedaan maken', prompt: 'Aangepaste prompt', promptPlaceholder: 'Optioneel. Bijvoorbeeld: een Nederlandse podcast over het optimaliseren van modelredenering, met presentator Tim en gast Eva.',
  how: 'De prompt en de juiste schrijfwijzen uit de ingeschakelde woordenlijsten worden samen naar het spraakmodel gestuurd om eigennamen beter te herkennen. Als het geheel de limiet overschrijdt, worden de laatste termen weggelaten.',
  reuse: 'Voor media die al zijn getranscribeerd, wordt de bestaande transcriptie gebruikt. Deze instellingen gelden alleen voor media die nog moeten worden getranscribeerd.',
};
