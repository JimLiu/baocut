import type { CliMessages } from './cli-copy.ts';



export const de: CliMessages = {
  // 一屏帮助（Agent 面设计 §5.7）
  helpTagline:
    "baocut — Videos mit BaoCut transkribieren, übersetzen, bearbeiten, vertonen und exportieren. Führen Sie zuerst `baocut status` aus, um die Möglichkeiten dieses Computers zu prüfen.",
  helpFlows: "Abläufe (geben einen Auftrag zurück; warten standardmäßig auf dessen Abschluss)",
  helpObjects: "Objekte",
  helpAdmin: "Lokale Verwaltung (für Menschen; Agenten fragen zuerst den Benutzer)",
  helpMore: "Mehr",
  helpMoreHelp: "Parameter, Wirkung und Beispiele",
  helpMoreSpec: "maschinenlesbarer Katalog (JSON)",
  helpMoreStatus: "aktuell verfügbare Funktionen dieses Computers",
  helpGlobalFlags: "--json --project <dir> --yes --max-bytes <n> --result-file <file> --no-start",
  helpJobFlags: "Aufträge: --no-wait --timeout <s> --progress jsonl",
  helpAdminVerbs: "Lokale Verwaltung",
  helpGroupMore: (noun: string) => `baocut help ${noun} <command> für Parameter und Beispiele.`,
  helpFlagsPlaceholder: "[flags]",
  effectLabel: (effect: string) => `Wirkung: ${effect}`,
  effectQuery: "Abfrage (schreibgeschützt)",
  effectMutation: "Änderung (ändert den Zustand)",
  effectJob: "Auftrag (gibt einen Auftrag zurück; wartet standardmäßig auf dessen Abschluss)",
  effectDestructive: "destruktiv (nicht rückgängig zu machen; erfordert --yes)",
  helpParameters: "Parameter",
  helpNoParameters: "(keine)",
  helpRequired: "erforderlich",
  helpRepeatable: "wiederholbar",
  helpPositionalNote: (positional: string, flag: string) =>
    `${positional} kann als Positionsargument oder mit ${flag} angegeben werden, nicht mit beidem.`,
  helpExamples: "Beispiele",
  helpCommonFlags: "Allgemeine Flags",

  // 输出
  nextLabel: "weiter",
  errorLabel: "Fehler",
  runtimeStartedNote: "(eine BaoCut-Runtime wurde im Hintergrund gestartet; sie beendet sich bei Inaktivität selbst)",
  spilledNote: (maxBytes: number) =>
    `Das Ergebnis ist größer als ${maxBytes} Byte: Das vollständige Ergebnis steht in der Datei unter path (JSON). coverage enthält die Schlüssel der obersten Ebene und die Array-Längen, summary die kurzen Felder. Lesen Sie die Datei, grenzen Sie die Anfrage mit den Flags unter continueWith.paging ein oder führen Sie sie mit --max-bytes continueWith.maxBytes erneut aus.`,
  resultFileWritten:
    "Das vollständige Ergebnis steht wie mit --result-file angefordert in der Datei unter path (JSON). coverage enthält die Schlüssel der obersten Ebene und die Array-Längen, summary die kurzen Felder.",

  // 参数
  unknownCommand: (command: string) => `Unbekannter Befehl: ${command}. Führen Sie baocut --help aus, um die Befehle anzuzeigen.`,
  unknownFlag: (flag: string, command: string) => `Unbekanntes Flag ${flag} für baocut ${command}. Siehe baocut help ${command}.`,
  missingValue: (flag: string) => `${flag} benötigt einen Wert.`,
  noValueExpected: (flag: string) => `${flag} ist ein Schalter und akzeptiert keinen Wert.`,
  duplicateFlag: (flag: string) => `${flag} wurde mehrfach angegeben.`,
  badNumber: (flag: string, value: string) => `${flag} benötigt eine Zahl; erhalten: „${value}“.`,
  badInteger: (flag: string, value: string) => `${flag} benötigt eine ganze Zahl; erhalten: „${value}“.`,
  badBoolean: (flag: string, value: string) => `${flag} benötigt true oder false; erhalten: „${value}“.`,
  badChoice: (flag: string, value: string, choices: readonly string[]) => `${flag} muss einer der folgenden Werte sein: ${choices.join(", ")}; erhalten: „${value}“.`,
  badValue: (flag: string, value: string) => `„${value}“ ist kein gültiger Wert für ${flag}.`,
  badJson: (flag: string, reason: string) => `${flag} benötigt JSON (ein Literal, @file oder - für stdin): ${reason}`,
  expectedObject: (flag: string) => `${flag} benötigt ein JSON-Objekt.`,
  readFileFailed: (flag: string, file: string, reason: string) => `Nicht lesbar: ${file} für ${flag}: ${reason}`,
  stdinTwice: (flag: string) => `Die Standardeingabe kann nur einmal gelesen werden (${flag} hat sie erneut angefordert).`,
  noPositional: (command: string, value: string) => `baocut ${command} akzeptiert kein Positionsargument (erhalten: „${value}“); verwenden Sie Flags.`,
  tooManyPositionals: (command: string, extra: string) => `baocut ${command} akzeptiert ein Positionsargument; zusätzlich: ${extra}`,
  positionalAndFlag: (field: string, flag: string) => `${field} wurde sowohl als Positionsargument als auch mit ${flag} angegeben; verwenden Sie nur eines.`,
  missingRequired: (names: string, command: string) => `Fehlend: ${names}. Siehe baocut help ${command}.`,
  dryRunUnsupported: (command: string) => `baocut ${command} hat kein --dry-run.`,
  projectNotDirectory: (value: string) => `--project ${value} ist kein Verzeichnis.`,
  confirmationRequired: (command: string, summary: string) =>
    `baocut ${command} lässt sich nicht rückgängig machen und wurde nicht ausgeführt. Dies würde geschehen: ${summary} Führen Sie den Befehl mit --yes erneut aus, sobald der Benutzer zugestimmt hat.`,
  confirmationNext: (command: string) => `baocut ${command} … --yes (nach Zustimmung des Benutzers)`,
  unknownSpec: (name: string) => `Kein Werkzeug namens ${name}. baocut spec listet den vollständigen Katalog auf.`,
  unknownEditOp: (op: string) => `edits apply hat keinen Vorgang namens ${op}. baocut edits ops listet sie auf.`,
  catalogUnavailable: (command: string) =>
    `Der Offline-Katalog fehlt und keine Runtime läuft. Erstellen Sie ihn mit \`${command}\` (im Repository) oder starten Sie die Runtime mit baocut runtime ensure.`,
  runtimeUsage: "Verwendung: baocut runtime ensure | status | stop",
  installConfirmationRequired: (bundleId: string, size: string, source: string) =>
    `Die Installation des lokalen Modells ${bundleId} lädt ${size} von ${source} herunter; nichts wurde heruntergeladen. Teilen Sie dem Benutzer die Größe mit und führen Sie den Befehl mit --yes erneut aus, sobald er zugestimmt hat.`,
  sizeEstimated: " (geschätzt)",

  // 元命令的帮助（§4.5）
  metaHelp: {
    help: "baocut help [<command>]\n\nOhne Befehl: Übersicht auf einer Bildschirmseite. Mit Befehl (`help videos`, `help videos inspect`, `help runtime`): Parameter, Wirkung und Beispiele. Verwendet den Katalog einer laufenden Runtime, andernfalls den Offline-Katalog; startet niemals eine Runtime.",
    spec: "baocut spec [<name>]\n\nDer maschinenlesbare Katalog als reines JSON (ohne Hülle) mit seiner Schnittstellenversion. <name> ist ein Werkzeugname (videos_inspect), ein Name mit Punkt (videos.inspect), ein Befehl (videos inspect) oder edits.<operation> für einen Vorgang von edits apply. Verwendet den Katalog einer laufenden Runtime, andernfalls den Offline-Katalog; startet niemals eine Runtime.",
    version:
      "baocut version\n\nVersionen dieser CLI und einer gegebenenfalls laufenden Runtime, einschließlich beider Werkzeugschnittstellenversionen und ihrer Übereinstimmung. Reines JSON; startet niemals eine Runtime.",
    status:
      "baocut status [--full] [--no-start]\n\nAktuell verfügbare Funktionen dieses Computers: die Runtime, jede Funktion mit ihrem Standard und ihrer Verfügbarkeit, lokale Modellpakete und externe Werkzeuge, mit Abhilfebefehlen für Fehlendes. Funktionen und Modellpakete erscheinen als Zusammenfassung; --full ergänzt jeden Anbieter mit Modellen, Parametern und Grenzen sowie die Paketdetails. Startet die Runtime, falls keine läuft; mit --no-start wird stattdessen running: false zurückgegeben.",
    runtime: [
      "baocut runtime ensure | status | stop",
      "",
      "Die BaoCut-Runtime, mit der diese CLI kommuniziert (eine je BAOCUT_HOME).",
      "  ensure   laufende Runtime finden oder eine im Hintergrund starten; eine von der CLI gestartete Runtime beendet sich selbst",
      "           nach runtime.idleExitMinutes Inaktivität (keine Verbindungen, Aufträge oder offenen Dienste)",
      "  status   Laufstatus, Initiator, Verbindungen, aktive Aufträge, offene Dienste und Ende bei Inaktivität; startet niemals eine Runtime",
      "  stop     die von der CLI gestartete Runtime beenden. RUNTIME_NOT_OWNED, falls die Desktop-App oder jemand anderes sie gestartet hat,",
      "           RUNTIME_IN_USE, solange die Desktop-App, eine andere CLI oder ein laufender Auftrag sie verwendet (Exitcode 1)",
      "",
      "Flags: --json  --no-start (ensure: mit Exitcode 3 fehlschlagen, statt eine Runtime zu starten)",
    ].join("\n"),
  } as Record<"help" | "spec" | "version" | "status" | "runtime", string>,

  // Runtime 的归属（§5.6）
  runtimeNotRunning: (home: string) => `Keine BaoCut-Runtime läuft für ${home}, und --no-start wurde angegeben.`,
  runtimeNoEntry:
    "Keine BaoCut-Runtime läuft und keine konnte gestartet werden: Installieren Sie die BaoCut-App, führen Sie den Befehl aus dem Repository aus oder setzen Sie BAOCUT_RUNTIME_ENTRY auf den Runtime-Einstiegspunkt.",
  runtimeStartFailed: (reason: string, log: string) => `Die BaoCut-Runtime ließ sich nicht starten (${reason}). Siehe ${log}.`,
  runtimeStartTimeout: (seconds: number, log: string) => `Die BaoCut-Runtime war nicht bereit innerhalb von ${seconds} s. Siehe ${log}.`,
  exitedWith: (code: number | null) => `sie wurde mit Code beendet: ${code ?? "unbekannt"}`,
  runtimeConnectFailed: (reason: string) => `Verbindung zur BaoCut-Runtime nicht möglich: ${reason}`,
  runtimeLost: (reason: string) => `Verbindung zur BaoCut-Runtime verloren: ${reason}`,
  protocolMismatch: (reason: string) =>
    `Diese CLI und die BaoCut-Runtime verwenden unterschiedliche Protokollversionen: ${reason}. Aktualisieren Sie die ältere.`,
  interfaceMismatch: (cli: string, runtime: string, update: "cli" | "runtime") =>
    `Diese CLI verwendet Werkzeugschnittstellenversion ${cli}, die Runtime verwendet ${runtime}. ${update === "cli" ? "Aktualisieren Sie die CLI." : "Aktualisieren Sie die BaoCut-App (oder starten Sie die Runtime aus demselben Checkout wie die CLI neu)."}`,

  // 任务（§5.4）
  jobCancelling: (jobId: string) => `Abbrechen: ${jobId}… (drücken Sie erneut Ctrl-C, um das Warten sofort zu beenden)`,
  jobCancelFailed: (reason: string) => `Der Auftrag ließ sich nicht abbrechen: ${reason}`,
  jobEnded: (state: string) => `Der Auftrag wurde beendet: ${state}.`,
  statusFullNext:
    "baocut status --full listet alle Anbieter und Modelle für jede Funktion auf; für eine einzelne Funktion führen Sie baocut models capabilities --capability <capability> aus, für Paketdetails baocut models list.",
  waitTimeout: (seconds: number, jobId: string) => `Warten beendet nach ${seconds} s; Auftrag ${jobId} läuft weiter.`,

  // 管理桶（admin/context.ts）
  noRuntimeClient: "Dieser Befehl verbindet sich nicht mit der Runtime",
};
