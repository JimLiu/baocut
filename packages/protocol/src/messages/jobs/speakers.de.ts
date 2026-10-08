import type { JobsSpeakersMessages } from './speakers.ts';

export const de: JobsSpeakersMessages = {

  label: "Sprecher erkennen",
  description:
    "Unterscheidet Sprecher in einem vorhandenen Transkript des Videos anhand der Stimme (lokales Modell, keine erneute Transkription). Das Ergebnis ist ein Vorschlag; nach Bestätigung mit edits.applySpeakers anwenden.",
  stepDiarize: "Sprecher unterscheiden",
  stepPropose: "Ergebnisse ordnen",
  videoNotOpen: "Das Video ist nicht geöffnet",
  notFromAsset: "Dieses Transkript gehört zu keinem Material im Video; Sprecher können daher nicht anhand der Stimme unterschieden werden",
  modelMissing: "Dieser Computer hat kein Modell zur Sprechertrennung",
  modelNotInstalled: "Das Modell zur Sprechertrennung ist noch nicht installiert. Zuerst herunterladen.",
  transcriptUnreadable: "Transkript konnte nicht gelesen werden",
  videoClosed: "Das Video wurde geschlossen",
  transcriptGone: "Das Transkript ist nicht mehr im Video vorhanden",
  noWords: "Das Transkript enthält keine Wörter",
  untimedWords: "Das Transkript enthält Wörter ohne Timing; Sprecher können daher nicht anhand der Stimme unterschieden werden",
  sourceMissing: "Quelldatei des Materials nicht gefunden",
  hashMismatch: "Der Hash von speakers.json stimmt nicht mit dem vom Worker gemeldeten Wert überein",
  wordCountMismatch: "speakers.json enthält nicht dieselbe Wortanzahl wie das Transkript",
  transcriptChanged: "Das Transkript wurde nach der Sprechererkennung geändert. Sprecher erneut erkennen.",
  translationChanged: "Eine Übersetzung wurde nach der Sprechererkennung geändert. Sprecher erneut erkennen.",
  unknownSpeaker: "Dieser Sprecher ist nicht im Vorschlag enthalten",
  nameInvalid: (p: { max: number }) => `Sprechernamen dürfen nicht leer sein und dürfen höchstens enthalten: ${p.max} Zeichen`,
  applyFailed: "Vorschlag konnte nicht angewendet werden",
};
