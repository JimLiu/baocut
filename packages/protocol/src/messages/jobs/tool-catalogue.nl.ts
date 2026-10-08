import type { JobsToolCatalogueMessages } from './tool-catalogue.ts';

export const nl: JobsToolCatalogueMessages = {
  transcribeLabel: "Transcriberen",
  transcribeDescription:
    "Transcribeert een lokaal mediabestand of een video in Space. Bij een video wordt een nieuw transcript geschreven en een ondertitellaag gemaakt; bij alleen een bestand worden TXT en SRT naar de opslaglocatie geschreven, of kan een nieuwe video worden gemaakt.",
  translateSubtitlesLabel: "Ondertitels vertalen",
  translateSubtitlesDescription:
    "Vertaalt het transcript van een video zin voor zin naar een andere taal en schrijft het als nieuwe vertaling naar de video. Kan ook een SRT-/VTT-ondertitelbestand (lokaal bestand of ondertitelitem in Space) vertalen naar een nieuw ondertitelbestand.",
  dubLabel: "Vertaalde nasynchronisatie",
  dubDescription:
    "Synthetiseert spraak in de doeltaal zin voor zin vanuit het transcript (vertaalt eerst als er geen vertaling is), lijnt de timing uit en schrijft het naar de video als nieuwe nasynchronisatiegroep.",
  synthesizeSpeechLabel: "Spraak genereren",
  synthesizeSpeechDescription:
    "Synthetiseert spraak uit een tekst; het resultaat is audio-uitvoer. Kan ook een document of ondertitelitem in Space voorlezen (ondertitels zonder tijdcodes).",
  generateTextLabel: "Tekst genereren",
  generateTextDescription:
    "Genereert tekst vanuit een prompt (eventueel volgens een JSON Schema); het resultaat is tekstuitvoer. Documenten of ondertitelitems in Space kunnen als media worden toegevoegd.",
  generateImageLabel: "Afbeelding genereren",
  generateImageDescription: "Genereert een afbeelding vanuit een beschrijving; het resultaat is afbeeldingsuitvoer.",
  linkImportLabel: "Video downloaden",
  linkImportDescription:
    "Downloadt een video naar deze computer met yt-dlp. Browsercookies kunnen worden gebruikt en de download kan worden getranscribeerd tot een transcript en ondertitels.",
  compressVideoLabel: "Video comprimeren",
  compressVideoDescription:
    "Comprimeert videobestanden één voor één: bestand naar bestand, zonder een video te maken. De uitvoer overschrijft geen bestaande bestanden.",
  mergeVideoLabel: "Video’s samenvoegen",
  mergeVideoDescription:
    "Voegt meerdere videobestanden in volgorde samen tot één bestand: bestand naar bestand, zonder een video te maken. De uitvoer overschrijft geen bestaande bestanden.",
  extractAudioLabel: "Audio extraheren",
  extractAudioDescription:
    "Haalt het audiospoor uit een video- of audiobestand. Codecs die in een gangbare container passen worden ongewijzigd gekopieerd; andere worden opnieuw gecodeerd naar AAC. Bestand naar bestand, zonder een video te maken. De uitvoer overschrijft geen bestaande bestanden.",
};
