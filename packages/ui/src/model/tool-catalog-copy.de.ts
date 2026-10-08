type Artifact = 'audio' | 'image' | 'doc' | 'final' | 'subtitle';
const ARTIFACT_NOUN: Record<Artifact, string> = { audio: 'Audio', image: 'Bild', doc: 'Dokument', final: 'Videodatei', subtitle: 'Untertitel' };
import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

export const de: ToolCatalogMessages = {
  inputLabels: {
    file: "Lokale Datei",
    space: "Space",
    link: "Link",
    text: "Text",
    video: "Video in Space",
    document: "Dokument",
  },
  outputLabels: { video: "Video", artifact: "Eintrag in Space" },
  artifactLabels: { audio: "Audio", image: "Bild", doc: "Dokument", final: "Videodatei", subtitle: "Untertitel" },
  tools: {
    transcribe: {
      name: "Transkribieren",
      desc: "Eine Video- oder Audiodatei in ein Transkript und Untertitel umwandeln; bei einem bearbeitbaren Video werden sie hineingeschrieben und eine Untertitel-Ebene hinzugefügt",
    },
    'translate-subtitles': {
      name: "Untertitel übersetzen",
      desc: "Untertitel in eine andere Sprache übersetzen; bei einem transkribierten Video werden eine Übersetzung und eine Untertitel-Ebene für beide Sprachen hinzugefügt. Das Original bleibt unverändert",
    },
    dub: {
      name: "Übersetzte Vertonung",
      desc: "Ein transkribiertes Video anhand seiner Übersetzung neu vertonen; der Originalton kann abgesenkt, stummgeschaltet oder beibehalten werden",
    },
    'synthesize-speech': {
      name: "Sprache erzeugen",
      desc: "Text oder Dokumente und Untertitel in Space vorlesen; mit einer voreingestellten Stimme, einer geklonten Aufnahme oder einer beschriebenen Stimme",
    },
    'generate-text': {
      name: "Text erzeugen",
      desc: "Den Bedarf beschreiben und ein Textmodell direkt für Texte, Skripte oder Zusammenfassungen aufrufen; Dokumente oder Untertitel in Space können als Material angehängt werden",
    },
    'generate-image': {
      name: "Bild erzeugen",
      desc: "Ein Bild beschreiben und mit einem Cloud- oder lokalen Bildmodell zeichnen lassen; Referenzbilder, Seitenverhältnis und Anzahl sind optional",
    },
    'link-import': {
      name: "Video herunterladen",
      desc: "Einen Link einfügen, um ein Video auf diesen Computer herunterzuladen; Browser-Cookies können verwendet und der Download in ein Transkript und Untertitel transkribiert werden",
    },
    'compress-video': {
      name: "Video komprimieren",
      desc: "Für eine Zielgröße oder Qualität neu codieren; vor dem Versenden oder Hochladen verkleinern",
    },
    'merge-video': {
      name: "Videos zusammenführen",
      desc: "Mehrere Videos in der gewünschten Reihenfolge zu einer Datei zusammenfügen",
    },
    'extract-audio': {
      name: "Audio extrahieren",
      desc: "Das Bild entfernen und nur die Audiospur behalten; gängige Audiocodecs werden unverändert ohne Neucodierung kopiert",
    },
  },
  targetNone: "Nur Transkript und Untertitel erstellen",
  targetCreate: "Video in einem Projekt erstellen",
  subtitleFile: "Lokale Untertiteldatei",
  groups: {
    speech: {
      label: "Sprache & Untertitel",
      desc: "Transkribieren, Untertitel übersetzen, Vertonungen hinzufügen und Text vorlesen. Ergebnisse sind Dokument-, Untertitel- und Audioeinträge; bei Auswahl eines bearbeitbaren Videos in Space wird hineingeschrieben.",
    },
    'text-image': { label: "Text & Bilder", desc: "Text- und Bildmodelle direkt aufrufen. Ergebnisse sind Dokument- und Bildeinträge." },
    'video-file': {
      label: "Videodateien",
      desc: "Videos mit yt-dlp und ffmpeg auf diesem Computer herunterladen, komprimieren und zusammenführen sowie Audio extrahieren. Ergebnisse sind Videodatei- und Audioeinträge.",
    },
  },

  artifactItems: (artifacts: readonly Artifact[]) => (artifacts.length ? `${artifacts.map((a) => ARTIFACT_NOUN[a]).join(" und ")} Einträge` : "Ergebniseinträge"),
  resultWritesVideo: "Ergebnis: in das ausgewählte Video geschrieben",
  resultInSpace: (items: string) => `Ergebnis: ${items} in Space`,
  resultAlsoCreate: "kann auch ein neues Video erstellen",
  resultWritesEditable: "schreibt bei Auswahl eines bearbeitbaren Videos hinein",
  joinResult: (parts: readonly string[]) => parts.join("; "),
};
