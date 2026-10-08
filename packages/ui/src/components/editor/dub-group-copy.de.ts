import { pluralForm } from '@baocut/protocol';
import type { DubGroupMessages } from './dub-group-copy.ts';

export const de: DubGroupMessages = {
  track: "Diese Spur in der Zeitleiste anzeigen",
  trackGone: "Diese Vertonungsgruppe ist nicht mehr in der Zeitleiste",
  regen: (n: number) => `Erneut erzeugen: ${n} ${pluralForm('de', n, { one: "Satz", other: "Sätze" })}…`,
  regenNote: "Nicht synthetisierte oder nicht passende Sätze · prüfen, bei Bedarf die Übersetzung bearbeiten und nur diese wiederholen",
  download: "Gruppe herunterladen",
  downloadNote: "Ganze Gruppen können noch nicht heruntergeladen werden; für die Mischung dieser Gruppe beim Audioexport „Nur diese Vertonungsgruppe“ wählen",
  redub: "Diese Sprache wiederholen",
  redubNote: "Öffnet Übersetzte Vertonung",
  remove: "Diese Vertonungsgruppe entfernen",
  removeNote: "Entfernt die Clips dieser Gruppe aus der Zeitleiste und stellt den Originalton wieder her; rückgängig zu machen. Leere Vertonungsspur und Plan bleiben erhalten",
  removeLoading: "Vertonungsplan wird geladen…",
  readOnly: "Das Video ist schreibgeschützt",
  removed: (title: string) => `Entfernt: „${title}“`,
  rowOnTimeline: (label: string) => `Zeile „${label}“ in der Zeitleiste`,
  undo: "Rückgängig machen",
  stateOn: "In Zeitleiste",
  stateOff: "Spur aus",
  stateGone: "Nicht in Zeitleiste",
  groupMenu: "Diese Vertonungsgruppe",
  actionsOf: (title: string) => `Aktionen für „${title}“`,
  clickToSelect: (text: string) => `${text} · klicken, um sie in der Zeitleiste auszuwählen`,
};
