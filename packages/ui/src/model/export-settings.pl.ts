import type { ExportSettingsMessages } from './export-settings.ts';

export const pl: ExportSettingsMessages = {
  quality: { small: "Mniejszy plik", standard: "Standardowy", high: "Wysoka jakość" },
  qualityNote: {
    small: "Większa kompresja, nieco mniej szczegółów, mniejszy plik",
    standard: "Domyślna jakość i rozmiar",
    high: "Więcej szczegółów, większy plik",
  },
  loudnessOn: (lufs: string, truePeak: string) => `Znormalizuj cały miks do ${lufs} LUFS, ze szczytem rzeczywistym nie wyższym niż ${truePeak} dBTP.`,
  loudnessOff: "Wyłączone: eksportuj miks tak jak w wideo.",
  audioFormatNote: {
    wav: "Bezstratny · Największy plik · Do dalszej postprodukcji",
    mp3: "Uniwersalny · Działa na platformach podcastów, w radiach samochodowych i starszych urządzeniach",
    m4a: "AAC · Nieco wyraźniejszy niż MP3 przy tym samym bitrate · Natywny dla urządzeń Apple",
  },
  dubGroup: (language: string | null) => (language ? `${language} – dubbing` : "Ta grupa dubbingu"),
  mix: "Miks eksportu",
  mixNote: "Tak jak obecnie na osi czasu",
  originalOnly: "Tylko oryginalne audio",
  originalOnlyNote: "Usuwa cały dubbing i przywraca wyciszone przez niego oryginalne audio",
  dubOnly: (label: string) => `${label} – tylko`,
  dubOnlyNote: "Zachowuje tylko tę grupę dubbingu, bez oryginalnego audio, muzyki i innego dubbingu",
  mono: "Mono",
  stereo: "Stereo",
  subtitleFormatNote: {
    srt: "Uniwersalny: działa z niemal każdym odtwarzaczem i platformą",
    vtt: "Dla odtwarzaczy internetowych, ze wskazówkami pozycji",
    ass: "Zachowuje styl napisów (czcionkę, obrys, pozycję); mniej odtwarzaczy go obsługuje",
    json: "Znaczniki czasu każdego słowa we wpisie dla skryptów i narzędzi",
  },
  transcription: "Transkrypcja",
  plainText: "Zwykły tekst",
  transcriptFormatNote: {
    md: "Opcjonalne metadane, rozdziały jako nagłówki, mówcy pogrubieni, tłumaczenia jako cytaty · Wklej do notatek lub dokumentów",
    txt: "Bez znaczników formatowania · Nagłówki rozdziałów w osobnej linii",
  },
};
