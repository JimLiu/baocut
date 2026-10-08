import type { JobsCaptionLayerMessages } from './caption-layer.ts';

export const nl: JobsCaptionLayerMessages = {

  label: "Ondertitellaag toevoegen",
  noSource: "Er is geen document om een ondertitellaag voor toe te voegen",
  videoClosed: "De video is gesloten, dus er is geen ondertitellaag toegevoegd. Open de video en probeer het opnieuw.",
  empty: "Het document heeft geen ondertitels om te tonen, dus er is geen ondertitellaag toegevoegd",
  notOnTimeline: "Geen clip op de tijdlijn gebruikt dit mediabestand, dus de ondertitels kunnen niet op het scherm verschijnen. Er is geen ondertitellaag toegevoegd.",
  noDocumentId: "De ondertitellaag is toegevoegd, maar de document-ID is niet geretourneerd",
  rejected: "De transactie voor het toevoegen van de ondertitellaag is geweigerd",
  documentGone: "Het document voor de ondertitellaag staat niet meer in de video",
  needsOutputStore: "Het lezen van de ondertitels van de Speech Worker vereist de uitvoeropslag",
  notSpeech: "Het document is geen transcript",
  speechUnreadable: "Kan de inhoud van het transcript niet lezen",
  translationUnreadable: "Kan de inhoud van de vertaling niet lezen",
  unaligned: (p: { count: number }) =>
    `${p.count} vertaaleenheden zijn niet uitgelijnd (alignment is null), dus hun timing kan niet worden bepaald`,
  noSourceSpeech: "Kan het transcript niet vinden waarvan deze vertaling is gemaakt",

  subtitlesName: "Ondertitels",

  translationName: "Vertaling",

  styleName: "Ondertitelstijl",
};
