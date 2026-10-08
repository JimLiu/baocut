import type { DataGrantsMessages } from './data-grants-copy.ts';

export const de: DataGrantsMessages = {
  title: "Berechtigungen zur Datenweitergabe",
  showEnded: (count: number) => `Beendete anzeigen (${count})`,
  lead: "Daten an Cloud-Anbieter benötigen eine Berechtigung: Standardmäßig bei Anbieteraktivierung erteilt, außerdem bei „Immer erlauben“ während einer Genehmigung. Nach Widerruf senden neue Aufrufe keine Daten; bereits gesendete Daten und angefallene Kosten lassen sich nicht zurücknehmen. Lokale Modelle benötigen keine Berechtigung.",
  loading: "Berechtigungen werden geladen…",
  disconnected: "Nicht mit Runtime verbunden",
  revoke: "Widerrufen",
  noActive: "Keine aktiven Berechtigungen",
  none: "Noch keine Berechtigungen",
  emptyDesc: "Berechtigungen erscheinen nach Aktivieren eines Cloud-Anbieters oder Auswahl von „Immer erlauben“ während einer Genehmigung.",
  revokeTitle: (name: string) => `Widerrufen: „${name}“?`,
  revokeFailed: (message: string) => `Widerrufen fehlgeschlagen: ${message}`,
  cancel: "Abbrechen",
};
