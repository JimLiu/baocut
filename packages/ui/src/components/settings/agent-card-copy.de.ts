import { createElement, Fragment, type ReactNode } from 'react';
import type { AgentCardMessages } from './agent-card-copy.ts';

export const de: AgentCardMessages = {
  runFailed: (message: string) => `Ausführen fehlgeschlagen: ${message}`,
  stopFailed: (message: string) => `Stoppen fehlgeschlagen: ${message}`,

  loginCommand: "Anmeldebefehl",
  installCommand: "Installationsbefehl",
  upgradeCommand: "Aktualisierungsbefehl",
  linkLabel: "Link",
  terminalLogin: (command: string) => `Ausführen: ${command} im Terminal · nach Anmeldung hierher zurückkehren`,
  terminalRun: (command: string) => `Ausführen: ${command} im Terminal · nach Abschluss hierher zurückkehren`,
  terminalCopied: (label: string) => `Terminal konnte nicht geöffnet werden. Kopiert: ${label}; zum Ausführen in ein Terminal einfügen.`,
  terminalManual: (command: string) => `Terminal konnte nicht geöffnet werden. Im Terminal ausführen: ${command}.`,
  terminalFailed: (message: string) => `Terminal konnte nicht geöffnet werden: ${message}`,
  enableFailed: (message: string) => `Aktivieren fehlgeschlagen: ${message}`,
  disableFailed: (message: string) => `Deaktivieren fehlgeschlagen: ${message}`,
  recheckFailed: (message: string) => `Erneute Prüfung fehlgeschlagen: ${message}`,
  saveModelFailed: (message: string) => `Standardmodell konnte nicht gespeichert werden: ${message}`,
  saveEffortFailed: (message: string) => `Standard-Denkaufwand konnte nicht gespeichert werden: ${message}`,
  refreshFailed: (message: string) => `Modelle konnten nicht neu abgerufen werden: ${message}`,
  setDefaultFailed: (message: string) => `Festlegen als Standard fehlgeschlagen: ${message}`,
  openFailed: (message: string) => `Öffnen fehlgeschlagen: ${message}`,
  enabled: (name: string) => `Aktiviert: ${name}`,
  disabled: (name: string) => `Deaktiviert: ${name} · in neuen Sitzungen nicht mehr aufgeführt`,

  defaultBadge: "Standard",
  subInstalled: (version: string | null, account: string | null) =>
    ["Auf diesem Computer installiert", version ? `v${version}` : null, account].filter(Boolean).join(" · "),
  subMissing: (command: string, plan: string) => `${command} nicht auf diesem Computer gefunden · vorhandene Version von ${plan} reicht aus`,
  enable: (name: string) => `Aktivieren: ${name}`,
  details: "Details",
  install: "Installieren",
  checking: "Überprüfen…",
  gateTitle: (name: string, model: string) => `${name}: konfiguriertes Standardmodell ${model} benötigt eine neuere Version`,
  gateBody: (version: string, model: string) =>
    `Auf diesem Computer ist ${version}; die Modellliste dieser Version enthält nicht ${model}. Sitzungen mit „Agent-Standardmodell“ verwenden diese Konfiguration und werden beim Senden abgelehnt; Sitzungen mit bestimmtem Modell bleiben unverändert.`,
  gateUpgrade: "Aktualisieren betrifft nur dieses CLI-Werkzeug; Konto und dessen Einstellungen bleiben unverändert.",
  gateNoUpgrade: "Noch keine neuere Version zum Aktualisieren. Vorerst in der Sitzung ein Modell aus der Liste auswählen.",
  upgradeTo: (version: string) => `Aktualisieren auf ${version}`,
  updateStrip: (latest: string, current: string) => `Version ${latest} ist verfügbar (aktuell: ${current}). Ohne Aktualisierung weiterhin verwendbar.`,
  viewUpgrade: "Aktualisierungshinweise ansehen",
  cancel: "Abbrechen",

  defaultModel: "Standardmodell",
  defaultModelDesc:
    "Neue Sitzungen beginnen damit; in jeder Sitzung kann unter dem Eingabefeld gewechselt werden. Die Stufe „Empfohlen“ reicht für Transkription, Übersetzung und Bearbeitung; das leistungsfähigste Modell ist nicht nötig.",
  defaultModelOf: (name: string) => `${name}: Standardmodell`,
  defaultEffortOf: (name: string) => `${name}: Standard-Denkaufwand`,
  modelsOf: (name: string, count: number) => `${name} Modelle · ${count}`,
  modelsList: (list: string) => `${list}. Bei jeder Prüfung neu abgerufen.`,
  modelsNone: "Keine Modellliste gemeldet; Sitzungen verwenden das Agent-Standardmodell. Bei der nächsten Prüfung wird erneut angefragt.",
  refreshing: "Wird aktualisiert…",
  refreshModels: "Modelle aktualisieren",
  refreshed: (name: string) => `Modellliste neu abgerufen: ${name}`,
  nowDefault: (name: string) => `Neue Sitzungen verwenden jetzt ${name}`,
  version: (version: string | null) => (version ? `Version · v${version}` : "Version"),
  versionDesc: (latest: string | null, min: string | null, source: string) =>
    `${latest ? `Aktualisierung möglich auf ${latest}. ` : ""}${min ? `BaoCut benötigt mindestens ${min}. ` : ""}Aktualisieren betrifft nur dieses CLI-Werkzeug; Konto und dessen Einstellungen bleiben unverändert. ${source}`,
  account: "Konto",
  accountDesc: (signedOut: boolean, account: string | null, plan: string) =>
    `${signedOut ? "Nicht angemeldet oder Anmeldung abgelaufen" : (account ?? "Angemeldet")}. Verwendet Ihr eigenes ${plan}; BaoCut berechnet nichts zusätzlich. Anmeldung erfolgt im Terminal.`,
  loginInTerminal: "Terminal zum Anmelden öffnen",
  switchAccount: "Konto wechseln…",
  location: "Installationsort",
  locationDesc: "BaoCut ruft dieses Programm auf Ihrem Computer direkt auf und installiert keine weitere Kopie.",
  realLocation: "Tatsächlicher Speicherort",
  setLocation: "Speicherort manuell festlegen",
  troubleshoot: "Fehler beheben",
  troubleshootDesc: "Prüft Installation, Version, Anmeldung und Modellliste nacheinander und zeigt die Fehlerstelle.",
  setDefault: "Als Standard festlegen",
  runChecks: "Prüfungen ausführen",


  sourceKnown: (label: string) =>
    `Diese Kopie wurde installiert mit „${label}“; auf dieselbe Weise aktualisieren. Andere Methoden erreichen diese Kopie nicht und installieren nur eine weitere.`,
  sourceUnknown: "Auf dieselbe Weise aktualisieren, wie es installiert wurde.",
  scriptInstall:
    "Dieser Befehl lädt ein Skript von der offiziellen Website herunter und führt es aus. BaoCut führt keine Internetskripte für Sie aus; kopieren und manuell im Terminal ausführen.",
  scriptUpgrade: "Dieser Befehl lädt ein Skript von der offiziellen Website herunter und führt es aus. Kopieren und manuell im Terminal ausführen.",
  copyUpgrade: "Diesen Befehl kopieren, im Terminal ausführen und anschließend hier erneut prüfen.",
  runnableHint: "Links neben dem Befehl auf ▶ klicken, um ihn hier auszuführen; Ausgabe erscheint unten. Oder kopieren und manuell im Terminal ausführen.",
  copyHint: "Den folgenden Befehl kopieren und im Terminal ausführen.",
  installMethod: "Installationsmethode",
  upgradeMethod: "Aktualisierungsmethode",
  needs: (needs: string) => `Benötigt ${needs} auf diesem Computer.`,

  installIntro: (name: string, plan: string) =>
    `${name} ist ein auf Ihrem Computer installierter KI-Assistent für die Befehlszeile; angemeldet mit Ihrem vorhandenen ${plan}. BaoCut ruft ihn nur auf: keine Zusatzkosten und kein API-Schlüssel in BaoCut nötig.`,
  stepInstall: "Auf diesem Computer installieren",
  stepInstallOfficial: "Nach offizieller Anleitung auf diesem Computer installieren",

  installOfficialBody: (command: ReactNode): ReactNode =>
    createElement(Fragment, null, "Nach offizieller Anleitung installieren. Anschließend muss ", command, " im Terminal ausführbar sein."),
  stepLogin: "Bei Ihrem Konto anmelden",
  stepLoginBody:
    "Nach Installation den folgenden Befehl im Terminal ausführen und bei Aufforderung im Browser anmelden. Anmeldung erfolgt im eigenen Fenster; BaoCut verarbeitet weder Konto noch Passwort.",
  stepBack: "Hierher zurückkehren",
  stepBackBody: "Nach Erkennung als installiert und angemeldet einsatzbereit.",
  detecting: "Überprüfen…",
  recheck: "Installiert, erneut prüfen",
  notDetected: "Installiert, aber nicht erkannt?",
  notDetectedBody:
    "BaoCut sucht in PATH und üblichen Installationsorten (Homebrew, globaler npm-Ordner, ~/.local/bin). Versionsmanager (nvm, asdf, mise) installieren manchmal anderswo; der Speicherort kann manuell angegeben werden.",
  diagnosisOf: (name: string) => `Prüfergebnisse für ${name}`,
};
