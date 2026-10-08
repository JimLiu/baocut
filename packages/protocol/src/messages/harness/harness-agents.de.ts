import type { HarnessAgentsMessages } from './harness-agents.ts';

export const de: HarnessAgentsMessages = {
  listSeparator: ", ",
  noDriver: (p: { id: string }) => `Kein Agent mit dieser ID registriert: ${p.id}`,
  probeFailed: (p: { error: string }) => `Erkennung fehlgeschlagen: ${p.error}`,
  cannotChangeAgent: "Diese Sitzung wurde bereits gestartet. Ihr Agent kann daher nicht geändert werden. Für einen anderen Agenten eine neue Sitzung starten.",
  noBudgetLedger: "Diese Runtime hat kein Aufgabenbudget-Verzeichnis; Budgets können daher nicht festgelegt werden",
  driverGone: (p: { id: string }) =>
    `Agent ${p.id} wurde entfernt oder ist nicht registriert. In dieser Sitzung kann nicht mehr gesendet werden. Eine neue Sitzung mit einem anderen Agenten starten.`,
  driverUnverified: (p: { agent: string }) =>
    `${p.agent} hat die Integrationstests von BaoCut noch nicht bestanden. Nur Erkennungsergebnisse werden angezeigt; Sitzungen können nicht gestartet werden.`,
  fullAccessOnly: (p: { agent: string; fullAccess: string; current: string }) =>
    `${p.agent} kann nicht schrittweise um Genehmigung bitten und läuft daher nur im Modus „${p.fullAccess}“ (derzeit „${p.current}“). Wechseln zu „${p.fullAccess}“ und erneut senden oder einen anderen Agenten verwenden.`,
  runtimeStopping: "Die Runtime wird gestoppt",
  sessionBusy: "In dieser Sitzung läuft noch eine Aufgabe. Stoppen oder auf den Abschluss warten.",
  sessionBusyOther: "Diese Sitzung führt eine andere Aufgabe aus. Stoppen oder auf den Abschluss warten.",
  oldTaskNotStopped: "Die alte Aufgabe wurde noch nicht gestoppt. Später erneut versuchen",
  attachmentsUnsupported: "Diese Version kann noch keine Bildanhänge senden",
  attachmentDuplicate: "Jeder Anhang darf pro Nachricht nur einmal enthalten sein",
  tooManyImages: (p: { max: number }) => `Eine Nachricht darf höchstens enthalten: ${p.max} Bilder`,
  imagesUnsupported: "Dieser Agent unterstützt keine Bilder",
  contractRevisionMissing: (p: { revision: number; latest: number }) =>
    `Der Aufgabenvertrag hat keine Revision ${p.revision} (neueste: ${p.latest})`,
  taskEnded: "Die Aufgabe ist beendet (oder wird gestoppt); ihr Vertrag kann nicht geändert werden. Zum Ändern des Ziels tasks.changeGoal verwenden",
  contractRevisionStale: (p: { latest: number; expected: number }) =>
    `Der Vertrag ist bereits bei Revision ${p.latest}, nicht ${p.expected}. Vor Änderungen erneut lesen`,
  checkMissing: (p: { id: string }) => `Der Aufgabenvertrag hat keine solche Prüfung: ${p.id}`,
  taskNotFound: (p: { id: string }) => `Aufgabe nicht gefunden: ${p.id}`,
  approvalNotFound: (p: { id: string }) => `Genehmigung nicht gefunden: ${p.id}`,
  builtinId: (p: { id: string }) => `${p.id} ist eine integrierte Agenten-ID. Eine andere auswählen`,
  agentExists: (p: { id: string }) => `Ein Agent existiert bereits mit der ID ${p.id}`,
  builtinNotRemovable: (p: { agent: string }) => `${p.agent} ist integriert und kann nicht entfernt werden. In den Einstellungen kann er deaktiviert werden`,
  agentMissing: (p: { id: string }) => `Kein Agent hat die ID ${p.id}`,
  providersUnsupported: "Diese Runtime kann keine Agenten hinzufügen oder entfernen",
  modelMissing: (p: { agent: string; model: string; choices: string }) => `${p.agent} hat kein Modell „${p.model}“. Zur Auswahl stehen ${p.choices}`,
  effortMissing: (p: { model: string; effort: string; choices: string }) =>
    `Modell „${p.model}“ hat keinen Denkaufwand „${p.effort}“. Zur Auswahl stehen ${p.choices}`,
  effortUnsupported: (p: { model: string }) => `Modell „${p.model}“ hat keine Denkaufwandsstufen`,
  approvalNoGrant: "Diese Genehmigung sendet keine Daten nach außen und kann daher keine Berechtigungsauswahl enthalten",
  contractFieldsReadonly: (p: { fields: string }) =>
    `Der Agent kann diese Felder des Aufgabenvertrags nicht ändern: ${p.fields}. Nur der Benutzer entscheidet über Zugriffsmodus, Berechtigungsumfang, Budget und geschützte Bereiche`,
};
