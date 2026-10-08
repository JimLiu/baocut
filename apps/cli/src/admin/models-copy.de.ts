import { pluralForm } from '@baocut/protocol';
const noun = (n: number, one: string, other: string) => pluralForm('de', n, { one, other });
import type { ModelBundleStatus, ModelsDirInfo, ProviderAccountStatus, UsagePeriod, UsageRow, ModelServiceCapability, ProviderUnavailableReason } from '@baocut/protocol';
import { MODEL_SERVICE_CAPABILITIES, USAGE_PERIODS } from '@baocut/protocol';
import type { ModelsMessages } from './models-copy.ts';



export const de: ModelsMessages = {

  help: `Verwendung:
  baocut models cancel <bundleId> [--discard]
                                   Installation stoppen (bereits Heruntergeladenes bleibt erhalten; erneute Installation setzt fort);
                                   --discard löscht es zusätzlich
  baocut models repair <bundleId> [--yes]
                                   sha256 jeder Datei prüfen und nur fehlende oder beschädigte Dateien erneut herunterladen
                                   (Bestätigung wie bei install)
  baocut models dir                Lokalen Modellordner anzeigen: Ort, Quelle, belegter und freier Speicherplatz, erkannte Modelle
  baocut models dir --set <path> [--move|--switch]
                                   Modellordner ändern: --move verschiebt vorhandene Modelle dorthin (Hintergrundaufgabe, bei Fehler
                                   zurückgesetzt); --switch ändert nur den Ort (alte Dateien bleiben erhalten; nur am neuen Ort
                                   vorhandene Modelle sind verwendbar); eine Option ist erforderlich, wenn der aktuelle Ordner Modelle enthält.
                                   Abgelehnt, solange eine Aufgabe ein lokales Modell verwendet; schreibgeschützt, wenn die
                                   Umgebungsvariable BAOCUT_MODELS_DIR den Ordner festlegt
  baocut models dir --reset [--move|--switch]
                                   Standardort wiederherstellen (<BAOCUT_HOME>/models), dieselben Regeln wie bei --set
  baocut models configure <providerId> [options]
                                   Online-Anbieter konfigurieren: Kataloganbieter (openai, google, elevenlabs, anthropic, deepseek,
                                   qwen und weitere; siehe baocut models capabilities) oder eigener OpenAI-kompatibler Endpunkt custom:<name>.
                                   Der Agent-Anbieter agent:codex hat nur einen Ein-/Ausschalter (verwendet die Codex-Anmeldung dieses Computers, keinen Schlüssel)
    --enable | --disable           Aktivieren (dauerhafte Berechtigungen senden bei Bedarf Material-Audio, Text oder Prompts) oder deaktivieren
    --key-stdin                    API-Schlüssel von stdin lesen (Schlüssel als Befehlsargumente werden nicht akzeptiert): Schlüssel
                                   des ersten Kontos ersetzen oder Konto erstellen, falls keines vorhanden (für mehrere Konten:
                                   baocut models accounts)
    --endpoint <url>               Basis-URL eines eigenen Endpunkts (anfangs erforderlich); Kataloganbieter können auf einen
                                   Proxy oder ein Gateway verweisen
    --model <id> ...               Transkriptionsmodelle des eigenen Endpunkts (wiederholbar; erstes Modell ist Standard)
    --speech-model <id> ...        Sprachsynthesemodelle des eigenen Endpunkts (/audio/speech; wiederholbar)
    --image-model <id> ...         Bilderzeugungsmodelle des eigenen Endpunkts (/images/generations; wiederholbar)
    --text-model <id> ...          Textmodelle des eigenen Endpunkts (/chat/completions; wiederholbar)
                                   Modellangaben beliebiger Art ersetzen alle deklarierten Modelle
    --verify                       Neuen Schlüssel und Endpunkt vor dem Speichern einmal beim Anbieter prüfen
  baocut models accounts <providerId>
                                   Konten eines Anbieters auflisten: Reihenfolge, Name, verdeckter Schlüssel, Ein/Aus und Status
                                   (Aufrufe verwenden das erste aktivierte Konto mit Schlüssel; bei Fehlern kein Wechsel zum nächsten)
  baocut models accounts add <providerId> [--label <name>] [--region <region>] [--endpoint <url>] [--verify]
                                   Konto hinzufügen; Schlüssel von stdin lesen; --region akzeptiert eine Katalogregion (z. B.
                                   global oder cn); --verify prüft zuerst beim Anbieter und speichert bei Fehlern nicht.
                                   Ein neues Konto aktiviert den Anbieter nicht
  baocut models accounts remove <providerId> <accountId|name>
                                   Konto und Schlüssel entfernen (nach dem letzten Konto bleibt der Anbieter erhalten,
                                   jedoch ohne nutzbaren Schlüssel)
  baocut models accounts use <providerId> <accountId|name>
                                   Bevorzugtes Konto festlegen: Konto an die erste Stelle verschieben
  baocut models usage [--period <${USAGE_PERIODS.join("|")}>] [--provider <id>]
                                   Aufrufe, Nutzung und Ausgaben für Online-Anbieter und Agenten (standardmäßig letzte 30 Tage):
                                   anhand von Listenpreisen geschätzte Beträge, vom Anbieter gemeldete Beträge und unbekannte Kosten
                                   separat auflisten, ohne Währungsumrechnung; aufgeschlüsselt nach Anbieter, Funktion, Modell
                                   und Konto
  baocut models default <capability> <providerId|none> [modelId]
                                   Standardanbieter und -modell für eine Funktion festlegen oder löschen (${MODEL_SERVICE_CAPABILITIES.join(", ")})
  baocut models remove <bundleId|providerId>
                                   Lokales Modellpaket löschen (von anderen Paketen verwendete Komponenten bleiben erhalten; abgelehnt,
                                   solange eine Aufgabe es verwendet); oder Online-Anbieter entfernen: Eigene Endpunkte (custom:<name>)
                                   werden vollständig gelöscht; Kataloganbieter werden deaktiviert und alle Konten und Schlüssel gelöscht
  baocut models refresh <providerId>
                                   Modell- und Stimmenliste eines Online-Anbieters abrufen und zwischenspeichern: Fehlende integrierte
                                   Modelle werden als nicht verfügbar markiert; schlägt der Abruf fehl, wird die integrierte Liste
                                   wie bisher verwendet
  baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]
                                   Standard-Denkaufwand der Texterzeugung und Gleichzeitigkeit je Anbieter anzeigen oder festlegen
                                   (Standard 4); default stellt den ursprünglichen Wert wieder her`,
  byteProgressUnknown: (done: string) => `${done} empfangen (Gesamtgröße unbekannt)`,
  byteProgress: (done: string, total: string, percent: number) => `${done} / ${total} (${percent} %)`,
  bundleStates: {
    'not-installed': "Nicht installiert",
    downloading: "Wird heruntergeladen",
    installed: "Installiert",
    loading: "Wird geladen",
    ready: "Bereit",
    busy: "Ausgelastet",
    unloading: "Entladen",
    error: "Nicht verfügbar",
  } satisfies Record<ModelBundleStatus["state"], string>,
  installStates: {
    queued: "In Warteschlange",
    downloading: "Wird heruntergeladen",
    verifying: "Prüfen und veröffentlichen",
    paused: "Pausiert",
  } satisfies Record<NonNullable<ModelBundleStatus["install"]>["state"], string>,
  bundleState: (label: string, state: string, reason: string | null | undefined) => `${label} (${state}${reason ? ` / ${reason}` : ""})`,
  componentInstalled: "installiert",
  componentMissing: "fehlt",
  sharedWith: (bundles: readonly string[]) => `  gemeinsam mit ${bundles.join(", ")}`,
  installTask: (jobId: string) => `  Auftrag ${jobId}`,
  resumeHint: (bundleId: string) => `; fortsetzen mit baocut models install ${bundleId}`,
  installLine: (state: string, progress: string, task: string, hint: string) => `  Installation: ${state} ${progress}${task}${hint}`,
  checkPassed: "bestanden",
  checkFailed: (code: string | null | undefined) => `fehlgeschlagen${code ? ` (${code})` : ""}`,
  checkLine: (result: string, at: string, detail: string | null | undefined) => `  Prüfung: ${result} ${at}${detail ? `  ${detail}` : ""}`,
  remedyAppFileMissing: "Abhilfe: Installieren Sie BaoCut neu; eine Modellreparatur hilft nicht",
  remedyRepair: (bundleId: string) => `Abhilfe: baocut models repair ${bundleId} lädt nur beschädigte Dateien erneut herunter; prüfen Sie danach erneut`,
  remedyMaybeRepair: (bundleId: string) =>
    `Abhilfe: Versuchen Sie zuerst baocut models repair ${bundleId} (lädt nur beschädigte Dateien erneut herunter) und prüfen Sie danach erneut`,
  remedyOutOfMemory: "Abhilfe: Beenden Sie andere Apps mit hohem Speicherbedarf oder wählen Sie ein kleineres Modell und prüfen Sie danach erneut",
  remedy: (text: string) => `Abhilfe: ${text}`,
  upToDate: (repair: boolean, bundleId: string) =>
    repair ? `${bundleId}: Alle Dateien sind intakt; keine Reparatur nötig` : `${bundleId} ist bereits installiert; kein Download nötig`,
  planHeader: (repair: boolean, bundleId: string, source: string) => `${repair ? "Reparieren" : "Installieren"} ${bundleId} von ${source}`,
  planKeep: (component: string, repo: string) => `  ${component} ${repo} installiert, bleibt erhalten`,
  planDownload: (component: string, repo: string, files: number, size: string) =>
    `  ${component} ${repo} herunterladen ${files} ${noun(files, "Datei", "Dateien")}, ${size}`,
  sizeUnknown: "Größe unbekannt",
  toDownloadEstimate: (estimate: string) => `Herunterzuladen: Größe unbekannt, etwa ${estimate}`,
  toDownload: (size: string) => `Herunterzuladen: ${size}`,
  resumed: (size: string) => `Fortsetzen: ${size} liegt bereits im Bereitstellungsbereich und wird nicht erneut heruntergeladen`,
  freeSpace: (size: string, short: boolean) => `Freier Speicherplatz: ${size}${short ? " (nicht ausreichend)" : ""}`,
  sizeAbout: (size: string) => `etwa ${size}`,
  installPrompt: (repair: boolean, size: string) => `${repair ? "Reparieren" : "Installieren"} und herunterladen: ${size}? [y/N] `,
  noSpace: (need: string, have: string) => `Speicherplatz: Benötigt ${need}, nur ${have} verfügbar`,
  removed: (files: readonly string[]) => `Gelöscht: ${files.join(", ")}`,
  nothingRemoved: "Keine Dateien gelöscht",
  keptInUse: (repo: string, users: readonly string[]) => `Behalten: ${repo}: weiterhin verwendet von ${users.join(", ")}`,
  keptOtherVersion: (repo: string) => `Behalten: ${repo}: Der Ordner enthält eine andere Version, die nicht zu diesem Modellpaket gehört`,
  dirSources: {
    default: "Standardort",
    setting: "in den Einstellungen gewählter Ordner",
    env: "Umgebungsvariable BAOCUT_MODELS_DIR (schreibgeschützt: Ändern Sie die Variable und starten Sie BaoCut neu, um dies zu ändern)",
  } satisfies Record<ModelsDirInfo["source"], string>,
  dirSource: (label: string) => `  Quelle: ${label}`,
  dirMissing: "  Dieser Ordner existiert nicht (möglicherweise ist ein externes Laufwerk nicht verbunden)",
  dirNotWritable: "  BaoCut kann nicht in diesen Ordner schreiben",
  dirUsage: (used: string, free: string | null, models: number) =>
    `  ${used} verwendet${free ? ` · ${free} frei auf diesem Datenträger` : ""} · ${models} ${noun(models, "Modell", "Modelle")} gefunden`,
  dirDefault: (path: string) => `  Standardort: ${path}`,
  dirMoving: (to: string | null | undefined, jobId: string) => `  Wird verschoben${to ? ` zu ${to}` : ""} (Auftrag ${jobId})`,
  dirEnvLocked: "Der Modellordner wird durch die Umgebungsvariable BAOCUT_MODELS_DIR festgelegt: Ändern Sie die Variable und starten Sie BaoCut neu, um ihn zu ändern",
  dirProblemMissing: "Dieser Ordner existiert nicht: Möglicherweise ist ein externes Laufwerk nicht verbunden; verbinden Sie es und versuchen Sie es erneut",
  dirProblemNotWritable: "BaoCut kann nicht in diesen Ordner schreiben: Wählen Sie einen beschreibbaren Ort oder ändern Sie zuerst dessen Berechtigungen",
  dirProblemNested: "Der neue Ort und der aktuelle Modellordner liegen ineinander: Wählen Sie einen Ordner, der weder darin liegt noch ihn enthält",
  dirProblemSame: "Dies ist bereits der aktuelle Modellordner",
  dirFound: (count: number, size: string) => `Gefunden: ${count} ${noun(count, "heruntergeladenes Modell", "heruntergeladene Modelle")} (${size}), einsatzbereit`,
  dirEmpty: "Dieser Ordner enthält noch keine Modelle; künftige Downloads werden hier gespeichert",
  dirFree: (size: string) => `${size} frei auf diesem Datenträger`,
  moveSameVolume: "Gleicher Datenträger: Beim Verschieben werden die Dateien nur umbenannt, daher wird kein zusätzlicher Speicherplatz benötigt",
  moveSize: (size: string, fits: boolean) => `verschieben ${size}${fits ? "" : ", was nicht hineinpasst"}`,
  dirCurrentHas: (size: string, move: string) => `Der aktuelle Ordner enthält ${size} an Modellen: ${move}`,
  moveOrSwitch: "Verwenden Sie nur eines von --move und --switch",
  accountStates: {
    unknown: "Nicht überprüft",
    ok: "OK",
    'invalid-key': "Ungültiger Schlüssel",
    'rate-limited': "Ratenbegrenzung erreicht",
    'quota-exhausted': "Kontingent aufgebraucht",
  } satisfies Record<ProviderAccountStatus["state"], string>,
  rateLimitedUntil: (label: string, until: string) => `${label} (bis ${until})`,
  noAccounts: "Noch keine Konten: baocut models accounts add <providerId> liest den Schlüssel von der Standardeingabe",
  accountEnabled: "aktiviert",
  accountDisabled: "deaktiviert",
  accountKeyUnreadable: "Schlüssel nicht lesbar",
  accountRegion: (region: string) => `Region ${region}`,
  accountEndpoint: (endpoint: string) => `Endpunkt ${endpoint}`,
  accountLastUsed: (at: string) => `zuletzt verwendet ${at}`,
  accountCurrent: "in Verwendung",
  accountChoice: (accountId: string, label: string) => `${accountId} (${label})`,
  noAccountChoices: "keine Konten",
  listSep: ", ",
  accountAmbiguous: (count: number, ref: string, choices: string) => `${count} Konten heißen „${ref}“; verwenden Sie eine accountId: ${choices}`,
  accountNotFound: (ref: string, choices: string) => `Kein solches Konto: ${ref} (Auswahl: ${choices})`,
  usagePeriods: { today: "Heute", '7d': "Letzte 7 Tage", '30d': "Letzte 30 Tage", all: "Gesamter Zeitraum" } satisfies Record<UsagePeriod, string>,
  unitTokens: (input: string, output: string) => `Eingabe ${input} / Ausgabe ${output} Token`,
  unitCached: (cached: string) => `${cached} zwischengespeichert`,
  unitAudio: (minutes: string) => `${minutes} Min. Audio`,
  unitChars: (chars: string) => `${chars} Zeichen`,
  unitImages: (images: number) => `${images} ${noun(images, "Bild", "Bilder")}`,
  clauseSep: ", ",
  costKinds: {
    reported: "vom Anbieter gemeldet",
    estimated: "anhand von Listenpreisen geschätzt",
    mixed: "gemeldet und geschätzt",
    unknown: "Kosten unbekannt",
  } satisfies Record<UsageRow["costKind"], string>,
  rowCalls: (calls: number, failed: number) => `${calls} ${noun(calls, "Aufruf", "Aufrufe")}${failed > 0 ? ` (${failed} fehlgeschlagen)` : ""}`,
  costApprox: (money: string, kind: string) => `≈ ${money} (${kind})`,
  usageHeader: (scope: string | undefined, period: string, from: string, to: string) =>
    `Nutzung (${scope ? `${scope}, ` : ""}${period}: ${from} zu ${to})`,
  noCalls: "  Noch keine Aufrufe",
  totalCalls: (calls: number, failed: number) => `  ${calls} ${noun(calls, "Aufruf", "Aufrufe")}${failed > 0 ? ` (${failed} fehlgeschlagen)` : ""}`,
  usageUnits: (units: string) => `  Nutzung: ${units}`,
  spentEstimated: (money: string) => `  Ausgaben ≈ ${money} (anhand von Listenpreisen geschätzt)`,
  spentReported: (money: string) => `  Ausgaben ${money} (vom Anbieter gemeldet)`,
  unknownCostCalls: (calls: number) => `  Kosten unbekannt für ${calls} ${noun(calls, "weiteren Aufruf", "weitere Aufrufe")}`,
  noBilledCalls: "  Keine abgerechneten Aufrufe",
  byProvider: "Nach Anbieter",
  byCapability: "Nach Funktion",
  byModel: "Nach Modell",
  byAccount: "Nach Konto",
  // ---- 管理桶 `baocut models …`（admin/models.ts） ----
  usageRepair: "Verwendung: baocut models repair <bundleId> [--yes]",
  usageCancel: "Verwendung: baocut models cancel <bundleId> [--discard]",
  usageConfigure: "Verwendung: baocut models configure <providerId> [--enable|--disable] [--key-stdin] [--endpoint <url>] …",
  usageDefault: "Verwendung: baocut models default <capability> <providerId|none> [modelId]",
  usageRemove: "Verwendung: baocut models remove <bundleId|providerId>",
  usageRefresh: "Verwendung: baocut models refresh <providerId>",
  usageParameters: "Verwendung: baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]",
  usageAccounts:
    "Verwendung: baocut models accounts <providerId> | add <providerId> [--label <name>] [--region <region>] [--verify] | remove <providerId> <account> | use <providerId> <account>",
  usageDir: "Verwendung: baocut models dir [--set <path> [--move|--switch] | --reset [--move|--switch]]",
  cancelledDiscarded: "Gestoppt und heruntergeladenen Teil gelöscht",
  cancelledKept: "Gestoppt (der heruntergeladene Teil bleibt erhalten; führen Sie install erneut aus, um fortzufahren)",
  unknownCapability: (capability: string, choices: readonly string[]) => `Unbekannte Funktion: ${capability} (eine von ${choices.join(", ")})`,
  clearDefaultNoModel: "Beim Zurücksetzen des Standards kein Modell angeben",
  defaultSet: (label: string, provider: string, model: string) => `${label} Standard: ${provider} / ${model}`,
  defaultCleared: (label: string) => `${label} Standard gelöscht`,
  customProviderDeleted: (id: string) => `Gelöscht: ${id} (darauf verweisende Standardeinstellungen bleiben erhalten und werden als nicht verfügbar angezeigt)`,
  providerRemoved: (id: string) =>
    `Entfernt: ${id}: deaktiviert und alle Konten und Schlüssel gelöscht (darauf verweisende Standardeinstellungen bleiben erhalten und werden als nicht verfügbar angezeigt)`,
  providerRefreshFailed: (id: string, error: string | undefined) =>
    `Aktualisierung nicht möglich: ${id}: ${error ?? "unbekannter Grund"}; die integrierte Modellliste wird weiterhin verwendet`,
  providerRefreshed: (id: string, models: number, voices: number | undefined, at: string) =>
    `Modellliste neu abgerufen: ${id}: ${models} ${noun(models, "Modell", "Modelle")}${voices !== undefined ? `, ${voices} ${noun(voices, "Stimme", "Stimmen")}` : ""} (${at})`,
  periodChoices: (periods: readonly string[]) => `--period muss einer der folgenden Werte sein: ${periods.join(", ")}`,
  enableDisableConflict: "Verwenden Sie nur eines von --enable und --disable",
  saved: (description: string) => `Gespeichert: ${description}`,
  verifiedAndSaved: "Überprüft und gespeichert",
  savedPlain: "Gespeichert",
  providerNotEnabled: (id: string) => `${id} ist noch nicht aktiviert: baocut models configure ${id} --enable`,
  accountRemoved: (name: string) => `Konto entfernt: ${name}`,
  accountPreferred: (name: string) => `Als bevorzugt festgelegt: ${name}`,
  providerHasNoAccounts: (id: string) => `${id} hat keine Konten`,
  noSuchProvider: (id: string) => `Kein solcher Anbieter: ${id}`,
  alreadyRepairing: (jobId: string) => `Reparatur läuft bereits (Auftrag ${jobId}); Fortschritt wird angezeigt`,
  nothingToRepair: "Keine Dateien zu reparieren",
  notTtyConfirmDownload: "Kein Terminal: Fügen Sie --yes hinzu, sobald der Benutzer den Download bestätigt",
  notDownloaded: "Nicht heruntergeladen",
  nothingToDownload: "Nichts herunterzuladen",
  repairDone: "Reparatur abgeschlossen",
  repairPartialKept: (bundleId: string) => `Der heruntergeladene Teil bleibt erhalten: Führen Sie baocut models repair ${bundleId} aus, um fortzufahren`,
  setResetConflict: (usage: string) => `Verwenden Sie nur eines von --set und --reset. ${usage}`,
  dirHasModels: "Der aktuelle Ordner enthält Modelle: Fügen Sie --move hinzu, um sie zu verschieben, oder --switch, um nur den Ort zu ändern (die alten Dateien bleiben erhalten)",
  dirChanged: (dir: string, oldFilesKept: boolean) => `Modellordner geändert nach ${dir}${oldFilesKept ? " (Dateien am alten Ort bleiben erhalten)" : ""}`,
  modelsMoved: (dir: string) => `Modelle verschoben nach ${dir}`,
  dirRolledBack: "Zurückgesetzt: Der ursprüngliche Modellordner ist unverändert",
  pasteKeyHint: "Fügen Sie den API-Schlüssel ein, drücken Sie die Eingabetaste und anschließend Ctrl-D zum Abschließen:",
  noKeyOnStdin: "Kein API-Schlüssel auf der Standardeingabe",
  keyHasWhitespace: "Der API-Schlüssel sollte keine Leerzeichen oder Zeilenumbrüche enthalten: Geben Sie nur den Schlüssel selbst auf der Standardeingabe ein",
  positiveInteger: (option: string) => `${option} muss eine positive ganze Zahl sein`,
  effortChoices: (efforts: readonly string[]) => `--effort muss einer der folgenden Werte sein: ${efforts.join(", ")}`,
  capabilityLabels: {
    transcribe: "Transkription",
    synthesizeSpeech: "Sprachsynthese",
    generateImage: "Bilderzeugung",
    generateText: "Texterzeugung",
    separateAudio: "Stimmtrennung",
  } satisfies Record<ModelServiceCapability, string>,
  unavailableLabels: {
    'not-configured': "nicht aktiviert",
    'missing-credential': "API-Schlüssel fehlt",
    'not-installed': "nicht installiert",
    'signed-out': "abgemeldet",
    outdated: "Version zu alt",
    'not-paired': "nicht gekoppelt",
    'not-connected': "Verbindung nicht möglich",
    unsupported: "nicht unterstützt",
    resource: "nach wiederholten Fehlern deaktiviert",
  } satisfies Record<ProviderUnavailableReason, string>,
  unavailable: "nicht verfügbar",
  capabilityState: (label: string, available: boolean, reason: string) => `${label} ${available ? "verfügbar" : `nicht verfügbar (${reason})`}`,
  capabilitySep: ", ",
  configEnabled: "aktiviert",
  configDisabled: "deaktiviert",
  keyState: (set: boolean) => `Schlüssel ${set ? "festgelegt" : "nicht festgelegt"}`,
  configEndpoint: (url: string) => `Endpunkt ${url}`,
  modelListRefreshed: (at: string) => `Modellliste aktualisiert ${at}`,
  lastRefreshFailed: (at: string) => `letzte Aktualisierung fehlgeschlagen (${at}); integrierte Liste wird verwendet`,
  textParameters: (effort: string | null | undefined, concurrency: number) =>
    `Standard-Denkaufwand: ${effort ?? "modellabhängig"} · Gleichzeitigkeit je Anbieter ${concurrency}`,
  markDefault: "Standard",
  markDeclared: "vom Benutzer angegeben",
  wordTimestampsNative: "Wortzeitstempel",
  wordTimestampsEstimated: "Wortzeiten aus der Länge geschätzt",
  maxInputMegabytes: (mb: string) => `≤ ${mb} MB je Aufruf`,
  maxDurationMinutes: (minutes: number) => `≤ ${minutes} Min. je Aufruf`,
  voiceCount: (count: number, defaultVoice: string | null | undefined) =>
    `${count} ${noun(count, "Stimme", "Stimmen")} (Standard ${defaultVoice ?? "keine"})`,
  noPresetVoices: "keine voreingestellten Stimmen; eine Stimme muss angegeben werden",
  acceptsCustomVoices: "akzeptiert eigene Stimmen",
  maxInputChars: (count: number) => `≤ ${count} Zeichen je Aufruf`,
  acceptsInstructions: "akzeptiert Stilanweisungen",
  sizeCount: (count: number, defaultSize: string | null | undefined) =>
    `${count} ${noun(count, "Größe", "Größen")}${defaultSize ? ` (Standard ${defaultSize})` : ""}`,
  aspectRatios: (ratios: string) => `Seitenverhältnisse ${ratios}`,
  maxImageCount: (count: number) => `≤ ${count} Bilder je Aufruf`,
  sizeAndSeedFixed: "Größe und Seed lassen sich nicht festlegen",
  contextTokens: (count: number) => `Kontext ${count} Token`,
  maxOutputTokens: (count: number | undefined) => `Ausgabe ≤ ${count} Token`,
  efforts: (efforts: string, defaultEffort: string | null | undefined) =>
    `Denkaufwand ${efforts}${defaultEffort ? ` (Standard ${defaultEffort})` : ""}`,
  structuredOutput: "strukturierte Ausgabe",
  subscription: "im Abonnement enthalten, Kontingent unbekannt",
  modelName: (id: string, label: string) => `${id} (${label})`,
};
