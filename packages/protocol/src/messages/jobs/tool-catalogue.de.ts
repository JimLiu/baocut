import type { JobsToolCatalogueMessages } from './tool-catalogue.ts';

export const de: JobsToolCatalogueMessages = {
  transcribeLabel: "Transkribieren",
  transcribeDescription:
    "Transkribiert eine lokale Mediendatei oder ein Video in Space. Bei einem Video wird ein neues Transkript geschrieben und eine Untertitel-Ebene erstellt; bei einer Datei werden TXT und SRT am Speicherort geschrieben oder ein neues Video erstellt.",
  translateSubtitlesLabel: "Untertitel übersetzen",
  translateSubtitlesDescription:
    "Übersetzt das Transkript eines Videos Satz für Satz in eine andere Sprache und schreibt es als neue Übersetzung ins Video. Kann auch eine SRT-/VTT-Untertiteldatei (lokale Datei oder Untertiteleintrag in Space) in eine neue Untertiteldatei übersetzen.",
  dubLabel: "Übersetzte Vertonung",
  dubDescription:
    "Synthetisiert anhand des Transkripts Satz für Satz Sprache in der Zielsprache (übersetzt zuerst, falls keine Übersetzung vorhanden ist), richtet das Timing aus und schreibt sie als neue Vertonungsgruppe ins Video.",
  synthesizeSpeechLabel: "Sprache erzeugen",
  synthesizeSpeechDescription:
    "Synthetisiert Sprache aus einem Text; das Ergebnis ist ein Audioergebnis. Kann auch ein Dokument oder einen Untertiteleintrag in Space vorlesen (Untertitel ohne Zeitcodes).",
  generateTextLabel: "Text erzeugen",
  generateTextDescription:
    "Erzeugt Text anhand eines Prompts (optional gemäß einem JSON Schema); das Ergebnis ist ein Textergebnis. Dokumente oder Untertiteleinträge in Space können als Material angehängt werden.",
  generateImageLabel: "Bild erzeugen",
  generateImageDescription: "Erzeugt ein Bild anhand einer Beschreibung; das Ergebnis ist ein Bildergebnis.",
  linkImportLabel: "Video herunterladen",
  linkImportDescription:
    "Lädt mit yt-dlp ein Video auf diesen Computer herunter. Browser-Cookies können verwendet und der Download in ein Transkript und Untertitel transkribiert werden.",
  compressVideoLabel: "Video komprimieren",
  compressVideoDescription:
    "Komprimiert Videodateien einzeln: Datei zu Datei, ohne ein Video zu erstellen. Ergebnisse überschreiben keine vorhandenen Dateien.",
  mergeVideoLabel: "Videos zusammenführen",
  mergeVideoDescription:
    "Führt mehrere Videodateien in der gewünschten Reihenfolge zusammen: Datei zu Datei, ohne ein Video zu erstellen. Ergebnisse überschreiben keine vorhandenen Dateien.",
  extractAudioLabel: "Audio extrahieren",
  extractAudioDescription:
    "Extrahiert die Audiospur einer Video- oder Audiodatei. Codecs für gängige Container werden unverändert kopiert; andere werden in AAC neu codiert. Datei zu Datei, ohne ein Video zu erstellen. Ergebnisse überschreiben keine vorhandenen Dateien.",
};
