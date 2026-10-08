import type { VoicePickerMessages } from './voice-picker.ts';

export const de: VoicePickerMessages = {
  clonedOn: (provider: string) => `Geklont bei ${provider} · mit diesem Klon synthetisiert`,
  defaultVoice: "Standardstimme",
  providerPreset: (provider: string, name: string) => `${provider}: ${name}`,
  loadingMine: "Meine Stimmen werden geladen…",
  cloneNew: "Neue Stimme klonen…",
  cloneNewHint: "Unter Einstellungen › Modelle › Sprachsynthese › Meine Stimmen aufnehmen oder aus einer Datei importieren",
  myVoices: "Meine Stimmen",
  providerVoices: (provider: string) => `Stimmen von ${provider}`,
  customVoice: "Stimmen-ID eingeben…",
  customVoiceHint: "Eine Stimmen-ID aus Ihrem Anbieterkonto",
  tempReference: "Aufnahme einmal verwenden…",
  tempReferenceHint: "Die Synthese-API dieser Version unterstützt noch keine einmalige Referenzaufnahme · zuerst unter „Meine Stimmen“ speichern und klonen",
  other: "Andere",
  voiceDeleted: "Diese Stimme wurde gelöscht · eine andere auswählen oder zum Standard zurückkehren",
  customLine: "Wird unverändert zur Prüfung an den Anbieter übergeben; Sie können auch unter „Meine Stimmen“ eine geklonte Stimme erstellen und auswählen",
  presetLine: (provider: string, voiceId: string | null) => voiceId === null ? `Stimme von ${provider}` : `Stimme von ${provider} · ${voiceId}`,
  defaultLine: (provider: string, name: string) => `Ohne Auswahl wird die Standardstimme von ${provider} (${name}) verwendet`,
  noDefault: "Dieses Modell hat keine Standardstimme; zuerst eine auswählen",
};
