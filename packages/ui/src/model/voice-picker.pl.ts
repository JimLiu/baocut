import type { VoicePickerMessages } from './voice-picker.ts';

export const pl: VoicePickerMessages = {
  clonedOn: (provider) => `Sklonowano przez ${provider} · synteza z tym klonem`,
  defaultVoice: "Domyślny głos",
  providerPreset: (provider, name) => `${provider} – ${name}`,
  loadingMine: "Wczytywanie moich głosów…",
  cloneNew: "Sklonuj nowy głos…",
  cloneNewHint: "Nagraj głos lub zaimportuj plik w Ustawienia › Modele › Synteza mowy › Moje głosy",
  myVoices: "Moje głosy",
  providerVoices: (provider) => `${provider} – głosy`,
  customVoice: "Wpisz ID głosu…",
  customVoiceHint: "ID głosu z konta dostawcy",
  tempReference: "Użyj nagrania jednorazowo…",
  tempReferenceHint: "API syntezy tej wersji nie przyjmuje jeszcze jednorazowego nagrania referencyjnego · najpierw zapisz je w „Moje głosy” i sklonuj",
  other: "Inne",
  voiceDeleted: "Ten głos został usunięty · wybierz inny lub wróć do domyślnego",
  customLine: "Przekazywany dostawcy bez zmian do sprawdzenia; możesz też utworzyć sklonowany głos w „Moje głosy” i go wybrać",
  presetLine: (provider, voiceId) => (voiceId === null ? `${provider} – głos` : `${provider} – głos · ${voiceId}`),
  defaultLine: (provider, name) => `Jeśli nie wybierzesz, zostanie użyty głos ${provider} domyślny (${name})`,
  noDefault: "Ten model nie ma domyślnego głosu; najpierw wybierz głos",
};
