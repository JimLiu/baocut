import type { ExportSettingsMessages } from './export-settings.ts';

export const de: ExportSettingsMessages = {
  quality: { small: "Kleinere Datei", standard: "Standard", high: "Hohe Qualität" } as Record<'small' | 'standard' | 'high', string>,
  qualityNote: {
    small: "Stärkere Kompression, etwas weniger Details, kleinere Datei",
    standard: "Standardqualität und -größe",
    high: "Mehr Details, größere Datei",
  } as Record<'small' | 'standard' | 'high', string>,
  loudnessOn: (lufs: string, truePeak: string) => `Gesamte Mischung normalisieren auf ${lufs} LUFS, True Peak höchstens ${truePeak} dBTP.`,
  loudnessOff: "Aus: Mischung wie im Video exportieren.",
  audioFormatNote: {
    wav: "Verlustfrei · größte Datei · für weitere Nachbearbeitung",
    mp3: "Universell · für Podcast-Plattformen, Autoradios und ältere Geräte",
    m4a: "AAC · bei gleicher Bitrate etwas klarer als MP3 · nativ auf Apple-Geräten",
  } as Record<'wav' | 'mp3' | 'm4a', string>,
  dubGroup: (language: string | null) => (language ? `${language} Vertonung` : "Diese Vertonungsgruppe"),
  mix: "Mischung exportieren",
  mixNote: "Wie aktuell in der Zeitleiste hörbar",
  originalOnly: "Nur Originalton",
  originalOnlyNote: "Entfernt alle Vertonungen und stellt den dadurch stummgeschalteten Originalton wieder her",
  dubOnly: (label: string) => `${label} allein`,
  dubOnlyNote: "Nur diese Vertonungsgruppe; ohne Originalton, Musik oder andere Vertonungen",
  mono: "Mono",
  stereo: "Stereo",
  subtitleFormatNote: {
    srt: "Universell: für fast alle Player und Plattformen",
    vtt: "Für Webplayer mit Positionshinweisen",
    ass: "Erhält Untertitelstil (Schrift, Kontur, Position); weniger Player unterstützen dies",
    json: "Wortweise Zeitstempel pro Eintrag für Skripte und Werkzeuge",
  } as Record<'srt' | 'vtt' | 'ass' | 'json', string>,
  transcription: "Transkript",
  plainText: "Klartext",
  transcriptFormatNote: {
    md: "Optionaler Metadatenkopf, Kapitel als Überschriften, Sprecher fett, Übersetzungen als Zitate · In Notizen oder Dokumente einfügen",
    txt: "Keine Formatierungszeichen · Kapitelüberschriften in eigener Zeile",
  } as Record<'md' | 'txt', string>,
};
