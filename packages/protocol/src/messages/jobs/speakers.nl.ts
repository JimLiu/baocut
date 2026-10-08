import type { JobsSpeakersMessages } from './speakers.ts';

export const nl: JobsSpeakersMessages = {

  label: "Sprekers identificeren",
  description:
    "Onderscheidt sprekers in een bestaand transcript in de video op basis van hun stem (lokaal model, zonder opnieuw te transcriberen). Het resultaat is een voorstel; pas het na bevestiging toe met edits.applySpeakers.",
  stepDiarize: "Sprekers onderscheiden",
  stepPropose: "Resultaten ordenen",
  videoNotOpen: "De video is niet geopend",
  notFromAsset: "Dit transcript hoort niet bij media in de video, dus sprekers kunnen niet op basis van hun stem worden onderscheiden",
  modelMissing: "Deze computer heeft geen model voor het scheiden van sprekers",
  modelNotInstalled: "Het model voor het scheiden van sprekers is nog niet geïnstalleerd. Download het eerst.",
  transcriptUnreadable: "Kan het transcript niet lezen",
  videoClosed: "De video is gesloten",
  transcriptGone: "Het transcript staat niet meer in de video",
  noWords: "Het transcript bevat geen woorden",
  untimedWords: "Het transcript bevat woorden zonder timing, dus sprekers kunnen niet op basis van hun stem worden onderscheiden",
  sourceMissing: "Kan het bronbestand van de media niet vinden",
  hashMismatch: "De hash van speakers.json komt niet overeen met de waarde die de Worker heeft gemeld",
  wordCountMismatch: "speakers.json bevat niet hetzelfde aantal woorden als het transcript",
  transcriptChanged: "Het transcript is gewijzigd nadat de sprekers zijn geïdentificeerd. Identificeer de sprekers opnieuw.",
  translationChanged: "Een vertaling is gewijzigd nadat de sprekers zijn geïdentificeerd. Identificeer de sprekers opnieuw.",
  unknownSpeaker: "Deze spreker staat niet in het voorstel",
  nameInvalid: (p: { max: number }) => `Sprekernamen mogen niet leeg zijn en mogen maximaal bevatten: ${p.max} tekens`,
  applyFailed: "Kan het voorstel niet toepassen",
};
