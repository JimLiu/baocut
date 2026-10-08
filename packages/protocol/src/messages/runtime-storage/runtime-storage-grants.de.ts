import type { RuntimeStorageGrantsMessages } from './runtime-storage-grants.ts';

export const de: RuntimeStorageGrantsMessages = {
  localNeedsNoGrant: "Lokale Berechnung benötigt keine Berechtigung",
  dataKindRequired: "Mindestens eine Datenart angeben",
  budgetCapRequired: "Eine Berechtigung mit Ausgabenlimit benötigt budgetCap",
  unknownCostNoCap: "Eine Berechtigung mit unbekannten Kosten darf kein Ausgabenlimit haben. Zum Festlegen eines Limits estimate-cap verwenden",
  expiryPassed: "Der Ablaufzeitpunkt liegt in der Vergangenheit",
  grantNotFound: "Keine solche Berechtigung",
  grantRevoked: "Die Berechtigung wurde widerrufen und kann nicht geändert werden. Eine neue erteilen",
  cannotRemoveCap: "Eine Berechtigung mit Ausgabenlimit darf das Limit nicht entfernen. Widerrufen und eine neue Berechtigung mit unbekannten Kosten erteilen",
  unknownCostCannotCap: "Eine Berechtigung mit unbekannten Kosten darf kein Ausgabenlimit festlegen. Widerrufen und eine neue estimate-cap-Berechtigung erteilen",
  cannotChangeCurrency: "Die Währung kann nicht geändert werden",
  expiryPassedRevoke: "Der Ablaufzeitpunkt liegt in der Vergangenheit. Zum sofortigen Stoppen widerrufen",
  revokeNote:
    "Nach Widerruf werden keine neuen Aufrufe ausgeführt und eingereihte Aufrufe beim Start abgelehnt. Bereits an den Anbieter gesendete Daten und angefallene Kosten lassen sich lokal nicht rückgängig machen; laufende Aufrufe werden normal abgeschlossen und zählen zur Nutzung.",
  taskCallLimit: "Das Aufruflimit des Aufgabenbudgets muss eine positive ganze Zahl sein",
  providerGrantPurpose: (p: { label: string }) => `Standardmäßig erteilt beim Aktivieren von ${p.label}`,
  invalidCurrency: (p: { currency: string }) => `Die Währung muss aus drei Großbuchstaben bestehen (ISO 4217): ${p.currency}`,
};
