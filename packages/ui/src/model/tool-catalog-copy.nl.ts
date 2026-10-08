type Artifact = 'audio' | 'image' | 'doc' | 'final' | 'subtitle';
const ARTIFACT_NOUN: Record<Artifact, string> = { audio: 'audio', image: 'afbeelding', doc: 'document', final: 'videobestand', subtitle: 'ondertitel' };
import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

export const nl: ToolCatalogMessages = {
  inputLabels: {
    file: "Lokaal bestand",
    space: "Space",
    link: "Link",
    text: "Tekst",
    video: "Video in Space",
    document: "Document",
  },
  outputLabels: { video: "Video", artifact: "Item in Space" },
  artifactLabels: { audio: "Audio", image: "Afbeelding", doc: "Document", final: "Videobestand", subtitle: "Ondertitels" },
  tools: {
    transcribe: {
      name: "Transcriberen",
      desc: "Een video- of audiobestand omzetten in een transcript en ondertitels; bij een bewerkbare video worden ze erin geschreven en wordt een ondertitellaag toegevoegd",
    },
    'translate-subtitles': {
      name: "Ondertitels vertalen",
      desc: "Ondertitels vertalen naar een andere taal; bij een getranscribeerde video worden een vertaling en een ondertitellaag die beide talen kan tonen toegevoegd, met behoud van het origineel",
    },
    dub: {
      name: "Vertaalde nasynchronisatie",
      desc: "Een getranscribeerde video een nieuwe nasynchronisatie geven vanuit de vertaling; de oorspronkelijke audio kan worden verlaagd, gedempt of behouden",
    },
    'synthesize-speech': {
      name: "Spraak genereren",
      desc: "Tekst, documenten of ondertitels in Space voorlezen; gebruik een vooringestelde stem, kloon een opname of beschrijf een stem",
    },
    'generate-text': {
      name: "Tekst genereren",
      desc: "Beschrijf wat je nodig hebt en roep rechtstreeks een tekstmodel aan voor teksten, scripts of samenvattingen; je kunt documenten of ondertitels in Space toevoegen als media",
    },
    'generate-image': {
      name: "Afbeelding genereren",
      desc: "Beschrijf een afbeelding en teken die met een cloudmodel of lokaal afbeeldingsmodel; referentieafbeeldingen, beeldverhouding en aantal zijn optioneel",
    },
    'link-import': {
      name: "Video downloaden",
      desc: "Plak een link om een video naar deze computer te downloaden; browsercookies kunnen worden gebruikt en de download kan worden getranscribeerd tot een transcript en ondertitels",
    },
    'compress-video': {
      name: "Video comprimeren",
      desc: "Opnieuw coderen naar een gewenste grootte of kwaliteit; verkleinen voor verzenden of uploaden",
    },
    'merge-video': {
      name: "Video’s samenvoegen",
      desc: "Meerdere video’s in volgorde achter elkaar samenvoegen tot één bestand",
    },
    'extract-audio': {
      name: "Audio extraheren",
      desc: "Het beeld verwijderen en alleen het audiospoor behouden; gangbare audiocodecs worden ongewijzigd gekopieerd, zonder opnieuw te coderen",
    },
  },
  targetNone: "Alleen een transcript en ondertitels maken",
  targetCreate: "Een video maken in een project",
  subtitleFile: "Lokaal ondertitelbestand",
  groups: {
    speech: {
      label: "Spraak & ondertitels",
      desc: "Transcriberen, ondertitels vertalen, nasynchronisatie toevoegen en tekst voorlezen. Resultaten zijn document-, ondertitel- en audio-items; als je een bewerkbare video in Space kiest, wordt erin geschreven.",
    },
    'text-image': { label: "Tekst & afbeeldingen", desc: "Tekst- en afbeeldingsmodellen rechtstreeks aanroepen. Resultaten zijn document- en afbeeldingsitems." },
    'video-file': {
      label: "Videobestanden",
      desc: "Video’s downloaden, comprimeren en samenvoegen en audio extraheren met yt-dlp en ffmpeg op deze computer. Resultaten zijn videobestand- en audio-items.",
    },
  },

  artifactItems: (artifacts: readonly Artifact[]) => (artifacts.length ? `${artifacts.map((a) => ARTIFACT_NOUN[a]).join(" en ")} items` : "uitvoeritems"),
  resultWritesVideo: "Resultaat: geschreven in de video die je kiest",
  resultInSpace: (items: string) => `Resultaat: ${items} in Space`,
  resultAlsoCreate: "kan ook een nieuwe video maken",
  resultWritesEditable: "schrijft in een bewerkbare video als je er een kiest",
  joinResult: (parts: readonly string[]) => parts.join("; "),
};
