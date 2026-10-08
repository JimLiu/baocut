import { pluralForm } from '@baocut/protocol';
import type { AudioGenMessages, GeneratedMarkMessages, ImageGenMessages } from './media-gen-copy.ts';

export const deMark: GeneratedMarkMessages = { generated: "Erzeugt" };

export const deAudioGen: AudioGenMessages = {
  generate: "Sprache erzeugen",
  clone: "Stimme klonen",
  generateTip: "Text mit einem Cloud-Modell vorlesen und zur Materialbibliothek hinzufügen",
  cloneTip: "Text mit einer unter Meine Stimmen geklonten Stimme vorlesen",
  back: "Zurück zu Audio",
  running: "Läuft im Hintergrund",
  textPlaceholder: "Zu synthetisierender Text; an Punkten oder Zeilenumbrüchen in Abschnitte aufteilen…",
  clonePlaceholder: "Was diese Stimme sagen soll…",
  cta: "Erzeugen",
  cloneCta: "Mit dieser Stimme erzeugen",
  hint: (provider: string) =>
    `Online gesendet an ${provider} zur Synthese; Abrechnung nach dessen Regeln. Fortschritt erscheint in der oberen Leiste und unter Hintergrundaufgaben; nach Abschluss wird das Ergebnis zur Materialbibliothek hinzugefügt. Das Platzieren in der Zeitleiste ist ein eigener Schritt. Das Beenden des Wartens ruft keine bereits gesendete Anfrage zurück.`,
  readOnly: "Dieses Video ist derzeit schreibgeschützt; Material kann nicht darin erzeugt werden",
  noVoicesTitle: "Noch keine Stimmen unter Meine Stimmen",
  noVoicesBody:
    "Zum Klonen zuerst unter Modelle › Sprachsynthese › Meine Stimmen aufnehmen oder aus einer Datei importieren, dann zu einem Anbieter mit Stimmklonen (ElevenLabs) hochladen. Anschließend zurückkehren und eine der Stimmen unten auswählen.",
  goVoices: "Meine Stimmen öffnen",
  runTitle: (title: string) => `${title}…`,
  runNote: "Weiterbearbeiten möglich · Synthese läuft im Hintergrund; nach Abschluss wird das Ergebnis zur Materialbibliothek hinzugefügt.",
  cancel: "Abbrechen",
  cancelled: "Abgebrochen",
  done: (meta: string) => `Erzeugt · ${meta}`,
  inLibrary: (name: string) => `Zur Materialbibliothek hinzugefügt · ${name}`,
  importing: "Wird zur Materialbibliothek hinzugefügt…",
  add: "Zur Timeline hinzufügen",
  addTip: "Am Abspielkopf platzieren",
  again: "Noch eins generieren",
  backToAudio: "Zurück zu Audio",
  doneNote: "Das Material liegt in der Audio-Bibliothek, markiert als „Erzeugt“. In die Zeitleiste ziehen oder mit „+“ platzieren; beliebig oft verwendbar.",
  failed: (message: string) => `Erzeugen fehlgeschlagen · ${message}`,
  edit: "Bearbeiten und erneut erzeugen",
  retried: "Erneut eingereicht",
};

export const deImageGen: ImageGenMessages = {
  title: "Bilder",
  segments: "Bildquelle",
  project: "Videomaterialien",
  gen: "KI-generiert",
  noModelTitle: "Noch kein Bildmodell",
  noModelBody:
    "Einen Cloud-Anbieter verbinden (Modelle › Bilderzeugung › Cloud-Modelle) oder Qwen-Image-2.1 herunterladen (Modelle › Bilderzeugung › Lokale Modelle) – beides funktioniert.",
  connect: "Cloud-Anbieter verbinden",
  downloadLocal: "Lokales Modell herunterladen",
  fit: "Wie die Video-Arbeitsfläche",
  recent: "Zuletzt",
  all: (n: number) => `Alle ${n} ${pluralForm('de', n, { one: "Paket", other: "Pakete" })}`,
  fewer: "Nur die letzten 3 Pakete",
  empty: "Für dieses Video wurden noch keine Bilder erzeugt. Erzeugte Bilder landen direkt in der Materialbibliothek (markiert als „Erzeugt“); das Platzieren auf der Arbeitsfläche ist ein eigener Schritt.",
  place: "Auf Arbeitsfläche platzieren",
  placeTip: "Am Abspielkopf platzieren",
  inLibrary: "In der Materialbibliothek",
  importing: "Wird zur Materialbibliothek hinzugefügt…",
  useAsRef: "Als Referenz verwenden",
  foot: "Erzeugte Bilder landen direkt in der Materialbibliothek dieses Videos; ihre Herkunft (Modell, Parameter, Aufgabe) wird beim Material gespeichert. Der Prompt bleibt nur im Aufgabenprotokoll. Das Platzieren auf der Arbeitsfläche ist ein eigener Schritt.",
  readOnly: "Dieses Video ist derzeit schreibgeschützt; Material kann nicht darin erzeugt werden",
  charCount: (chars: number, max: number) => `${chars} / ${max} Zeichen`,
  charCountPlain: (chars: number) => `${chars} ${pluralForm('de', chars, { one: "Zeichen", other: "Zeichen" })}`,
};
