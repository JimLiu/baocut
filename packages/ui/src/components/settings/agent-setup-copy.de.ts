import { pluralForm } from '@baocut/protocol';
import type { AgentSetupMessages } from './agent-setup-copy.ts';

export const de: AgentSetupMessages = {
  badge: {
    'not-installed': "Nicht installiert",
    error: "Nicht ausführbar",
    outdated: "Veraltet",
    'signed-out': "Anmeldung erforderlich",
    disabled: "Deaktiviert",
  },
  badgeNotChecked: "Noch nicht geprüft",
  badgeReady: "Verfügbar",
  badgeModelUpgrade: "Verfügbar · Standardmodell benötigt Aktualisierung",
  badgeModelUnavailable: "Verfügbar · Standardmodell nicht verfügbar",
  badgeUpdate: "Verfügbar · Aktualisierung verfügbar",

  errorTitle: (name: string) => `Gefunden: ${name}, aber nicht ausführbar`,
  errorBody: (detail: string | null) =>
    `${detail ? `${detail} ` : ""}Meist nach Deinstallation oder Aktualisierung von Node.js oder geänderten Dateiberechtigungen. Prüfungen zeigen den fehlgeschlagenen Schritt.`,
  errorCta: "Prüfungen ausführen",
  outdatedTitle: (name: string, version: string | null) =>
    version ? `${name} ${version} ist für BaoCut zu alt` : `Diese Version von ${name} ist für BaoCut zu alt`,
  outdatedBody: (detail: string | null, minVersion: string) =>
    `${detail ? `${detail} ` : `Benötigt ${minVersion} oder neuer. `}Aktualisieren betrifft nur dieses CLI-Werkzeug; Konto und dessen Einstellungen bleiben unverändert.`,
  outdatedCta: (version: string) => `Aktualisieren auf ${version}`,
  signedOutTitle: (name: string) => `${name} benötigt erneute Anmeldung`,
  signedOutBody: (name: string) =>
    `Anmeldung erfolgt im eigenen Fenster von ${name}; BaoCut verarbeitet weder Konto noch Passwort. Nach Anmeldung hier erneut prüfen.`,
  signedOutCta: "Terminal zum Anmelden öffnen",

  stepSkipped: "Wird nach erfolgreichem vorherigen Schritt geprüft",
  stepFind: "Auf diesem Computer gefunden",
  stepFindFail: (command: string) => `${command} ist weder in üblichen Installationsorten noch in PATH`,
  stepRun: "Startet",
  stepRunOk: (command: string, version: string) => `${command} --version gab zurück: ${version}`,
  stepRunFail: "Start fehlgeschlagen",
  stepVersion: "Von BaoCut unterstützte Version",
  stepVersionOk: (version: string, min: string) => `${version}, mindestens ${min}`,
  stepVersionFail: (version: string, min: string) => `Aktuell ${version}, mindestens ${min}`,
  stepLogin: "Bei Ihrem Konto angemeldet",
  stepLoginOk: "Angemeldet",
  stepLoginFail: "Meldet fehlende oder abgelaufene Anmeldung",
  stepModels: "Modellliste verfügbar",
  stepModelsOk: (n: number) => (pluralForm('de', n, { one: "1 Modell", other: `${n} Modelle` })),
  stepModelsNone: "Keine Modellliste gemeldet; Sitzungen verwenden das Agent-Standardmodell",
  verdictFail: (label: string, detail: string) => `Fehler bei „${label}“: ${detail}`,
  verdictOk: "Alle fünf Prüfungen bestanden. Eine Sitzung kann gestartet werden.",

  moreSummary: (names: string[], more: boolean) => names.join(", ") + (more ? " und weitere" : ""),

  readyTitle: "Startklar",
  readyBody: (name: string, model: string, plan: string) =>
    `Neue Sitzungen verwenden ${name} · ${model}. Ausführung über vorhandene Version von ${name} auf diesem Computer mit Ihrem ${plan}; BaoCut berechnet nichts zusätzlich.`,
  readyCta: "Sitzung starten",
  attentionBody: (name: string) =>
    `Bereits auf diesem Computer installiert; keine Neuinstallation nötig. Ursache und Lösung stehen im Abschnitt „${name}“ unten.`,
  attentionCta: "Problem ansehen",
  offTitle: (name: string) => `${name} ist installiert, aber deaktiviert`,
  offBody: "Aktivieren, um Arbeit mit einem Satz aus BaoCut zu übergeben.",
  offCta: (name: string) => `Aktivieren: ${name}`,
  missingTitle: "Noch kein Agent auf diesem Computer erkannt",
  missingBodyMany: "Einen der folgenden Agenten installieren und mit einem vorhandenen Konto anmelden. Nicht alle sind nötig.",
  missingBodyOne: "Nach den folgenden Schritten installieren und mit vorhandenem Konto anmelden.",

  logDropped: (n: number) => `… (${n} frühere ${pluralForm('de', n, { one: "Zeile", other: "Zeilen" })} ausgelassen)`,
  doneNotDetected: (name: string) => `Der Befehl ist abgeschlossen, aber ${name} wird noch nicht erkannt. Bei anderem Installationsort diesen manuell festlegen.`,
  doneSignIn: (name: string, version: string) => `Erkannt: ${name} ${version} · einmal anmelden zum Abschließen`,
  doneInstalled: (name: string, version: string) => `Erkannt: ${name} ${version}`,
  doneUpgraded: (name: string, version: string) => `${name} ist jetzt ${version} · Modellliste wird neu abgerufen`,

  tier: {
    balanced: { label: "Empfohlen", description: "Ausreichend für Transkription, Übersetzung und Bearbeitung; schnell und sparsamer mit Ihrem Abonnementkontingent" },
    max: { label: "Leistungsfähigstes", description: "Langsamer und verbraucht mehr Abonnementkontingent; selten nötig" },
    fast: { label: "Schnellstes", description: "Für kleine Bearbeitungen wie Änderungen einiger Untertitel" },
  },
  agentDefaultModel: "Agent-Standardmodell",
  cliConfigGate: (model: string) => `Folgt CLI-Einstellungen · ${model} benötigt eine CLI-Aktualisierung`,
  cliConfigModel: (model: string) => `Folgt CLI-Einstellungen · ${model}`,
  cliConfig: "Folgt CLI-Einstellungen",
  modelMissing: "Nicht in aktueller Modellliste; neue Sitzungen verwenden das empfohlene Modell",
  effort: {
    minimal: "Minimal",
    low: "Niedrig",
    medium: "Mittel",
    high: "Hoch",
    xhigh: "Sehr hoch",
    max: "Maximal",
  } as Record<string, string>,
  modelDefaultEffort: "Modellstandard",
  modelDefaultEffortOf: (label: string) => `Modellstandard (${label})`,

  rulesTitle: (n: number) => `Immer erlaubte Befehle · ${n}`,
  rulesBody:
    "Diese Regeln entstehen durch „Immer erlauben“ in Sitzungen. Nach Entfernen genehmigt eine Regel nicht mehr automatisch; Zugriffsmodi und andere Regeln gelten weiterhin.",
  rulesEmpty: "Noch keine gespeicherten Regeln. Auf einer Genehmigungskarte „Immer erlauben“ wählen; die Regel erscheint hier.",
};
