import type { JobsCaptionLayerMessages } from './caption-layer.ts';

export const de: JobsCaptionLayerMessages = {

  label: "Untertitel-Ebene hinzufügen",
  noSource: "Es gibt kein Dokument, für das eine Untertitel-Ebene hinzugefügt werden kann",
  videoClosed: "Das Video wurde geschlossen; es wurde keine Untertitel-Ebene hinzugefügt. Video öffnen und erneut versuchen.",
  empty: "Das Dokument hat keine anzeigbaren Untertitel; es wurde keine Untertitel-Ebene hinzugefügt",
  notOnTimeline: "Kein Clip in der Zeitleiste verwendet dieses Material. Die Untertitel können daher nicht auf dem Bildschirm erscheinen. Es wurde keine Untertitel-Ebene hinzugefügt.",
  noDocumentId: "Die Untertitel-Ebene wurde hinzugefügt, aber ihre Dokument-ID wurde nicht zurückgegeben",
  rejected: "Die Transaktion zum Hinzufügen der Untertitel-Ebene wurde abgelehnt",
  documentGone: "Das Dokument der Untertitel-Ebene ist nicht mehr im Video vorhanden",
  needsOutputStore: "Zum Lesen der Untertitel des Speech Worker wird der Ergebnisspeicher benötigt",
  notSpeech: "Das Dokument ist kein Transkript",
  speechUnreadable: "Transkripttext konnte nicht gelesen werden",
  translationUnreadable: "Übersetzungstext konnte nicht gelesen werden",
  unaligned: (p: { count: number }) =>
    `${p.count} Übersetzungseinheiten sind nicht ausgerichtet (alignment ist null); ihr Timing kann daher nicht ermittelt werden`,
  noSourceSpeech: "Das Ausgangstranskript dieser Übersetzung wurde nicht gefunden",

  subtitlesName: "Untertitel",

  translationName: "Übersetzung",

  styleName: "Untertitelstil",
};
