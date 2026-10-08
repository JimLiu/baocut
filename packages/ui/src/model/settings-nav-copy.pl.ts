import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const pl: SettingsNavMessages = {
  category: {
    asr: { label: "Rozpoznawanie mowy", description: "Przekształcanie mowy w transkrypcje i napisy oraz rozróżnianie mówców." },
    tts: { label: "Synteza mowy", description: "Generowanie mowy, klonowanie głosów i tworzenie dubbingu do wideo." },
    llm: { label: "Generowanie tekstu", description: "Poprawianie transkrypcji, tłumaczenie napisów i generowanie tekstu." },
    image: { label: "Generowanie obrazów", description: "Generowanie obrazów i okładek do wideo." },
    sep: { label: "Separacja źródeł", description: "Oddzielanie głosu, akompaniamentu i dźwięku tła." },
    vision: { label: "Rozumienie obrazu", description: "Rozpoznawanie osób, mówców i zawartości ekranu dla inteligentnego kadrowania." },
  },
  page: { local: "Modele lokalne", cloud: "Modele w chmurze", voices: "Moje głosy" },
  onlyPage: {
    local: "Ta kategoria ma tylko modele lokalne działające na tym komputerze; nie ma jeszcze modeli w chmurze.",
    cloud: "Generowanie tekstu ma tylko modele w chmurze. Agentów kodujących ustawia się w sekcji „Agent”.",
  },
  section: {
    general: "Ogólne",
    shortcuts: "Skróty",
    fonts: "Czcionki",
    agent: "Dostawcy agentów",
    skills: "Skills",
    glossary: "Słownik",
    privacy: "Prywatność i uprawnienia",
    diagnostics: "Diagnostyka",
    about: "O programie",
  },
  group: { preferences: "Preferencje", agents: "Agent", app: "Aplikacja" },
};
