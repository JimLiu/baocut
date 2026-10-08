import type { VoicePickerMessages } from './voice-picker.ts';

export const it: VoicePickerMessages = {
  clonedOn: (provider) => `Clonata su ${provider} · sintetizzata con questo clone`,
  defaultVoice: 'Voce predefinita',
  providerPreset: (provider, name) => `${name} di ${provider}`,
  loadingMine: 'Caricamento di «Le mie voci»…',
  cloneNew: 'Clona una nuova voce…',
  cloneNewHint: 'Registra o importa da un file in Impostazioni › Modelli › Sintesi vocale › Le mie voci',
  myVoices: 'Le mie voci',
  providerVoices: (provider) => `Voci di ${provider}`,
  customVoice: 'Inserisci un ID voce…',
  customVoiceHint: 'Un ID voce del tuo account del provider',
  tempReference: 'Usa una registrazione una volta…',
  tempReferenceHint: 'L’API di sintesi di questa versione non accetta ancora una registrazione di riferimento temporanea · salvala in «Le mie voci» e clonala prima',
  other: 'Altro',
  voiceDeleted: 'Questa voce è stata eliminata · scegline un’altra o torna a quella predefinita',
  customLine: 'Inviato al provider senza modifiche per la verifica; puoi anche creare una voce clonata in «Le mie voci» e sceglierla',
  presetLine: (provider, voiceId) => voiceId === null ? `Voce di ${provider}` : `Voce di ${provider} · ${voiceId}`,
  defaultLine: (provider, name) => `Se non scegli, viene usata la voce predefinita di ${provider} (${name})`,
  noDefault: 'Questo modello non ha una voce predefinita; scegline prima una',
};
