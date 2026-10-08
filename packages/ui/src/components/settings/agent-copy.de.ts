import { pluralForm } from '@baocut/protocol';
import type { AgentPolicy } from '@baocut/protocol';
import { revealLabel } from '../../copy.ts';
import type { AgentMessages } from './agent-copy.ts';

export const de: AgentMessages = {

  pageTitle: "Agentenanbieter",

  factsLabel: "So arbeiten Agenten",

  permissionsTitle: "Agentenberechtigungen",
  lede: "Ein Agent ist ein auf Ihrem Computer installierter KI-Coding-Assistent wie Claude Code oder Codex. BaoCut ruft ihn direkt auf; ein Satz kann Transkription, Übersetzung und Bearbeitung auslösen.",

  facts: [
    { key: 'cli', title: "Verwendet Vorhandenes", body: "BaoCut ruft den CLI-Agenten dieses Computers auf, statt einen eigenen zu installieren." },
    { key: 'plan', title: "Verwendet Ihr Abonnement", body: "Keine zusätzliche Zahlung an BaoCut und kein API-Schlüssel nötig." },
    { key: 'ask', title: "Fragt vor Änderungen", body: "Vor dem Schreiben in ein Video wartet er auf Ihre Zustimmung; jederzeit rückgängig zu machen." },
  ] as readonly { key: 'cli' | 'plan' | 'ask'; title: string; body: string }[],

  providersHeading: "Agenten auf diesem Computer",
  providersHint:
    "BaoCut findet installierte Agenten. Ein funktionierender Agent reicht; nicht alle sind nötig. Bei Unsicherheit Claude Code oder Codex wählen. Integrierte Agenten lassen sich nur deaktivieren, selbst hinzugefügte entfernen.",

  providersMeta: (checked: string | null, builtin: number, added: number, found: number) =>
    `${checked ? `Geprüft: ${checked} · ` : ""}BaoCut enthält ${builtin} integrierte ${pluralForm('de', builtin, { one: "Agent", other: "Agenten" })}${added ? `, selbst hinzugefügt: ${added}` : ""}; ${found} auf diesem Computer erkannt`,

  statusLabel: "Agentenstatus",
  scanDone: (n: number) => (n ? `Prüfung abgeschlossen · ${n} ${pluralForm('de', n, { one: "Agent", other: "Agenten" })} auf diesem Computer` : "Prüfung abgeschlossen · keine installierten Agenten gefunden"),
  scanFailed: (message: string) => `Erneute Prüfung fehlgeschlagen: ${message}`,
  enableFailed: (message: string) => `Aktivieren fehlgeschlagen: ${message}`,
  scanning: "Überprüfen…",
  rescan: "Erneut prüfen",
  emptyDisconnected: "Mit Runtime verbinden, um Agenten auf diesem Computer zu prüfen.",
  emptyNoDrivers: "Diese Runtime-Version enthält keine Agenten.",
  emptyNoneFound: "Keine Agenten auf diesem Computer erkannt; gängige sind unten aufgeführt.",
  scanProgress: "Agenten werden geprüft",
  faqLabel: "Häufige Fragen",
  goCloudModels: "Zu Cloud-Modellen",
  goSkills: "Zu Skills",


  moreProviders: {
    title: (count: number) => `Weitere unterstützte Agenten · ${count}`,
    sub: (names: string) => `${names} · keine auf diesem Computer erkannt`,
    expand: "Zeigen",
    collapse: "Verstecken",
  },


  fullAccessOnly:
    "Kann nicht schrittweise um Genehmigung bitten; BaoCut führt ihn nur mit Vollzugriff aus. Vor Befehlen oder Dateiänderungen wird nicht nachgefragt.",


  untested: {
    badge: "Nicht in BaoCut getestet",
    body: "Hat noch keine vollständige BaoCut-Sitzung auf einem echten Computer durchlaufen. Erkennung, Anmeldung und Modellliste funktionieren normal; bei Sitzungsproblemen die eigene Dokumentation beachten.",
  },


  catalog: {
    heading: "Weitere Agenten hinzufügen",
    hint: "Auch andere CLI-Agenten mit ACP-Unterstützung (Agent Client Protocol) können hinzugefügt werden. BaoCut hat sie nicht einzeln geprüft; die Nutzbarkeit hängt vom Prüfergebnis ab.",
    custom: "Benutzerdefinierter Befehl…",
    search: "Agenten zum Hinzufügen suchen",
    searchPlaceholder: "Nach Name, Beschreibung oder Befehl suchen",
    count: (total: number) => `${total} im Katalog`,
    found: (n: number) => `${n} gefunden`,
    list: "Hinzufügbare Agenten",
    add: "Hinzufügen",
    addTo: (name: string) => `Hinzufügen: ${name}`,
    added: "Hinzugefügt",
    empty: (query: string) => `Keine Katalogtreffer für „${query}“. Nicht gelistete Agenten über ihren Startbefehl hinzufügen.`,
    landed: (name: string, custom: boolean) => `Hinzugefügt: ${name}${custom ? " (benutzerdefinierter Befehl)" : ""} · nach Erkennung in Sitzungen verwendbar`,
    addFailed: (message: string) => `Hinzufügen fehlgeschlagen: ${message}`,
    webNote:
      "Agenten können im Browser nicht hinzugefügt oder entfernt werden, da dies die ausgeführten Befehle auf diesem Computer festlegt. BaoCut-Desktop-App verwenden.",
  },


  customDialog: {
    title: "Agenten mit benutzerdefiniertem Befehl hinzufügen",
    lede: "Den Terminalbefehl zum Starten im ACP-Modus eingeben. BaoCut startet das Programm direkt, ohne Terminal.",
    name: "Name",
    namePlaceholder: "z. B. Mein Agent",
    id: 'id',
    idPlaceholder: "my-agent",
    idHint: "Kennung in Einstellungen und Diagnose: mit Kleinbuchstaben beginnen; nur Kleinbuchstaben, Ziffern und Bindestriche.",
    command: "Befehl",
    commandPlaceholder: "my-agent --acp",
    commandHint: "An Leerzeichen in Programm und Argumente teilen; Argumente mit Leerzeichen in Anführungszeichen setzen.",
    commandParts: (exe: string, args: string[]) => `Startet als: Programm ${exe}, Argumente ${args.join(" · ")}`,
    env: "Umgebungsvariablen (optional)",
    envPlaceholder: "MY_AGENT_TOKEN_FILE=~/.config/my-agent/token\\nMY_AGENT_LOG=0",
    envHint: "Eine Zeile KEY=VALUE; nur beim Start durch BaoCut hinzugefügt.",
    note: "Nach dem Hinzufügen prüft BaoCut Start, Anmeldebedarf und Modelle. Nach Erkennung erscheint der Agent in Sitzungen.",
    cancel: "Abbrechen",
    submit: "Hinzufügen",
    exists: (id: string) => `Ein Agent verwendet bereits „${id}“. Andere ID wählen.`,
  },


  added: {
    chip: "Von Ihnen hinzugefügt",
    detect: "Prüfen",
    detecting: "Überprüfen…",
    remove: "Entfernen",
    subFound: (version: string | null) => ["Erkannt", version ? `v${version}` : null, "Über ACP verbunden"].filter(Boolean).join(" · "),
    subLauncher: (launcher: string, needs: string) => `Noch nicht geprüft · ${launcher} lädt beim Start herunter; benötigt ${needs}`,
    subMissing: (command: string) => `Noch nicht geprüft · ${command} nicht auf diesem Computer gefunden`,
    note: (name: string) =>
      `${name} verbindet über ACP (Agent Client Protocol). Nicht von BaoCut geprüft; Installation und Kontowahl nach eigener Dokumentation.`,
    noInstall: "Keine separate Installation nötig",
    noInstallBody: (launcher: string, spec: string, needs: string) =>
      `Beim Start durch BaoCut lädt ${launcher} herunter: ${spec} automatisch. Benötigt ${needs} auf diesem Computer.`,
    install: "Nach offizieller Anleitung auf diesem Computer installieren",
    installBody: (command: string) => `Nach Installation muss ${command} im Terminal ausführbar sein.`,
    docs: "Offizielle Anleitung öffnen",
    launch: "BaoCut startet mit diesem Befehl",
    launchCopy: "Startbefehl",
    envNote: (keys: string[]) => `Fügt beim Start folgende Umgebungsvariablen hinzu: ${keys.join(", ")} (Werte werden hier nicht gezeigt).`,
    login: "Bei Anmeldebedarf über den Agenten anmelden",
    loginBody: "Den Anweisungen im Terminal folgen. Anmeldung erfolgt im eigenen Fenster; BaoCut verarbeitet weder Konto noch Passwort.",
    detectStep: "Prüfen",
    detectBody: "BaoCut startet einmal, um Verbindung, Anmeldebedarf und Modellliste zu prüfen.",
    launchRow: "Startbefehl",
    launchRowHint: "BaoCut startet mit diesem Befehl über ACP (Agent Client Protocol).",
    versionPinned: (spec: string) => `Der Startbefehl legt diese Version fest: ${spec}. Zum Versionswechsel entfernen und mit benutzerdefiniertem Befehl erneut hinzufügen.`,
    versionOwn: "Nach eigener Anleitung aktualisieren, dann hier erneut prüfen.",
    account: (name: string, signedOut: boolean) =>
      `${signedOut ? "Nicht angemeldet oder Anmeldung abgelaufen. " : ""}Anmeldung und Abrechnung erfolgen bei ${name}; BaoCut verarbeitet Ihr Konto nicht und berechnet nichts zusätzlich.`,
    removeTitle: (name: string) => `Entfernen: ${name}?`,
    removeBody: (name: string) =>
      `${name} wird aus BaoCuts Agentenliste samt Aktivierung und Standardmodell entfernt. Neue Sitzungen mit diesem Standard verwenden einen anderen verfügbaren Agenten. Laufende Aufgaben damit werden beendet. Das installierte Programm bleibt unverändert und kann später wieder hinzugefügt werden.`,
    removed: (name: string) => `Entfernt: ${name}`,
    removeFailed: (message: string) => `Entfernen fehlgeschlagen: ${message}`,
  },


  codexImage: {
    title: "Mit Codex zeichnen",
    body: "Ohne Schlüssel; verwendet Ihr Codex-Abonnement. Ein Bild gleichzeitig, Größe und Qualität ignoriert, 5–10× langsamer als die API. Nach Aktivierung können bcut image und Sitzungsagenten es als „Codex“ auswählen. Keine automatische Wahl; zum Standard unter Modelle › Bilderzeugung › Cloud-Modelle festlegen.",
    checking: "Codex-Zeichenfähigkeit dieses Computers wird geprüft…",
    on: "An",

    period: ".",
    probeFailed: "Codex-Zeichenfähigkeit konnte nicht geprüft werden · auf „Erneut prüfen“ klicken.",
    outdated: "Codex ist zu alt · Codex CLI aktualisieren und dann einschalten",
    signedOut: "Codex ist noch nicht angemeldet · Zeichnen verwendet Ihr Codex-Konto; vor Aktivierung anmelden.",
    notInstalled: "Codex nicht gefunden · vor dem Zeichnen Codex CLI installieren und anmelden.",
    unavailable: (detail: string | null) =>
      detail ? `Codex kann derzeit nicht zeichnen · ${detail}` : "Codex kann derzeit nicht zeichnen · auf „Erneut prüfen“ klicken.",
    turnedOn: "Mit Codex zeichnen aktiviert · Codex erscheint jetzt im Bilderzeugungsmodell-Menü",
    turnedOff: "Mit Codex zeichnen deaktiviert",
    toggleFailed: (enabled: boolean, message: string) =>
      enabled ? `Mit Codex zeichnen konnte nicht aktiviert werden: ${message}` : `Mit Codex zeichnen konnte nicht deaktiviert werden: ${message}`,
  },


  faq: [
    {
      key: 'cost',
      title: "Muss ich BaoCut separat bezahlen oder abonnieren?",
      body: "Nein. Agenten verwenden vorhandene Claude- oder ChatGPT-Abonnements; Kosten und Kontingent werden dort gezählt. BaoCut liefert kein eigenes Modell, sammelt keine Schlüssel und leitet nichts über die Cloud weiter. Ohne entsprechendes Abonnement sind Agenten optional; der Rest von BaoCut funktioniert normal.",
    },
    {
      key: 'account',
      title: "Kann BaoCut Konto und Passwort sehen?",
      body: "Nein. Anmeldung erfolgt im Agentenfenster. BaoCut startet nur das Programm auf Ihrem Computer und übergibt das Video. Vor Videoänderungen wird gefragt; Regeln unter Einstellungen › Datenschutz und Berechtigungen.",
    },
    {
      key: 'cloud',
      title: "Wie unterscheiden sich Agenten und Cloud-Modelle?",
      body: "Ein Agent verwendet den Coding-Assistenten auf Ihrem Computer mit dessen Abonnement und führt mehrstufige Aufgaben aus. Cloud-Modelle führen einzelne Werkzeuge direkt per API-Schlüssel aus und rechnen nach Nutzung ab. Separate Einrichtung.",
      link: "Modelle",
    },
    {
      key: 'terminal',
      title: "BaoCut mit diesen Agenten im Terminal steuern?",
      body: "Sitzungen in BaoCut benötigen keine Einrichtung. Für Terminal oder andere Apps den BaoCut-Skill installieren; siehe Einstellungen › Skills.",
      link: "Skills",
    },
  ] as readonly { key: string; title: string; body: string; link?: 'models' | 'skills' }[],

  permissionsHeading: "Sie entscheiden, wann gefragt wird",
  policyHeading: "Weniger wiederholte Rückfragen",
  policyHint: "Diese Regeln erlauben passende Aktionen automatisch; auch der Zugriffsmodus beeinflusst Rückfragen.",

  policy: {
    read: { label: "Videoinhalt lesen", desc: "Erlaubt Ansicht von Transkripten und Videoeinstellungen ohne jedes Mal nachzufragen." },
    bcutro: { label: "Videos und Fortschritt abfragen", desc: "Erlaubt Informations- und Fortschrittsprüfung. Diese Befehle ändern das Video nicht." },
    loop: { label: "Auf laufende KI-Aufgaben antworten", desc: "Erlaubt Aufgabenempfang und Antwortübermittlung mit weniger Unterbrechungen in mehrstufiger Arbeit." },
  } as Record<keyof AgentPolicy, { label: string; desc: string }>,
  accessModes: "Zugriffsmodi",
  firstDefault: "Anfangsstandard",
  alwaysAllowed: "Immer erlaubte Befehle",
  saveFailed: (message: string) => `Speichern fehlgeschlagen: ${message}`,
  ruleRemoved: (rule: string) => `Regel entfernt: ${rule}`,
  ruleRemoveFailed: (message: string) => `Regel konnte nicht entfernt werden: ${message}`,

  modeHint: (firstDefault: string, last: string | null) =>
    `Zugriffsmodus unter dem Eingabefeld jeder Sitzung wählen. Anfangsstandard ist „${firstDefault}“; danach behalten neue Sitzungen die letzte Auswahl${last ? ` (aktuell „${last}“)` : ""}.`,

  advancedHeading: "Erweitert & Fehlerbehebung",
  advancedHint: "Bei funktionierender Verbindung muss hier nichts geändert werden.",
  modelAutoUpdate: {
    label: "Modelllisten automatisch aktualisieren",
    desc: "Beim Start und während des Betriebs regelmäßig die Modellliste jedes aktivierten Agenten aktualisieren. Bei ausgeschalteter Option in dessen Details manuell abrufbar.",
  },
  executableHint:
    "BaoCut sucht in PATH und üblichen Installationsorten (Homebrew, globaler npm-Ordner, ~/.local/bin). Versionsmanager (nvm, asdf, mise) installieren manchmal anderswo; hier den vollständigen Programmpfad eingeben. Leer lassen für automatische Suche.",
  techPanel: "Technische Informationen und Speicherorte",
  techTitle: "Technische Agenteninformationen",
  techSubtitle: "Versionen, Pfade und verfügbare Modelle",
  techEmpty: "Noch keine Prüfergebnisse.",
  techNotInstalled: "· Nicht installiert",
  techNoModels: "Keine Modellliste gemeldet",

  pathLabel: "Pfad",
  diagnosticsLabel: "Diagnose",
  copyDiagnostics: "Diagnose kopieren",
  locateTitle: "Agentenspeicherort manuell festlegen",
  locateSubtitle: "Wenn automatische Erkennung nichts findet",


  command: {
    copied: (label: string) => `Kopiert: ${label}`,
    copyFailed: "Kopieren fehlgeschlagen. Text auswählen und manuell kopieren.",
    copy: (label: string) => `Kopieren: ${label}`,
    stop: "Stopp",
    run: "Diesen Befehl ausführen",
    output: "Befehlsausgabe",
    running: "Läuft",
    runningText: "Läuft…",
    done: "Fertig",
    stopped: "Gestoppt. Bereits ausgeführte Schritte werden nicht zurückgenommen; erneutes Ausführen ist möglich.",
    failed: (reason: string) => `Nicht erfolgreich (${reason}). Die Ausgabe oben zeigt den Grund; bei Passwortbedarf im Terminal ausführen.`,
    runInTerminal: "Im Terminal ausführen",
    exitCode: (code: number) => `Exit-Code ${code}`,
    startFailed: (error: string) => `konnte nicht starten: ${error}`,
    killed: "der Prozess wurde beendet",
    confirmInstall: (name: string) => `Installationsbefehl ausführen für ${name}?`,
    confirmUpgrade: (name: string) => `Aktualisierungsbefehl ausführen für ${name}?`,
    confirmRun: "Ausführen",
    cancel: "Abbrechen",
    confirmBefore: "BaoCut führt den folgenden Befehl auf diesem Computer aus. Ausgabe erscheint darunter; jederzeit stoppbar.",
    confirmAfter: "Befehle mit Passwortbedarf schlagen hier fehl; im Terminal ausführen.",
    restored: (name: string) => `${name} verwendet wieder die automatische Suche`,
    switched: (path: string) => `Verwendet jetzt ${path}`,
    notFoundAt: (path: string, command: string) => `Keine ausführbare Version von ${command} gefunden unter ${path}`,
    saveFailed: (message: string) => `Speicherort konnte nicht gespeichert werden: ${message}`,
    locationLabel: (name: string) => `${name}: Speicherort`,
    locationPlaceholder: (command: string) => `/full/path/${command}`,
    locationSaved: "Manuell festgelegt. Leeren und speichern, um zur automatischen Suche zurückzukehren.",
    locationAuto: "Leer = automatische Suche",
    save: "Speichern",
    restoreAuto: "Automatische Suche verwenden",
  },

  skills: {
    lede: "Ein Skill ist ein Ordner (SKILL.md und optionale Referenzdateien), der BaoCuts Agenten eine Arbeitsweise vermittelt. Eingeschaltet wird er bei passenden Aufgaben automatisch verwendet; ausgeschaltet nur nach Auswahl über „+“ im Eingabefeld. Ein-/Ausschalten, Hinzufügen und Entfernen werden ab der nächsten neuen Agentensitzung wirksam.",
    search: "Skills suchen",
    filter: "Nach Quelle filtern",
    tab: (label: string, count: number) => `${label} ${count}`,
    tabLabel: (label: string, count: number) => `${label}, ${count}`,
    add: "Skill hinzufügen",
    addFolder: "Aus lokalem Ordner hinzufügen",
    addGithub: "Von GitHub importieren",
    loading: "Skills werden geladen…",
    loadFailed: (message: string) => `Skills konnten nicht geladen werden: ${message}`,
    retry: "Erneut versuchen",
    disconnected: "Nicht mit BaoCut Runtime verbunden. Skills erscheinen nach Verbindung.",
    emptyTitle: "Noch keine Skills",
    emptyBody:
      "Noch keine Skills verfügbar. Einen eigenen Skill-Ordner hinzufügen oder einen geteilten Skill von GitHub importieren. Drittanbieter-Skills sind nach Import ausgeschaltet; vor dem Einschalten prüfen.",
    emptyWeb: "Noch keine Skills verfügbar. Im Browser nur anzeigen und umschalten; in der BaoCut-Desktop-App hinzufügen und importieren.",
    noMatch: (query: string) => `Keine Skills gefunden für „${query}“`,
    noMatchHint: "Anderen Begriff versuchen oder „Alle“ auswählen.",
    noneInTab: (label: string) => `Nicht vorhanden: ${label} Skills verfügbar`,
    webNote: "Im Browser Skills anzeigen und umschalten; in der BaoCut-Desktop-App hinzufügen, importieren und entfernen.",
    view: (name: string) => `Anzeigen: ${name}`,
    enable: (name: string) => `Aktivieren: ${name}`,
    toggledOn: (name: string) => `Eingeschaltet: „${name}“: ab der nächsten neuen Sitzung automatisch vom Agenten bei passenden Aufgaben verwendet`,
    toggledOff: (name: string) => `Ausgeschaltet: „${name}“: nur noch nach Auswahl über „+“ im Eingabefeld verwendet`,
    added: (name: string) => `Hinzugefügt: „${name}“`,
    imported: (name: string) => `Importiert: „${name}“, standardmäßig ausgeschaltet`,
    removed: (name: string) => `Entfernt: „${name}“`,
    diagnosticsTitle: (count: number) => `${count} ${pluralForm('de', count, { one: "Ordner", other: "Ordner" })} konnten nicht geladen werden`,
    diagnosticsHint: "Diese Ordner sind keine nutzbaren Skills und wurden übersprungen. Korrigieren und auf dieser Seite neu laden.",
    diagnosticCode: { invalid: "Ungültiges Format", 'duplicate-id': "Doppelter Name", 'builtin-conflict': "Name eines integrierten Skills" } as Record<string, string>,

    diagnosticLine: (dir: string, reason: string, issue: string) => `${dir} · ${reason}: ${issue}`,
    externalTitle: "BaoCut über Agenten im Terminal oder anderen Apps verwenden",
    externalBody:
      "Obige Skills sind für Agenten innerhalb von BaoCut. Für Transkription, Übersetzung, Bearbeitung und Export im Terminal den BaoCut-Skill für Claude Code oder Codex installieren. Installation in deren globale Ordner mit einem Klick sowie Installations- und Aktualisierungsanzeige folgen in einer späteren Version.",
  },

  skillDetail: {
    close: "Schließen",
    stateOn: "Ein: automatische Verwendung durch den Agenten bei passenden Aufgaben.",
    stateOff: "Aus: nur nach Auswahl über „+“ im Eingabefeld verwendet.",
    thirdPartyNote:
      "Drittanbieter-Skills stammen aus geteilten Repositorys; vor Aktivierung prüfen. BaoCut führt keine Skill-Dateien aus, und Skills erweitern keine Agentenberechtigungen.",
    source: "Quelle",
    location: "Speicherort",
    version: "Version",
    noVersion: "Nicht angegeben",
    get reveal() {
      return revealLabel();
    },
    body: "SKILL.md",
    emptyBody: "SKILL.md enthält außer Name und Beschreibung am Anfang keine weiteren Inhalte.",
    files: (count: number) => `Dateien (${count})`,
    back: "Zurück",
    notText: "Keine Textdatei; hier nicht angezeigt",
    tooLarge: "Datei zu groß; hier nicht angezeigt",
    loading: "Wird geladen…",
    loadFailed: (message: string) => `Laden fehlgeschlagen: ${message}`,
    remove: "Entfernen",
    removeBuiltin: "Integrierte Skills können nicht entfernt, aber ausgeschaltet werden.",
    removeTitle: (name: string) => `Entfernen: „${name}“?`,
    removeBody: (path: string) => `Dies löscht den Ordner ${path} samt aller Dateien und ist nicht rückgängig zu machen. Laufende Sitzungen bleiben unverändert.`,
    cancel: "Abbrechen",
  },

  skillGithub: {
    title: "Von GitHub importieren",
    label: "Repository-URL",
    placeholder: "owner/repo",
    description: "Auch vollständige URL möglich, z. B. https://github.com/owner/repo/tree/main/skills/name",
    note: "Lädt nur Dateien im Zielordner dieser URL herunter und führt keine aus. Importierte Skills gelten als „Drittanbieter“ und sind standardmäßig ausgeschaltet: Verwendung nur nach Auswahl über „+“ im Eingabefeld. Vor Aktivierung Inhalte prüfen.",
    submit: "Importieren",
    pending: "Wird von GitHub heruntergeladen…",
    cancel: "Abbrechen",
  },
};
