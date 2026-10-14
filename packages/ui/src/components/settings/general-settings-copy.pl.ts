import type { GeneralSettingsMessages } from './general-settings-copy.ts';

export const pl: GeneralSettingsMessages = {
  interfaceGroup: "Interfejs",
  language: "Język",
  languageDesc: "Działa od razu, bez ponownego uruchamiania.",
  languageSystem: (current: string) => `Systemowy (${current})`,
  appearance: "Wygląd",
  appearanceDesc: "Dotyczy tylko okien BaoCut na tym komputerze.",
  schemeSystem: "Systemu",
  schemeLight: "Jasny",
  schemeDark: "Ciemny",

  saveFailed: (message: string) => `Nie udało się zapisać: ${message}`,

  editingGroup: "Edycja i transkrypcja",
  autoOpen: "Otwieraj wideo automatycznie po transkrypcji",
  autoOpenDesc: "Dla importów lokalnych. Gdy import z linku kończy się w tle, pojawia się tylko powiadomienie, a obecna strona nie zmienia się.",
  autoOpenNote: "Jeszcze niepodłączone: po transkrypcji pozostajesz na obecnej stronie, wideo nie otwiera się automatycznie.",
  lineLength: "Długość linii napisów",
  lineLengthDesc: "Ustawia docelową długość automatycznych podziałów wiersza. Ręczne zmiany pozostają bez zmian.",
  lineLengthNote: (maxChars: number, custom: string | null) => `Jeszcze niepodłączone: automatyczne podziały są stałe na ${maxChars} znakach połowy szerokości na wiersz (każdy znak CJK liczy się jako dwa).${custom ? ` Zapisano własną wartość (${custom}).` : ""}`,
  cueShading: "Cieniowanie napisów w transkrypcji",
  cueShadingDesc: "Lekko cieniuje zakres każdego napisu, pokazując podziały.",
  cueShadingNote: "Jeszcze niezaimplementowane: zakresy napisów nie są cieniowane.",

  downloadsGroup: "Pobieranie i aktualizacje",
  autoUpdateOn: "Włączono automatyczne sprawdzanie i pobieranie aktualizacji",
  autoUpdateOff: "Wyłączono automatyczne pobieranie aktualizacji",
  downloaderWeb: "Przeglądarka nie sprawdza narzędzi pobierania na komputerze; sprawdź w aplikacji komputerowej BaoCut.",

  sourcesGroup: "Źródła pobierania i offline",
  strictOffline: "Ścisły offline",
  strictOfflineDesc: "Po włączeniu modele, narzędzia zewnętrzne i wideo z linków nie są pobierane. Dostęp online modeli w chmurze i silników agentów bez zmian.",
  strictOfflineOn: "Włączono ścisły tryb offline",
  strictOfflineOff: "Wyłączono ścisły tryb offline",

  trashDays: "Dni przechowywania w koszu",
  trashDaysDesc: (fallback: number | null) => `Wpisy bez odwołań w koszu dłużej niż ten okres i usunięte wideo są usuwane trwale (kontrola przy starcie i co 6 godzin). Wpisy z odwołaniami zostają zachowane. Wyczyść dla wartości domyślnej${fallback ? ` z ${fallback} dni` : ""}.`,
  webNote: "W przeglądarce nie można zmienić tego ustawienia. Zmień je w aplikacji BaoCut na komputer.",
  webViewOnly: "W przeglądarce można to tylko przeglądać. Zmiany wprowadź w aplikacji BaoCut na komputer.",
  webUnavailable: "To nie jest dostępne w przeglądarce. Użyj aplikacji BaoCut na komputer.",
};
