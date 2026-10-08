import type { VoicePickerMessages } from './voice-picker.ts';

export const nl: VoicePickerMessages = {
  clonedOn: (provider: string) => `Gekloond bij ${provider} · gesynthetiseerd met deze kloon`,
  defaultVoice: "Standaardstem",
  providerPreset: (provider: string, name: string) => `${provider}: ${name}`,
  loadingMine: "Mijn stemmen laden…",
  cloneNew: "Nieuwe stem klonen…",
  cloneNewHint: "Neem een stem op of importeer een bestand bij Instellingen › Modellen › Spraaksynthese › Mijn stemmen",
  myVoices: "Mijn stemmen",
  providerVoices: (provider: string) => `Stemmen van ${provider}`,
  customVoice: "Voer een stem-ID in…",
  customVoiceHint: "Een stem-ID uit je aanbiederaccount",
  tempReference: "Een opname eenmalig gebruiken…",
  tempReferenceHint: "De synthese-API van deze versie accepteert nog geen eenmalige referentieopname · sla die eerst op bij Mijn stemmen en kloon die",
  other: "Overig",
  voiceDeleted: "Deze stem is verwijderd · kies een andere of ga terug naar de standaard",
  customLine: "Wordt ongewijzigd doorgegeven aan de aanbieder ter controle; je kunt ook een gekloonde stem maken bij Mijn stemmen en die kiezen",
  presetLine: (provider: string, voiceId: string | null) => voiceId === null ? `Stem van ${provider}` : `Stem van ${provider} · ${voiceId}`,
  defaultLine: (provider: string, name: string) => `Als je niet kiest, wordt de standaardstem van ${provider} (${name}) gebruikt`,
  noDefault: "Dit model heeft geen standaardstem; kies er eerst een",
};
