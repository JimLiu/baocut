import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const pl: SettingsNavMessages = {
  category: {
    asr: { label: "Rozpoznawanie mowy", description: "Przekształcanie mowy w transkrypcje i napisy oraz rozróżnianie mówców." },
    tts: { label: "Synteza mowy", description: "Generowanie mowy, klonowanie głosów i tworzenie dubbingu do wideo." },
    llm: { label: "Generowanie tekstu", description: "Poprawianie transkrypcji, tłumaczenie napisów i generowanie tekstu." },
    image: { label: "Generowanie obrazów", description: "Generowanie obrazów i okładek do wideo." },
    sep: { label: "Separacja źródeł", description: "Oddzielanie głosu, akompaniamentu i dźwięku tła." },
    music: { label: 'Generowanie muzyki', description: 'Generuj piosenki i muzykę w tle do swoich filmów na tym komputerze.' },
    vision: { label: "Rozumienie obrazu", description: "Rozpoznawanie osób, mówców i zawartości ekranu dla inteligentnego kadrowania." },
  },
  page: { models: "Modele", voices: "Moje głosy" },
  onlyPage: {
    local: "Ta kategoria ma tylko modele lokalne działające na tym komputerze; żaden dostawca API jeszcze jej nie oferuje.",
    cloud: "Generowanie tekstu korzysta tylko z modeli dostawców API. Agentów kodujących ustawia się w sekcji „Agent”.",
  },
  section: {
    general: "Ogólne",
    shortcuts: "Skróty",
    fonts: "Czcionki",
    downloader: 'Pobieranie filmów',
    semantic: 'Indeks semantyczny',
    agent: "Dostawcy agentów",
    providers: "Dostawcy API",
    usage: "Użycie",
    glossary: "Słownik",
    privacy: "Prywatność i uprawnienia",
    diagnostics: "Diagnostyka",
    about: "O programie",
  },
  group: { preferences: "Preferencje", agents: "Agent", app: "Aplikacja" },
};
